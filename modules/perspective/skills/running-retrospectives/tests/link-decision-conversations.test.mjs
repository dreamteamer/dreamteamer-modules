// `source_ref` says where a decision was WRITTEN DOWN; `conversations` says where it was FORMED.
// The whole value of the second is that it is empty when nobody can tell — a nearest-in-time guess
// would fill 144 fields and make every one of them unciteable. These tests pin the empties as hard
// as they pin the hits.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRecord } from '../lib/records.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'link-decision-conversations.mjs');
const BASE = '2026-09-08--fx';
const SLUG = 'fx';   // the contributor — evidence and model ids are keyed by it, not by the run
const REF = `perspective/retrospective-sessions/${BASE}`;

const fm = (o) => '---\n' + Object.entries(o).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n---\nbody\n';
const S = (n) => `perspective/conversations/claude-code/2026/08/${n}`;

/** sessions: {name: [startIso, endIso, text]} · rows: agent-decision-log · decisions: the records under test */
function workspace({ sessions = {}, rows = {}, decisions = [] }) {
	const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-link-'));
	const D = path.join(vault, 'data');
	// Every stage runs inside a session and reads its contributor key off that record.
	{ const sp = path.join(path.join(D, 'perspective'), 'retrospective-sessions', `${BASE}.retrospective-session.md`);
	  fs.mkdirSync(path.dirname(sp), { recursive: true });
	  fs.writeFileSync(sp, fm({ contributor: SLUG, handles: ['dana.o@northwind.example'], started: BASE.slice(0, 10), stage: 'installed' })); }
	for (const [name, [from, to, text]] of Object.entries(sessions)) {
		const p = path.join(D, 'perspective', 'conversations', 'claude-code', '2026', '08', `${name}.conversation.md`);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, fm({ session_id: name, started_at: from, ended_at: to, title: text ?? '' }));
	}
	for (const [id, row] of Object.entries(rows)) {
		const p = path.join(D, 'agent-decision-log', `${id}.agent-decision.md`);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, fm({ name: id, ...row }));
	}
	for (const d of decisions) {
		const p = path.join(D, 'perspective', 'decisions', SLUG, `${d.id}.decision.md`);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		const { id, ...rest } = d;
		fs.writeFileSync(p, fm({ retrospective: REF, name: id, decided_on: '2026-08-16', ...rest }));
	}
	return vault;
}

const run = (vault, extra = []) => execFileSync('node', [BIN, '--retrospective', REF, '--data-root', path.join(vault, 'data'), ...extra], { encoding: 'utf8' });
const linked = (vault, id) => readRecord(path.join(vault, 'data', 'perspective', 'decisions', SLUG, `${id}.decision.md`)).fields.conversations;

test('an agent-session decision is copied straight across — no inference at all', () => {
	const vault = workspace({
		sessions: { aaa: ['2026-08-16T09:00:00.000Z', '2026-08-16T11:00:00.000Z', 'anything'] },
		decisions: [{ id: 'd1', source_kind: 'agent-session', source_ref: S('aaa') }],
	});
	const out = run(vault);
	assert.deepEqual(linked(vault, 'd1'), [S('aaa')]);
	assert.match(out, /direct 1/);
});

test('a log row written inside exactly one session window links to that session', () => {
	const vault = workspace({
		sessions: {
			aaa: ['2026-08-16T09:00:00.000Z', '2026-08-16T11:00:00.000Z', 'the one'],
			bbb: ['2026-08-16T14:00:00.000Z', '2026-08-16T15:00:00.000Z', 'later'],
		},
		rows: { r1: { decided: '2026-08-16T10:00:00.000Z', session: 'whatever' } },
		decisions: [{ id: 'd1', source_kind: 'decision-log', source_ref: 'agent-decision-log/r1' }],
	});
	const out = run(vault);
	assert.deepEqual(linked(vault, 'd1'), [S('aaa')]);
	assert.match(out, /contained 1/);
});

test('two concurrent sessions are separated by the row\'s own words, not by which started first', () => {
	const vault = workspace({
		sessions: {
			aaa: ['2026-08-16T09:00:00.000Z', '2026-08-16T12:00:00.000Z', 'refactoring the invoice parser'],
			bbb: ['2026-08-16T09:30:00.000Z', '2026-08-16T12:00:00.000Z', 'mapping personas and positioning'],
		},
		rows: { r1: { decided: '2026-08-16T10:00:00.000Z', session: 'mapping the personas around the product' } },
		decisions: [{ id: 'd1', source_kind: 'decision-log', source_ref: 'agent-decision-log/r1' }],
	});
	const out = run(vault);
	assert.deepEqual(linked(vault, 'd1'), [S('bbb')], 'the later-starting session wins on overlap');
	assert.match(out, /disambiguated 1/);
});

test('two concurrent sessions that the words cannot separate stay EMPTY and are reported', () => {
	const vault = workspace({
		sessions: {
			aaa: ['2026-08-16T09:00:00.000Z', '2026-08-16T12:00:00.000Z', 'shared vocabulary here'],
			bbb: ['2026-08-16T09:30:00.000Z', '2026-08-16T12:00:00.000Z', 'shared vocabulary here'],
		},
		rows: { r1: { decided: '2026-08-16T10:00:00.000Z', session: 'shared vocabulary here' } },
		decisions: [{ id: 'd1', source_kind: 'decision-log', source_ref: 'agent-decision-log/r1' }],
	});
	const out = run(vault);
	assert.equal(linked(vault, 'd1'), undefined);
	assert.match(out, /ambiguous 1/);
	assert.match(out, /ambiguous {2}d1 — 2 concurrent sessions/);
});

test('a hand-written DECISION-LOG.md row is never linked — there is no session behind it', () => {
	const vault = workspace({
		sessions: { aaa: ['2026-08-16T09:00:00.000Z', '2026-08-16T23:00:00.000Z', 'a session that day'] },
		decisions: [{ id: 'd1', source_kind: 'decision-log', source_ref: 'DECISION-LOG.md#310' }],
	});
	const out = run(vault);
	assert.equal(linked(vault, 'd1'), undefined, 'a nearest-in-time guess is exactly what must not happen');
	assert.match(out, /not-a-session 1/);
});

test('a commit-sourced decision is left alone even when a session was open at the time', () => {
	const vault = workspace({
		sessions: { aaa: ['2026-08-16T09:00:00.000Z', '2026-08-16T23:00:00.000Z', 'a session that day'] },
		decisions: [{ id: 'd1', source_kind: 'git-commit', source_ref: 'a1b2c3d4' }],
	});
	assert.equal(linked(vault, 'd1'), undefined);
	assert.match(run(vault), /not-a-session 1/);
});

test('a log row outside every window is reported as no-window rather than snapped to the nearest', () => {
	const vault = workspace({
		sessions: { aaa: ['2026-08-16T09:00:00.000Z', '2026-08-16T11:00:00.000Z', 'x'] },
		rows: { r1: { decided: '2026-08-16T13:00:00.000Z', session: 'x' } },
		decisions: [{ id: 'd1', source_kind: 'decision-log', source_ref: 'agent-decision-log/r1' }],
	});
	const out = run(vault);
	assert.equal(linked(vault, 'd1'), undefined);
	assert.match(out, /no-window 1/);
});

test('a link already on the record is never overwritten, and --dry-run writes nothing', () => {
	const vault = workspace({
		sessions: {
			aaa: ['2026-08-16T09:00:00.000Z', '2026-08-16T11:00:00.000Z', 'invoice parser work'],
			bbb: ['2026-08-16T09:00:00.000Z', '2026-08-16T11:00:00.000Z', 'persona mapping'],
		},
		rows: { r1: { decided: '2026-08-16T10:00:00.000Z', session: 'invoice parser work' }, r2: { decided: '2026-08-16T10:00:00.000Z', session: 'invoice parser work' } },
		decisions: [
			{ id: 'd1', source_kind: 'decision-log', source_ref: 'agent-decision-log/r1', conversations: [S('bbb')] },
			{ id: 'd2', source_kind: 'decision-log', source_ref: 'agent-decision-log/r2' },
		],
	});
	const dry = run(vault, ['--dry-run']);
	assert.match(dry, /already set 1/);
	assert.match(dry, /DRY RUN, nothing written/);
	assert.equal(linked(vault, 'd2'), undefined, 'dry run must not write');
	run(vault);
	assert.deepEqual(linked(vault, 'd1'), [S('bbb')], 'the person\'s link survives');
	assert.deepEqual(linked(vault, 'd2'), [S('aaa')], 'and the empty one is filled');
});
