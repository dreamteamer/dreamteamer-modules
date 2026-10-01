// The two holes this pass closes, pinned: a follower on a ticket becomes a collaborator (the reader
// only ever wrote the assignee), and an activity gets `collaborators` from the evidence it cites
// (nothing attached them, so a workspace had 25 collaborators and 0 activities naming one).
// Plus the two refusals: the contributor is never their own collaborator, and a bare display name
// is not a person key.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { recordPath, writeRecord, readRecord } from '../../skills/running-retrospectives/lib/records.mjs';

const BIN = fileURLToPath(new URL('../../skills/running-retrospectives/bin/derive-collaborators.mjs', import.meta.url));
const BASE = '2026-09-08--fx', REF = `perspective/retrospective-sessions/${BASE}`;
const SLUG = 'fx';   // the contributor — evidence and model ids are keyed by it, not by the run
const ME = 'me@acme.example';

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'derive-'));
	const data = path.join(root, 'data');
	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data), { contributor: SLUG, handles: [ME], started: '2026-09-08' });
	writeRecord(recordPath('tickets', `${SLUG}/asana--1`, 'ticket', data), {
		source: `perspective/sources/${SLUG}/asana--acme`, external_id: '1', title: 'Spec the thing',
		created_on: '2026-03-02', assignee_handle: ME, followers: [ME, 'ann@acme.example', 'bo@acme.example'],
	});
	writeRecord(recordPath('activities', `${SLUG}/2026-03-02--spec-the-thing`, 'activity', data), {
		retrospective: REF, name: 'Spec the thing', started: '2026-03-02',
		tickets: [`perspective/tickets/${SLUG}/asana--1`],
	});
	writeRecord(recordPath('activities', `${SLUG}/2026-04-01--alone`, 'activity', data), {
		retrospective: REF, name: 'Alone', started: '2026-04-01', collaborative: true,
	});
	// A second ticket, assigned to somebody else — so the assignee stamp has to resolve two different
	// people and not just echo the contributor onto everything.
	writeRecord(recordPath('tickets', `${SLUG}/asana--2`, 'ticket', data), {
		source: `perspective/sources/${SLUG}/asana--acme`, external_id: '2', title: 'Ship the thing',
		created_on: '2026-03-09', assignee_handle: 'cy@acme.example',
	});
	// And a third with NO assignee at all — Asana allows it, and an unassigned ticket must not
	// acquire a person.
	writeRecord(recordPath('tickets', `${SLUG}/asana--3`, 'ticket', data), {
		source: `perspective/sources/${SLUG}/asana--acme`, external_id: '3', title: 'Unassigned',
		created_on: '2026-03-10',
	});
	return { root, data };
}
const run = (data, root) => execFileSync('node', [BIN, '--retrospective', REF, '--data-root', data, '--scratch-root', path.join(root, 'scratch')], { encoding: 'utf8' });
const activity = (data, id) => readRecord(recordPath('activities', `${SLUG}/${id}`, 'activity', data)).fields;

test('a ticket FOLLOWER becomes a collaborator and lands on the activity that cites the ticket', () => {
	const { root, data } = fixture();
	run(data, root);
	const a = activity(data, '2026-03-02--spec-the-thing');
	assert.deepEqual(a.collaborators, [
		`perspective/users/${SLUG}/ann-acme-example`,
		`perspective/users/${SLUG}/bo-acme-example`,
	]);
	assert.equal(a.collaborative, true);
	assert.equal(readRecord(recordPath('users', `${SLUG}/ann-acme-example`, 'user', data)).fields.roles_observed[0], 'follower');
});

test('the contributor is never their own collaborator, and an activity with no counterpart is not collaborative', () => {
	const { root, data } = fixture();
	run(data, root);
	const a = activity(data, '2026-03-02--spec-the-thing');
	assert.ok(!a.collaborators.some((r) => r.includes('me-acme-example')), 'the contributor must not be attached to their own work');
	const solo = activity(data, '2026-04-01--alone');
	assert.equal(solo.collaborative, false, 'a stale collaborative:true is corrected, not left standing');
	assert.equal(solo.collaborators, undefined);
});

test('re-running attaches the same set — every activity unchanged the second time', () => {
	const { root, data } = fixture();
	run(data, root);
	const out = run(data, root);
	assert.match(out, /activities touched 0, unchanged 2/);
});

test('a bare display name is not a person key', () => {
	const { root, data } = fixture();
	writeRecord(recordPath('tickets', `${SLUG}/asana--2`, 'ticket', data), {
		source: `perspective/sources/${SLUG}/asana--acme`, external_id: '2', title: 'Named, not keyed',
		created_on: '2026-03-03', assignee_handle: ME, followers: ['Some Person'],
	});
	run(data, root);
	assert.ok(!fs.existsSync(recordPath('users', `${SLUG}/some-person`, 'user', data)));
});

test('a collaborator a person typed by hand survives a run that cannot re-derive it', () => {
	// The pass is a derivation, and a derivation may add what the evidence proves and correct the
	// flag — it may never delete what it merely failed to find. A dogfood workspace had 108
	// hand-attached activities when this was written; a replacing run would have emptied most of them.
	const { root, data } = fixture();
	const file = recordPath('activities', `${SLUG}/2026-03-02--spec-the-thing`, 'activity', data);
	const held = readRecord(file);
	writeRecord(file, { ...held.fields, collaborators: [`perspective/users/${SLUG}/typed-by-hand`], collaborative: true }, held.body);
	run(data, root);
	const after = activity(data, '2026-03-02--spec-the-thing');
	assert.ok(after.collaborators.includes(`perspective/users/${SLUG}/typed-by-hand`), 'the hand-written ref is kept');
	assert.ok(after.collaborators.includes(`perspective/users/${SLUG}/ann-acme-example`), 'and the derived one is added beside it');
	assert.equal(after.collaborators.length, 3);
});

// ── the ticket→person relation, which nothing wrote ──────────────────────────────────────────────
// `tickets.assignee` carries `x-inverse: tickets`, so `collaborators.tickets` is a generated mirror
// of it. `read-asana` writes `assignee_handle` — the raw email — and never the typed reference, so
// on a real workspace 935 tickets had an assignee's ADDRESS and no assignee, and every collaborator
// board showed zero tickets. The handle→ref map this pass already builds for activities is the same
// map that resolves it.
const ticket = (data, id) => readRecord(recordPath('tickets', `${SLUG}/${id}`, 'ticket', data)).fields;

test('a ticket gets its assignee reference resolved from the handle the reader stored', () => {
	const { root, data } = fixture();
	run(data, root);
	const mine = ticket(data, 'asana--1');
	assert.match(String(mine.assignee), /^perspective\/users\/fx\//, `assignee not set: ${JSON.stringify(mine.assignee)}`);
	assert.equal(mine.assignee_handle, ME, 'the handle stays — it is what the source said');
});

test('a ticket assigned to someone else resolves to THEM, not to the contributor', () => {
	const { root, data } = fixture();
	run(data, root);
	const mine = ticket(data, 'asana--1');
	const theirs = ticket(data, 'asana--2');
	assert.ok(theirs.assignee, 'no assignee on the second ticket');
	assert.notEqual(theirs.assignee, mine.assignee, 'both tickets resolved to one person');
});

test('an UNASSIGNED ticket acquires no person', () => {
	const { root, data } = fixture();
	run(data, root);
	assert.equal(ticket(data, 'asana--3').assignee, undefined,
		'a reference at a record that does not exist is worse than an empty field, and dt check refuses it either way');
});

test('every assignee the tickets show ends up with a collaborator record to point at', () => {
	// Not a hole: pass 1 already meets each assignee as a person on the evidence and upserts them, so
	// by the time the stamp runs the record it needs exists. The `unresolvable` counter on the receipt
	// is for a handle that appears in a shape the collaborator sweep did not index — worth reporting
	// rather than silently skipping, which is why it is counted at all.
	const { root, data } = fixture();
	const out = run(data, root);
	assert.match(out, /ticket assignees stamped \d+/);
	assert.match(out, /unresolvable 0/, `something did not resolve:\n${out}`);
});

test('stamping the assignee twice changes nothing', () => {
	const { root, data } = fixture();
	run(data, root);
	const first = fs.readFileSync(recordPath('tickets', `${SLUG}/asana--1`, 'ticket', data), 'utf8');
	run(data, root);
	assert.equal(fs.readFileSync(recordPath('tickets', `${SLUG}/asana--1`, 'ticket', data), 'utf8'), first);
});

// ── an upsert that cannot heal its own record ────────────────────────────────────────────────────
// ⚠ `upsertCollaborators`' update path spreads `...hit.fields` and adds only what it derived. A
// record written before `contributor` and `retrospective` were REQUIRED therefore stays invalid for
// ever: every re-read matches it, merges handles into it, and leaves it failing `check`. Twelve
// collaborators on one real workspace were in exactly that state, and no amount of re-running could
// fix them (a client workspace, 2026-09-10).
//
// This is the same shape as the reader bug it sits beside — a field the pipeline requires and no
// code path writes — except here the code path exists and declines to run on the records that need
// it most.
test('an upsert heals a record that predates the required fields', () => {
	const { root, data } = fixture();
	// A collaborator as an older release would have left it: no contributor, no retrospective.
	const stale = recordPath('users', `${SLUG}/ann`, 'user', data);
	fs.mkdirSync(path.dirname(stale), { recursive: true });
	fs.writeFileSync(stale, '---\nname: ann\nhandles:\n  - ann@acme.example\nevidence_count: 1\n---\n');

	run(data, root);

	const healed = readRecord(stale).fields;
	assert.equal(healed.contributor, SLUG, 'the id it is filed under is the contributor; an upsert that matched it must say so');
	assert.equal(healed.retrospective, REF, 'required on all nineteen collections since 0.2.0');
	assert.ok((healed.handles ?? []).some((h) => String(h).toLowerCase() === 'ann@acme.example'), 'and it still merged rather than replaced');
});
