// The regression this script IS. Measured 2026-09-08 on a real run: the naming pass was asked to copy
// session refs onto its `dt add` command line and 615 of 1,068 conversations never arrived — one
// candidate held 257 sessions. Nothing noticed: every activity looked complete and every rolled-up
// number was under half. Asking a model to transcribe a long list is a silent-data-loss machine.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRecord } from '../../skills/running-retrospectives/lib/records.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', '..', 'skills', 'running-retrospectives', 'bin', 'attach-evidence.mjs');
const BASE = '2026-09-08--fx';
const SLUG = 'fx';   // the contributor — evidence and model ids are keyed by it, not by the run
const REF = `perspective/retrospective-sessions/${BASE}`;

const fm = (o) => '---\n' + Object.entries(o).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n---\nbody\n';

function workspace({ activities, candidate, sessions }) {
	const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-attach-'));
	const D = path.join(vault, 'data', 'perspective');
	// Every stage runs inside a session and reads its contributor key off that record.
	{ const sp = path.join(D, 'retrospective-sessions', `${BASE}.retrospective-session.md`);
	  fs.mkdirSync(path.dirname(sp), { recursive: true });
	  fs.writeFileSync(sp, fm({ contributor: SLUG, handles: ['dana.o@northwind.example'], started: BASE.slice(0, 10), stage: 'installed' })); }
	for (const [name, day] of Object.entries(sessions)) {
		const p = path.join(D, 'conversations', 'claude-code', '2026', '08', `${name}.conversation.md`);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, fm({ session_id: name, started_at: `${day}T09:00:00.000Z`, turns_user: 1 }));
	}
	for (const a of activities) {
		const p = path.join(D, 'activities', SLUG, `${a.id}.activity.md`);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, fm({ retrospective: REF, name: a.name, started: a.started, ended: a.ended, ...(a.from_candidate ? { from_candidate: a.from_candidate } : {}), ...(a.sessions ? { sessions: a.sessions } : {}) }));
	}
	const scratch = path.join(vault, '.perspective', 'activity-candidates');
	fs.mkdirSync(scratch, { recursive: true });
	fs.writeFileSync(path.join(scratch, `${BASE}.jsonl`), candidate.map((c) => JSON.stringify(c)).join('\n') + '\n');
	return vault;
}

const run = (vault, extra = []) => execFileSync('node', [BIN, '--retrospective', REF,
	'--data-root', path.join(vault, 'data'), '--scratch-root', path.join(vault, '.perspective'), ...extra], { encoding: 'utf8' });

const S = (n) => `perspective/conversations/claude-code/2026/08/${n}`;

test('a candidate that produced ONE activity hands it everything — no transcription, no loss', () => {
	const vault = workspace({
		sessions: { a: '2026-08-01', b: '2026-08-02', c: '2026-08-03' },
		activities: [{ id: '2026-08-01--ship-it', name: 'ship it', started: '2026-08-01', ended: '2026-08-03', from_candidate: 'api--2026-08-01' }],
		candidate: [{ key: 'api--2026-08-01', repo: 'api', started: '2026-08-01', ended: '2026-08-03', sessions: [S('a'), S('b'), S('c')], commits: ['abc1234', 'def5678'], branches: ['main'], tickets: [] }],
	});
	assert.match(run(vault), /attached 3 sessions, 2 commits, 0 tickets/);
	const f = readRecord(path.join(vault, 'data', 'perspective', 'activities', SLUG, '2026-08-01--ship-it.activity.md')).fields;
	assert.deepEqual(f.sessions, [S('a'), S('b'), S('c')]);
	assert.deepEqual(f.commits, ['abc1234', 'def5678']);
	assert.deepEqual(f.branches, ['main']);
	fs.rmSync(vault, { recursive: true, force: true });
});

// Splitting a candidate into several activities is the WHOLE POINT of the naming pass, so the
// attacher has to place each item rather than duplicate the lot onto every activity.
test('when one candidate produced several activities, each session goes to the window that contains it', () => {
	const vault = workspace({
		sessions: { early: '2026-08-01', mid: '2026-08-10', late: '2026-08-20' },
		activities: [
			{ id: '2026-08-01--the-spike', name: 'the spike', started: '2026-08-01', ended: '2026-08-05', from_candidate: 'api--2026-08-01' },
			{ id: '2026-08-08--the-build', name: 'the build', started: '2026-08-08', ended: '2026-08-22', from_candidate: 'api--2026-08-01' },
		],
		candidate: [{ key: 'api--2026-08-01', repo: 'api', started: '2026-08-01', ended: '2026-08-22', sessions: [S('early'), S('mid'), S('late')], commits: [], branches: [], tickets: [] }],
	});
	run(vault);
	const spike = readRecord(path.join(vault, 'data', 'perspective', 'activities', SLUG, '2026-08-01--the-spike.activity.md')).fields;
	const build = readRecord(path.join(vault, 'data', 'perspective', 'activities', SLUG, '2026-08-08--the-build.activity.md')).fields;
	assert.deepEqual(spike.sessions, [S('early')]);
	assert.deepEqual(build.sessions, [S('late'), S('mid')], 'sorted, so a re-run is byte-identical');
});

test('the NARROWEST containing window wins, so a specific activity beats a catch-all', () => {
	const vault = workspace({
		sessions: { x: '2026-08-10' },
		activities: [
			{ id: '2026-08-01--everything-else', name: 'everything else', started: '2026-08-01', ended: '2026-08-31', from_candidate: 'api--2026-08-01' },
			{ id: '2026-08-09--the-migration', name: 'the migration', started: '2026-08-09', ended: '2026-08-11', from_candidate: 'api--2026-08-01' },
		],
		candidate: [{ key: 'api--2026-08-01', repo: 'api', started: '2026-08-01', ended: '2026-08-31', sessions: [S('x')], commits: [], branches: [], tickets: [] }],
	});
	run(vault);
	const narrow = readRecord(path.join(vault, 'data', 'perspective', 'activities', SLUG, '2026-08-09--the-migration.activity.md')).fields;
	const wide = readRecord(path.join(vault, 'data', 'perspective', 'activities', SLUG, '2026-08-01--everything-else.activity.md')).fields;
	assert.deepEqual(narrow.sessions, [S('x')]);
	assert.equal(wide.sessions, undefined);
});

// The rule that makes this a data-loss fix rather than a data-loss cause.
test('a session inside NO window is placed at the nearest activity, never dropped', () => {
	const vault = workspace({
		sessions: { orphan: '2026-08-25' },
		activities: [
			{ id: '2026-08-01--early-work', name: 'early work', started: '2026-08-01', ended: '2026-08-02', from_candidate: 'api--2026-08-01' },
			{ id: '2026-08-20--later-work', name: 'later work', started: '2026-08-20', ended: '2026-08-21', from_candidate: 'api--2026-08-01' },
		],
		candidate: [{ key: 'api--2026-08-01', repo: 'api', started: '2026-08-01', ended: '2026-08-25', sessions: [S('orphan')], commits: [], branches: [], tickets: [] }],
	});
	run(vault);
	const later = readRecord(path.join(vault, 'data', 'perspective', 'activities', SLUG, '2026-08-20--later-work.activity.md')).fields;
	assert.deepEqual(later.sessions, [S('orphan')], 'it belongs to that candidate by construction — dropping it is the failure this script exists to prevent');
});

test('a hand-written activity with no from_candidate is left exactly as it is', () => {
	const vault = workspace({
		sessions: { a: '2026-08-01' },
		activities: [{ id: '2026-08-01--by-hand', name: 'by hand', started: '2026-08-01', ended: '2026-08-01', sessions: [S('a')] }],
		candidate: [{ key: 'api--2026-08-01', repo: 'api', started: '2026-08-01', ended: '2026-08-01', sessions: [S('a')], commits: ['abc1234'], branches: [], tickets: [] }],
	});
	const out = run(vault);
	assert.match(out, /without from_candidate 1/);
	const f = readRecord(path.join(vault, 'data', 'perspective', 'activities', SLUG, '2026-08-01--by-hand.activity.md')).fields;
	assert.equal(f.commits, undefined, 'nothing was attached to it');
});

test('a from_candidate naming no candidate is REPORTED, never guessed at', () => {
	const vault = workspace({
		sessions: { a: '2026-08-01' },
		activities: [{ id: '2026-08-01--typo', name: 'typo', started: '2026-08-01', ended: '2026-08-01', from_candidate: 'api--2026-07-01' }],
		candidate: [{ key: 'api--2026-08-01', repo: 'api', started: '2026-08-01', ended: '2026-08-01', sessions: [S('a')], commits: [], branches: [], tickets: [] }],
	});
	assert.match(run(vault), /1 from_candidate key\(s\) match no candidate/);
});

test('a second run writes nothing', () => {
	const vault = workspace({
		sessions: { a: '2026-08-01' },
		activities: [{ id: '2026-08-01--ship-it', name: 'ship it', started: '2026-08-01', ended: '2026-08-01', from_candidate: 'api--2026-08-01' }],
		candidate: [{ key: 'api--2026-08-01', repo: 'api', started: '2026-08-01', ended: '2026-08-01', sessions: [S('a')], commits: [], branches: [], tickets: [] }],
	});
	run(vault);
	assert.match(run(vault), /activities touched 0 · unchanged 1/);
});
