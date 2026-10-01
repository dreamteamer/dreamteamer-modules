// A repair for one migration, and the tests are mostly about what it REFUSES. Inferring provenance is
// always worse than recording it; a wrong `from_candidate` attributes one candidate's evidence to
// another activity, which is the worst error this module can make.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRecord } from '../lib/records.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'backfill-from-candidate.mjs');
const BASE = '2026-09-08--fx';
const SLUG = 'fx';   // the contributor — evidence and model ids are keyed by it, not by the run
const REF = `perspective/retrospective-sessions/${BASE}`;
const fm = (o) => '---\n' + Object.entries(o).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n---\nbody\n';
const S = (n) => `perspective/conversations/claude-code/2026/08/${n}`;

function workspace(activities, candidates) {
	const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-backfill-'));
	const D = path.join(vault, 'data', 'perspective');
	// Every stage runs inside a session and reads its contributor key off that record.
	{ const sp = path.join(D, 'retrospective-sessions', `${BASE}.retrospective-session.md`);
	  fs.mkdirSync(path.dirname(sp), { recursive: true });
	  fs.writeFileSync(sp, fm({ contributor: SLUG, handles: ['dana.o@northwind.example'], started: BASE.slice(0, 10), stage: 'installed' })); }
	for (const a of activities) {
		const p = path.join(vault, 'data', 'perspective', 'world', 'activities', SLUG, `${a.id}.activity.md`);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		const { id, ...rest } = a;
		fs.writeFileSync(p, fm({ retrospective: REF, ...rest }));
	}
	const sc = path.join(vault, '.perspective', 'activity-candidates');
	fs.mkdirSync(sc, { recursive: true });
	fs.writeFileSync(path.join(sc, `${BASE}.jsonl`), candidates.map((c) => JSON.stringify(c)).join('\n') + '\n');
	return vault;
}
const run = (v, extra = []) => execFileSync('node', [BIN, '--retrospective', REF,
	'--data-root', path.join(v, 'data'), '--scratch-root', path.join(v, '.perspective'), ...extra], { encoding: 'utf8' });
const read = (v, id) => readRecord(path.join(v, 'data', 'perspective', 'world', 'activities', SLUG, `${id}.activity.md`)).fields;

test('shared evidence plus a date overlap identifies the candidate', () => {
	const v = workspace(
		[{ id: 'a', name: 'ship it', started: '2026-08-02', ended: '2026-08-04', sessions: [S('x')] }],
		[
			{ key: 'api--2026-08-01', repo: 'api', started: '2026-08-01', ended: '2026-08-09', sessions: [S('x'), S('y')], commits: [] },
			{ key: 'web--2026-08-01', repo: 'web', started: '2026-08-01', ended: '2026-08-09', sessions: [S('z')], commits: [] },
		],
	);
	assert.match(run(v), /from_candidate set 1 \(0 by repo alone/);
	assert.equal(read(v, 'a').from_candidate, 'api--2026-08-01');
});

// The refusal that matters most.
test('two candidates sharing the SAME amount of evidence leave the field unset', () => {
	const v = workspace(
		[{ id: 'a', name: 'ship it', started: '2026-08-02', ended: '2026-08-04', sessions: [S('x'), S('y')] }],
		[
			{ key: 'api--2026-08-01', repo: 'api', started: '2026-08-01', ended: '2026-08-09', sessions: [S('x')], commits: [] },
			{ key: 'web--2026-08-01', repo: 'web', started: '2026-08-01', ended: '2026-08-09', sessions: [S('y')], commits: [] },
		],
	);
	assert.match(run(v), /ambiguous 1/);
	assert.equal(read(v, 'a').from_candidate, undefined, 'an unset field costs nothing; a wrong one is unrecoverable');
});

test('more shared evidence breaks a non-tie', () => {
	const v = workspace(
		[{ id: 'a', name: 'ship it', started: '2026-08-02', ended: '2026-08-04', sessions: [S('x'), S('y')], commits: ['abc1234'] }],
		[
			{ key: 'api--2026-08-01', repo: 'api', started: '2026-08-01', ended: '2026-08-09', sessions: [S('x'), S('y')], commits: ['abc1234'] },
			{ key: 'web--2026-08-01', repo: 'web', started: '2026-08-01', ended: '2026-08-09', sessions: [S('y')], commits: [] },
		],
	);
	run(v);
	assert.equal(read(v, 'a').from_candidate, 'api--2026-08-01');
});

test('a date overlap alone is never enough — it would match half the corpus', () => {
	const v = workspace(
		[{ id: 'a', name: 'ship it', started: '2026-08-02', ended: '2026-08-04', sessions: [S('nowhere')] }],
		[{ key: 'api--2026-08-01', repo: 'api', started: '2026-08-01', ended: '2026-08-09', sessions: [S('x')], commits: [] }],
	);
	assert.match(run(v), /no match 1/);
	assert.equal(read(v, 'a').from_candidate, undefined);
});

test('an activity with NO evidence falls back to repo, and the weaker basis is counted separately', () => {
	const v = workspace(
		[{ id: 'a', name: 'ship it', started: '2026-08-02', ended: '2026-08-04', repos: ['repos/api'] }],
		[
			{ key: 'api--2026-08-01', repo: 'api', started: '2026-08-01', ended: '2026-08-09', sessions: [S('x')], commits: [] },
			{ key: 'web--2026-08-01', repo: 'web', started: '2026-08-01', ended: '2026-08-09', sessions: [S('z')], commits: [] },
		],
	);
	assert.match(run(v), /set 1 \(1 by repo alone — weaker\)/);
	assert.equal(read(v, 'a').from_candidate, 'api--2026-08-01');
});

test('an activity that already has one is never re-decided', () => {
	const v = workspace(
		[{ id: 'a', name: 'ship it', started: '2026-08-02', ended: '2026-08-04', from_candidate: 'set--by--hand', sessions: [S('x')] }],
		[{ key: 'api--2026-08-01', repo: 'api', started: '2026-08-01', ended: '2026-08-09', sessions: [S('x')], commits: [] }],
	);
	assert.match(run(v), /already had one 1/);
	assert.equal(read(v, 'a').from_candidate, 'set--by--hand');
});
