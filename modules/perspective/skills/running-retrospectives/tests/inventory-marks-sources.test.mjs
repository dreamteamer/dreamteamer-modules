// The session must say what it read.
//
// The operator's first complaint about a live run, 2026-09-09: *"it needs to clearly mark the
// relevant sources (values are blank where i checked)"*. Both live sessions — 3,171 records in one
// vault, 2,068 in another — carry an EMPTY `sources` array. The only record of what was inventoried
// is the free-text `hint`, and the structured link runs the other way, from each source back to the
// session. So a reader of the session cannot answer "what did this see" without a second query, and
// nothing at all records what it could NOT see.
//
// ⚠ THE LIST IS NOW A GENERATED MIRROR. `sources.retrospective` carries `x-inverse: sources`, so the
// engine owns the session's `sources[]`; this stage writes files directly and asks it to refresh
// them. Under a fixture --data-root there is no compiled runtime to rebuild against, so what is
// asserted HERE is the half this stage still owns — every source record carries the session, and the
// run log line is REPLACED on a re-run rather than appended to. `tests/relations.test.mjs` pins the
// mirror itself, and a real workspace was walked to prove it: the session showed its sources with no
// script writing them.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readRecord, writeRecord, recordPath, listRecords } from '../lib/records.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const INVENTORY = path.join(HERE, '..', 'bin', 'inventory.mjs');
const BASE = '2026-09-09--dana-o';
const SLUG = 'dana-o';
const REF = `perspective/retrospective-sessions/${BASE}`;

/** A workspace with two readable repos, one absent transcript home, and the session that reads them. */
function fixture() {
	const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-inv-'));
	const data = path.join(ws, 'data');
	const home = path.join(ws, 'home');           // no ~/.claude, no ~/.codex → unavailable sources
	const repos = path.join(ws, 'repos');
	for (const name of ['northwind-api', 'bright-web']) {
		const r = path.join(repos, name);
		fs.mkdirSync(path.join(r, '.git'), { recursive: true });
	}
	fs.mkdirSync(home, { recursive: true });
	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data),
		{ contributor: SLUG, handles: ['dana.o@northwind.example'], started: '2026-09-09', stage: 'installed' });
	return { ws, data, home, repos };
}

const run = (f, extra = []) => spawnSync(process.execPath,
	[INVENTORY, '--retrospective', REF, '--data-root', f.data, '--home', f.home, '--repos-root', f.repos, '--no-register', ...extra],
	{ cwd: f.ws, encoding: 'utf8' });

const session = (f) => readRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', f.data));

// ⚠ A LIST since 0.7.0. `sources` is many-to-many with the run — a source is durable and every run
// re-reads it — so the run appears IN `retrospectives`, and a second run appends rather than replaces.
test('every source found carries the session, which is the half that generates the mirror', () => {
	const f = fixture();
	const r = run(f);
	assert.equal(r.status, 0, r.stderr);

	const files = listRecords(path.join(f.data, 'perspective', 'sources'));
	assert.ok(files.length >= 3, `the fixture should yield several sources, got ${files.length}`);
	for (const p of files) {
		assert.deepEqual(readRecord(p).fields.retrospectives, [REF], `${p} does not name the session it was found by`);
	}
});

test('an unreachable source is still WRITTEN — a stated gap, not a silent one', () => {
	const f = fixture();
	run(f);
	const unreachable = listRecords(path.join(f.data, 'perspective', 'sources'))
		.filter((p) => readRecord(p).fields.reach !== 'available');
	assert.ok(unreachable.length > 0, 'the fixture has no ~/.codex, so at least one source is unavailable');
	for (const p of unreachable) {
		assert.deepEqual(readRecord(p).fields.retrospectives, [REF], 'an unreachable source still belongs to the run that looked for it');
	}
});

test('the body carries the stage line, with what it saw and what it could not', () => {
	const f = fixture();
	run(f);
	const body = session(f).body;
	assert.match(body, /\*\*inventoried\*\*/, 'the run log names the stage');
	assert.match(body, /\d+ sources? \(\d+ available, \d+ unavailable\)/, 'and counts both halves');
});

test('a re-run REPLACES its own log line rather than appending a second', () => {
	const f = fixture();
	run(f);
	const first = session(f).body;
	run(f);
	const second = session(f).body;
	assert.equal((second.match(/\*\*inventoried\*\*/g) ?? []).length, 1, 'two runs, two log lines — the log is appending');
	assert.equal(second.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, 'T'), first.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, 'T'),
		'apart from its timestamp the line must be identical');
});

test('a re-run leaves the session otherwise untouched', () => {
	const f = fixture();
	run(f);
	const before = session(f).fields;
	run(f);
	const after = session(f).fields;
	assert.equal(after.stage, before.stage, 'inventory does not advance the stage — the skill does');
	assert.equal(after.contributor, before.contributor);
});

test('--dry-run writes nothing to the session', () => {
	const f = fixture();
	const file = recordPath('retrospective-sessions', BASE, 'retrospective-session', f.data);
	const before = fs.readFileSync(file, 'utf8');
	run(f, ['--dry-run']);
	assert.equal(fs.readFileSync(file, 'utf8'), before);
});
