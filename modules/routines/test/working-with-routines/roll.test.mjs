// `roll` read-path tests, run as a subprocess because the script dispatches its CLI at load time.
// Every fixture is a throwaway tmp dir pinned with
// `--dir`, and `--today` pins the clock, so nothing here reads data/routines or writes a record.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../skills/working-with-routines/bin/rrule.mjs');
const run = (dir, today) => JSON.parse(execFileSync('node', [SCRIPT, 'roll', '--dir', dir, '--today', today], { encoding: 'utf8' }));

const fixture = (records) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routines-roll-'));
	for (const [id, fm] of Object.entries(records)) {
		const body = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n');
		fs.writeFileSync(path.join(dir, `${id}.routine.md`), `---\n${body}\n---\n\nnotes.\n`);
	}
	return dir;
};

test('a stale next_due is the only change proposed — the English comes back for reading, never as a write', () => {
	const dir = fixture({
		accountant: { name: 'x', recurrence: 'RRULE:FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1', anchor: "'2026-09-01'", next_due: "'2026-09-01'", status: 'active' },
	});
	const [row] = run(dir, '2026-09-02');
	assert.deepEqual(row.changes, { next_due: '2026-11-01' }, 'next_due is the only field roll writes');
	assert.equal(row.text, 'Every 2 months on day 1', 'the rendering is reported, for a caller to READ');
	assert.ok(!('recurrence_text' in row.changes), 'no stored rendering exists to drift');
});

test('nothing to do is reported as nothing — an up-to-date record is not a row', () => {
	const dir = fixture({ ok: { name: 'x', recurrence: 'RRULE:FREQ=YEARLY', anchor: "'2027-08-31'", next_due: "'2027-08-31'", status: 'active' } });
	assert.deepEqual(run(dir, '2026-08-30'), []);
});

test('a DAILY routine is never given a next_due, and one that has one is cleared', () => {
	const dir = fixture({
		daily: { name: 'x', recurrence: 'RRULE:FREQ=DAILY', status: 'active' },
		strayed: { name: 'y', recurrence: 'RRULE:FREQ=DAILY', next_due: "'2026-08-30'", status: 'active' },
	});
	const rows = run(dir, '2026-08-30');
	assert.deepEqual(rows.map((r) => r.id), ['strayed'], 'the clean daily record needs nothing');
	assert.deepEqual(rows[0].changes, { next_due: '' }, 'a daily next_due is cleared, not maintained');
});

test('an anchorless annual routine is reported with the reason, not a guessed date', () => {
	const dir = fixture({ car: { name: 'x', recurrence: 'RRULE:FREQ=YEARLY', next_due: "'2027-01-01'", status: 'active' } });
	const [row] = run(dir, '2026-08-30');
	assert.deepEqual(row.changes, { next_due: '' });
	assert.match(row.note, /no anchor/);
});

test('paused and retired routines are left alone', () => {
	const dir = fixture({
		paused: { name: 'x', recurrence: 'RRULE:FREQ=YEARLY', anchor: "'2020-01-01'", status: 'paused' },
		retired: { name: 'y', recurrence: 'RRULE:FREQ=YEARLY', anchor: "'2020-01-01'", status: 'retired' },
	});
	assert.deepEqual(run(dir, '2026-08-30'), []);
});

test('a rule roll cannot parse is reported as an error row, not skipped silently', () => {
	const dir = fixture({ bad: { name: 'x', recurrence: 'RRULE:FREQ=FORTNIGHTLY', status: 'active' } });
	const [row] = run(dir, '2026-08-30');
	assert.equal(row.id, 'bad');
	assert.match(row.error, /unsupported FREQ/);
	assert.ok(!row.changes, 'an unparseable rule proposes no write');
});

// Without --dir, roll reads the workspace's COMPILED routines descriptor for where records live: the
// v2 compiled shape keeps the resolved path under `compiled.defaults.storage`, and a description that
// happens to contain "path:" must not be read as one.
test('without --dir, the records are found where the compiled descriptor puts them', () => {
	const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'routines-ws-'));
	try {
		fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}');
		const compiled = path.join(ws, '.dreamteamer', 'collections', 'routines.collection.yaml');
		fs.mkdirSync(path.dirname(compiled), { recursive: true });
		fs.writeFileSync(compiled, [
			'name: routines', 'description: >-', '  A chore. path: data/wrong',
			'compiled:', '  defaults:', '    storage:', '      path: data/elsewhere/routines', '      format: md', '      suffix: routine',
			'  runtime: false', '',
		].join('\n'));
		const dir = path.join(ws, 'data', 'elsewhere', 'routines');
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'filing.routine.md'), "---\nname: x\nrecurrence: RRULE:FREQ=YEARLY\nanchor: '2027-01-31'\nstatus: active\n---\n");
		const rows = JSON.parse(execFileSync('node', [SCRIPT, 'roll', '--today', '2026-09-01'], { cwd: ws, encoding: 'utf8' }));
		assert.deepEqual(rows.map((r) => r.id), ['filing']);
		assert.deepEqual(rows[0].changes, { next_due: '2027-01-31' });
	} finally {
		fs.rmSync(ws, { recursive: true, force: true });
	}
});
