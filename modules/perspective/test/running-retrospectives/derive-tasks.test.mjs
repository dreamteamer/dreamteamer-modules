// derive-tasks — a ticket becomes a MODELLED COMMITMENT, mechanically.
//
// ⚠ WHAT THIS CLOSES. A ticket is EVIDENCE, the same tier as an `activity-weeks` record: read,
// counted, never judged. Until `perspective/world/tasks` existed that half of the evidence
// dead-ended — a measured consumer workspace held 933 ticket records and nothing in the module ever
// turned one into anything, so "what did this person actually OWE" had no answer while the data to
// answer it sat on disk. This pass is the hop, and it is mechanical on purpose: everything on a task
// is on the ticket already, and the two joins come from whichever clustered activity cites it.
//
// Every fixture here is authored in this file and synthetic.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { recordPath, writeRecord, readRecord } from '../../skills/running-retrospectives/lib/records.mjs';

const BIN = fileURLToPath(new URL('../../skills/running-retrospectives/bin/derive-tasks.mjs', import.meta.url));
const BASE = '2026-09-08--fx', REF = `perspective/retrospective-sessions/${BASE}`;
const SLUG = 'fx';
const ME = 'me@acme.example';

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'derive-tasks-'));
	const data = path.join(root, 'data');
	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data),
		{ contributor: SLUG, handles: [ME], started: '2026-09-08' });

	// Two tickets an activity cites, and one it does not.
	writeRecord(recordPath('tickets', `${SLUG}/asana--1`, 'ticket', data), {
		retrospective: REF, contributor: SLUG, source: `perspective/sources/${SLUG}/asana--acme`,
		external_id: '1', title: 'Spec the thing', status: 'completed',
		created_on: '2026-03-02', completed_on: '2026-03-06', due_on: '2026-03-05',
		assignee: `perspective/world/users/${SLUG}/dana-oren`, assignee_handle: ME, tags: ['spec'],
	}, 'What the ticket said.\n');
	writeRecord(recordPath('tickets', `${SLUG}/asana--2`, 'ticket', data), {
		retrospective: REF, contributor: SLUG, source: `perspective/sources/${SLUG}/asana--acme`,
		external_id: '2', title: 'Ship the thing', status: 'open', created_on: '2026-03-09',
	});
	writeRecord(recordPath('tickets', `${SLUG}/asana--9`, 'ticket', data), {
		retrospective: REF, contributor: SLUG, source: `perspective/sources/${SLUG}/asana--acme`,
		external_id: '9', title: 'Something nobody clustered', created_on: '2025-01-01',
	});

	writeRecord(recordPath('world/activities', `${SLUG}/2026-03-02--spec-the-thing`, 'activity', data), {
		retrospective: REF, contributor: SLUG, name: 'Spec the thing', started: '2026-03-02',
		project: `perspective/world/projects/${SLUG}/delivery`,
		tickets: [`perspective/tickets/${SLUG}/asana--1`, `perspective/tickets/${SLUG}/asana--2`],
	});
	return { root, data };
}

const run = (data, extra = []) => execFileSync(process.execPath,
	[BIN, '--retrospective', REF, '--data-root', data, ...extra], { encoding: 'utf8' });
const task = (data, id) => readRecord(recordPath('world/tasks', `${SLUG}/${id}`, 'task', data)).fields;

test('every ticket becomes one task, keyed by the ticket it was read from', () => {
	const { data } = fixture();
	const out = run(data);
	assert.match(out, /3 ticket\(s\) → 3 task\(s\) written/);
	// The id's second segment IS the external id — the descriptor generates it from
	// `{{ ticket | basename }}`, so the two can never disagree and a re-run cannot fork.
	assert.equal(task(data, '1').ticket, `perspective/tickets/${SLUG}/asana--1`);
	assert.equal(task(data, '1').name, 'Spec the thing');
	assert.equal(task(data, '1').contributor, SLUG);
	assert.equal(task(data, '1').retrospective, REF);
});

test('the joins come from the activity that cites the ticket, never from a date', () => {
	const { data } = fixture();
	run(data);
	assert.equal(task(data, '1').activity, `perspective/world/activities/${SLUG}/2026-03-02--spec-the-thing`);
	assert.equal(task(data, '1').project, `perspective/world/projects/${SLUG}/delivery`);
	assert.equal(task(data, '2').activity, `perspective/world/activities/${SLUG}/2026-03-02--spec-the-thing`);
});

test('a ticket no clustered activity cites gets a task with no joins, and the receipt COUNTS it', () => {
	// ⚠ A fact about the clustering window, not about the person — so it is stated rather than hidden.
	const { data } = fixture();
	const out = run(data);
	assert.match(out, /1 with no clustered activity/);
	assert.equal(task(data, '9').activity, undefined);
	assert.equal(task(data, '9').project, undefined);
});

test('status is the source\'s own, mapped to the three values evidence can carry', () => {
	const { data } = fixture();
	run(data);
	assert.equal(task(data, '1').status, 'done', 'a completed ticket');
	assert.equal(task(data, '2').status, 'open');
	assert.equal(task(data, '9').status, 'unknown', 'a source with no status says nothing, and `unknown` is honest');
});

test('the dates and the assignee are carried across, never re-derived', () => {
	const { data } = fixture();
	run(data);
	const t = task(data, '1');
	assert.equal(t.created_on, '2026-03-02');
	assert.equal(t.due_on, '2026-03-05');
	assert.equal(t.completed_on, '2026-03-06');
	// The handle match happens ONCE, in the reader — so one person cannot become two between tiers.
	assert.equal(t.assignee, `perspective/world/users/${SLUG}/dana-oren`);
	assert.deepEqual(t.tags, ['spec']);
});

test('it NEVER sets `real` — the join to the workspace\'s own tasks is a person\'s judgement', () => {
	const { data } = fixture();
	run(data);
	for (const id of ['1', '2', '9']) assert.equal(task(data, id).real, undefined);
});

test('a second run writes nothing — the pass is idempotent', () => {
	const { data } = fixture();
	run(data);
	const out = run(data);
	assert.match(out, /0 task\(s\) written, 3 unchanged/);
});

test('--dry-run writes no file at all', () => {
	const { data } = fixture();
	const out = run(data, ['--dry-run']);
	assert.match(out, /dry run — nothing written/);
	assert.ok(!fs.existsSync(path.join(data, 'perspective', 'world', 'tasks')));
});

test('a bad --retrospective exits 2 rather than guessing', () => {
	const { data } = fixture();
	assert.throws(() => execFileSync(process.execPath, [BIN, '--data-root', data], { encoding: 'utf8', stdio: 'pipe' }),
		(e) => e.status === 2);
});
