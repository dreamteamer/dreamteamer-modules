// read-asana's promise: ONE contributor's Asana tasks become tickets, and the identities they
// appear under accumulate on a collaborator without ever duplicating. The fixture holds four tasks
// on purpose — a reader that writes the workspace's tasks rather than the CONTRIBUTOR's writes four.
// `--fixture` swaps the three HTTP calls for three JSON files of the same shape (`{data:[…]}`), so
// this runs offline and no token is needed; the live path is smoked by hand against the real API.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRecord, listRecords, writeRecord, recordPath } from '../../skills/running-retrospectives/lib/records.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', '..', 'skills', 'running-retrospectives', 'bin', 'read-asana.mjs');
const RETROSPECTIVE = 'perspective/retrospective-sessions/2026-09-07--fx';
const BASE = RETROSPECTIVE.split('/').pop();
const SLUG = 'fx';   // the contributor — evidence and model ids key on it, not on the run

/** Two users, four tasks: three the contributor's (one completed, one a subtask), one somebody else's. */
function fixtureDir() {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-asana-'));
	const fx = path.join(tmp, 'fixture');
	fs.mkdirSync(fx);
	const dev = { gid: '1111', name: 'Dev Example', email: 'dev@example.test' };
	const other = { gid: '2222', name: 'Other Person', email: 'other@example.test' };
	const write = (n, data) => fs.writeFileSync(path.join(fx, n), JSON.stringify({ data }, null, 2));
	write('workspaces.json', [{ gid: '9001', name: 'Acme Workspace' }]);
	write('users.json', [dev, other]);
	write('tasks.json', [
		{
			gid: '5001', name: 'Ship the reader', created_at: '2026-08-03T09:00:00.000Z',
			completed: false, due_on: '2026-09-01', notes: 'the parent task',
			memberships: [{ project: { name: 'Platform' }, section: { name: 'In Progress' } }],
			tags: [{ name: 'Backend' }], permalink_url: 'https://app.asana.com/0/9001/5001', assignee: dev,
			// `other` is a FOLLOWER here and never an assignee — the case that produced one
			// collaborator (the contributor) on a board of self-assigned tickets.
			followers: [dev, other],
		},
		{
			gid: '5002', name: 'Write its test', created_at: '2026-08-05T09:00:00.000Z',
			completed: false, parent: { gid: '5001' },
			memberships: [{ project: { name: 'Platform' }, section: { name: 'In Progress' } }],
			permalink_url: 'https://app.asana.com/0/9001/5002', assignee: dev,
		},
		{
			gid: '5003', name: 'Draft the design', created_at: '2026-08-10T09:00:00.000Z',
			completed: true, completed_at: '2026-08-20T12:30:00.000Z', notes: 'the body carries the notes',
			memberships: [{ project: { name: 'Platform' }, section: { name: 'Done' } }],
			tags: [{ name: 'Design' }, { name: 'Docs' }],
			permalink_url: 'https://app.asana.com/0/9001/5003', assignee: dev,
		},
		{
			gid: '5004', name: 'Somebody else’s task', created_at: '2026-08-11T09:00:00.000Z',
			completed: false, memberships: [{ project: { name: 'Platform' } }],
			permalink_url: 'https://app.asana.com/0/9001/5004', assignee: other,
		},
	]);
	return { tmp, fx };
}

const run = (fx, data, extra = []) =>
	execFileSync('node', [BIN, '--retrospective', RETROSPECTIVE, '--contributor', 'dev@example.test',
	                      '--fixture', fx, '--data-root', data, ...extra], { encoding: 'utf8' });

const tickets = (data) => Object.fromEntries(listRecords(path.join(data, 'perspective', 'tickets'))
	.map((f) => { const r = readRecord(f); return [r.fields.external_id, r]; }));

test('writes only the contributor’s tasks as tickets, one source, and every person on them', () => {
	const { tmp, fx } = fixtureDir();
	const data = path.join(tmp, 'data');
	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data), { contributor: SLUG, handles: ['dana.o@northwind.example'], started: BASE.slice(0, 10), stage: 'installed' });
	// Every stage runs inside a session, and reads its contributor key off that record.
	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data), { contributor: SLUG, handles: ['dana.o@northwind.example'], started: BASE.slice(0, 10), stage: 'installed' });
	const out = run(fx, data);
	assert.match(out, /✔ asana Acme Workspace · user Dev Example · tasks 3 \(open 2 · completed 1\) · collaborators \+2 \(=1 existing\)/);   // the assignee AND the follower who assigned nothing

	const t = tickets(data);
	assert.deepEqual(Object.keys(t).sort(), ['5001', '5002', '5003'], 'the fourth task belongs to somebody else');
	assert.equal(fs.existsSync(path.join(data, 'perspective', 'tickets', SLUG, 'asana--acme-workspace', '5001.ticket.md')), true);

	const parent = t['5001'].fields;
	assert.equal(parent.source, `perspective/sources/${SLUG}/asana--acme-workspace`);
	assert.equal(parent.title, 'Ship the reader');
	assert.equal(parent.project, 'Platform');
	assert.equal(parent.section, 'In Progress');
	assert.equal(parent.assignee_handle, 'dev@example.test', 'the email is the handle when the system gives one');
	assert.equal(parent.status, 'open');
	assert.equal(parent.created_on, '2026-08-03');
	assert.equal(parent.due_on, '2026-09-01');
	assert.deepEqual(parent.tags, ['backend'], 'tags are lowercased');
	assert.equal(parent.url, 'https://app.asana.com/0/9001/5001');
	assert.equal(parent.parent_external_id, undefined);

	assert.equal(t['5002'].fields.parent_external_id, '5001', 'a subtask points at its parent');

	const done = t['5003'];
	assert.equal(done.fields.status, 'completed');
	assert.equal(done.fields.completed_on, '2026-08-20');
	assert.match(done.body, /the body carries the notes/);

	const sources = listRecords(path.join(data, 'perspective', 'sources')).map((f) => readRecord(f).fields);
	assert.equal(sources.length, 1);
	assert.equal(sources[0].kind, 'asana');
	assert.equal(sources[0].reach, 'available');
	assert.equal(sources[0].label, 'Acme Workspace');
	assert.deepEqual(sources[0].retrospectives, [RETROSPECTIVE], 'sources is m2m with the run — the list, never a scalar');
	assert.equal(sources[0].contributor, SLUG, 'the id this record is filed under begins with it');
	assert.equal(sources[0].read_with, 'read-asana@2');
	assert.deepEqual(sources[0].counts, { users: 2, tasks: 3, with_description: 2, with_comments: 0 });

	const collabs = listRecords(path.join(data, 'perspective', 'world', 'users')).map((f) => readRecord(f).fields);
	assert.equal(collabs.length, 2, 'every person on the kept evidence — the assignee and the follower');
	const dev = collabs.find((c) => c.handles.includes('dev@example.test'));
	assert.equal(dev.retrospective, RETROSPECTIVE);
	assert.equal(dev.name, 'Dev Example');
	for (const h of ['dev@example.test', '1111', 'Dev Example']) assert.ok(dev.handles.includes(h), `handles must carry ${h}`);
	assert.equal(dev.evidence_count, 3);
	assert.equal(dev.first_seen, '2026-08-03');
	assert.equal(dev.last_seen, '2026-08-10');
	assert.deepEqual(dev.roles_observed, ['assignee', 'follower'], 'the contributor follows their own task');
	assert.deepEqual(dev.sources, [`perspective/sources/${SLUG}/asana--acme-workspace`]);

	fs.rmSync(tmp, { recursive: true, force: true });
});

// Idempotence is the whole point of the reader: /run-retrospective re-runs every stage, so a second
// pass must find the collaborator, not mint a second one — and must not append its handles again.
test('a second run adds no collaborator and no duplicate handle', () => {
	const { tmp, fx } = fixtureDir();
	const data = path.join(tmp, 'data');
	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data), { contributor: SLUG, handles: ['dana.o@northwind.example'], started: BASE.slice(0, 10), stage: 'installed' });
	run(fx, data);
	const first = listRecords(path.join(data, 'perspective', 'world', 'users')).map((f) => readRecord(f).fields);
	const out = run(fx, data);
	assert.match(out, /collaborators \+0 \(=[23] existing\)/);   // matched once per role it is seen in
	const second = listRecords(path.join(data, 'perspective', 'world', 'users')).map((f) => readRecord(f).fields);
	assert.equal(second.length, first.length, 'no second record for the same person');
	const me = (rows) => rows.find((r) => (r.handles ?? []).some((h) => String(h).toLowerCase() === 'dev@example.test'));
	assert.deepEqual(me(second).handles, me(first).handles, 'handles are a set, not a log');
	assert.equal(me(second).handles.length, new Set(me(second).handles).size);
	assert.equal(me(second).evidence_count, 3, 'the count is the state, not an increment');
	assert.equal(Object.keys(tickets(data)).length, 3);
	fs.rmSync(tmp, { recursive: true, force: true });
});

test('--since filters on created_at, and an unknown contributor exits 2 without writing', () => {
	const { tmp, fx } = fixtureDir();
	const data = path.join(tmp, 'data');
	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data), { contributor: SLUG, handles: ['dana.o@northwind.example'], started: BASE.slice(0, 10), stage: 'installed' });
	const out = run(fx, data, ['--since', '2026-08-06']);
	assert.match(out, /tasks 1 \(open 0 · completed 1\)/);
	assert.deepEqual(Object.keys(tickets(data)), ['5003']);

	const r = spawnSync('node', [BIN, '--retrospective', RETROSPECTIVE, '--contributor', 'nobody@example.test',
	                             '--fixture', fx, '--data-root', path.join(tmp, 'data2')], { encoding: 'utf8' });
	assert.equal(r.status, 2, r.stderr);
	assert.match(r.stderr, /nobody@example\.test/);
	assert.equal(fs.existsSync(path.join(tmp, 'data2')), false, 'a failed resolve writes nothing');
	fs.rmSync(tmp, { recursive: true, force: true });
});

// @2 — the ticket body. Measured on a real board: 344 of 933 tasks have an EMPTY description, so a
// ticket whose body is only `notes` says nothing about how the work went, and 344 blank bodies is
// what a reader that stops at `notes` produces.
test('a task with no description still gets a body that says so — never a blank one', () => {
	const { tmp, fx } = fixtureDir();
	const data = path.join(tmp, 'data');
	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data), { contributor: SLUG, handles: ['dana.o@northwind.example'], started: BASE.slice(0, 10), stage: 'installed' });
	// 5002 is the subtask, and it is the one with no notes.
	run(fx, data);
	const t = tickets(data);
	assert.match(t['5002'].body, /_No description on the task\._/, 'the absence is stated');
	assert.match(t['5003'].body, /the body carries the notes/, 'and a real description still leads');
	fs.rmSync(tmp, { recursive: true, force: true });
});

test('followers, custom fields and modified_at land; a custom field with no display value is dropped', () => {
	const { tmp, fx } = fixtureDir();
	// enrich one task the way the live API returns it
	const tasksFile = path.join(fx, 'tasks.json');
	const parsed = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
	const target = parsed.data.find((x) => x.gid === '5001');
	target.modified_at = '2026-08-29T11:00:00.000Z';
	target.num_subtasks = 1;
	target.followers = [{ name: 'A Watcher', email: 'watcher@example.test' }, { name: 'No Email' }];
	target.custom_fields = [{ name: 'Story Points', display_value: '3' }, { name: 'Sprint', display_value: null }];
	fs.writeFileSync(tasksFile, JSON.stringify(parsed, null, 2));

	const data = path.join(tmp, 'data');
	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data), { contributor: SLUG, handles: ['dana.o@northwind.example'], started: BASE.slice(0, 10), stage: 'installed' });
	run(fx, data);
	const { fields } = tickets(data)['5001'];
	assert.equal(fields.last_activity_on, '2026-08-29');
	assert.equal(fields.subtask_count, 1);
	assert.deepEqual(fields.followers, ['watcher@example.test', 'No Email'], 'a follower with no email falls back to a name');
	assert.deepEqual(fields.custom_fields, { 'Story Points': '3' }, 'a field with no display value is dropped, never written as null');
	fs.rmSync(tmp, { recursive: true, force: true });
});

// The fixture path has no server, so trails cannot be read there. The receipt must SAY that rather
// than reporting a clean run over evidence it never fetched.
test('the receipt says when the trail was not read', () => {
	const { tmp, fx } = fixtureDir();
	const data = path.join(tmp, 'data');
	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data), { contributor: SLUG, handles: ['dana.o@northwind.example'], started: BASE.slice(0, 10), stage: 'installed' });
	const out = run(fx, data);
	assert.match(out, /trails NOT read/);
	fs.rmSync(tmp, { recursive: true, force: true });
});

test('a FOLLOWER who is never an assignee still becomes a collaborator', () => {
	// The hole this closes: a contributor who assigns every ticket to themselves came out of a full
	// run with exactly one collaborator — themselves — while the tasks named their counterparts in
	// `followers` the whole time.
	const { tmp, fx } = fixtureDir();
	const data = path.join(tmp, 'data');
	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data), { contributor: SLUG, handles: ['dana.o@northwind.example'], started: BASE.slice(0, 10), stage: 'installed' });
	run(fx, data);
	const people = listRecords(path.join(data, 'perspective', 'world', 'users')).map((f) => readRecord(f).fields);
	const them = people.find((p) => (p.handles ?? []).some((h) => String(h).toLowerCase() === 'other@example.test'));
	assert.ok(them, 'a follower who assigned nothing is still someone this contributor worked with');
	assert.deepEqual(them.roles_observed, ['follower']);
	assert.equal(them.name, 'Other Person', 'the reader has the display name — only the derive pass has to settle for an address');
	const me = people.find((p) => (p.handles ?? []).some((h) => String(h).toLowerCase() === 'dev@example.test'));
	assert.deepEqual(me.roles_observed.slice().sort(), ['assignee', 'follower']);
});
