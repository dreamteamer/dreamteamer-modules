// The workspace's own `meetings` collection as evidence. What this pins is half what the reader
// COUNTS and half what it REFUSES: no summary, prep or analysis text reaches any record; an attendee
// with no email gets no collaborator, and the receipt says so rather than swallowing the gap; a
// meeting the contributor is not on is not theirs, however close it sits on the calendar.
//
// The fixture is the synthetic cast: Dana Oren at Northwind, Sam Diaz at Bright, Priya Raman at
// Harbor Mutual, and a lead called Finpath.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { readRecord, writeRecord, recordPath, listRecords } from '../lib/records.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'read-meetings.mjs');
const COLLECTIONS = path.join(HERE, '..', '..', '..', 'collections', 'perspective');

const BASE = '2026-09-09--dana-o';
const REF = `perspective/retrospective-sessions/${BASE}`;
const SLUG = 'dana-o';
const DANA = 'dana.o@northwind.example';
const SAM = 'sam.d@bright.example';
const PRIYA = 'priya.r@harbormutual.example';
/** A word that exists ONLY inside meeting bodies and judged fields. If it turns up in a perspective
 *  record, the reader copied a judgement onto the evidence rung. */
const JUDGED = 'the-quick-brown-fox-nobody-should-copy';

function fixture({ withMeetings = true } = {}) {
	const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-meetings-'));
	const data = path.join(ws, 'data');
	const scratch = path.join(ws, '.perspective');

	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data),
		{ contributor: SLUG, handles: [DANA], started: '2026-09-09', stage: 'inventoried' });

	const contact = (id, name, email) => writeRecord(
		path.join(data, 'contacts', `${id}.contact.md`),
		{ name, ...(email ? { email } : {}), status: 'enriched' },
		`${name} of the synthetic cast.\n`,
	);
	contact('dana-oren', 'Dana Oren', DANA);
	contact('sam-diaz', 'Sam Diaz', SAM);
	contact('priya-raman', 'Priya Raman', PRIYA);
	// ⚠ NO EMAIL. A display name is not a person key, so this attendee must yield no collaborator.
	contact('nick-no-email', 'Nick Noemail', '');

	if (!withMeetings) return { ws, data, scratch };

	const meeting = (id, fields, body) => writeRecord(path.join(data, 'meetings', `${id}.meeting.md`), fields, body);

	// 1. The contributor is an ATTENDEE REF. One hour, one counterpart.
	meeting('2026/08/2026-08-03--10-00--northwind--weekly-sync', {
		name: 'Weekly sync', starts: '2026-08-03T10:00:00+03:00', ends: '2026-08-03T11:00:00+03:00',
		company: 'companies/northwind', attendees: ['contacts/dana-oren', 'contacts/sam-diaz'],
		attendees_raw: ['Dana Oren <dana.o@northwind.example>', 'Sam Diaz <sam.d@bright.example>'],
		// The judged artefacts another module owns. Their REFS are fine; their content is not this
		// reader's to touch, and neither is this body.
		summary: 'meeting-summaries/2026-08-03--northwind-weekly-sync',
		origin: 'calendar',
	}, `# Weekly sync\n\n${JUDGED} — a note somebody wrote on the call.\n`);

	// 2. Three attendees, one of them unkeyable. Thirty minutes, same ISO week as #1.
	meeting('2026/08/2026-08-04--09-30--harbor-mutual--discovery-call', {
		name: 'Discovery call', starts: '2026-08-04T09:30:00+03:00', ends: '2026-08-04T10:00:00+03:00',
		company: 'companies/harbor-mutual',
		attendees: ['contacts/dana-oren', 'contacts/priya-raman', 'contacts/nick-no-email'],
		origin: 'calendar',
	}, `A discovery call. ${JUDGED}\n`);

	// 3. NO `attendees` at all — the contributor is only in the free-text list. A calendar sync that
	//    never resolved its attendees to contacts is the normal state of a fresh workspace.
	meeting('2026/08/2026-08-20--14-00--harbor-mutual--review', {
		name: 'Quarterly review', starts: '2026-08-20T14:00:00+03:00', ends: '2026-08-20T14:45:00+03:00',
		company: 'companies/harbor-mutual',
		attendees_raw: ['Dana Oren <dana.o@northwind.example>', 'Priya Raman <priya.r@harbormutual.example>'],
		origin: 'calendar',
	}, '');

	// 4. NOT the contributor's. Same week as #1, and it must not appear anywhere.
	meeting('2026/08/2026-08-05--16-00--finpath--pitch', {
		name: 'Finpath pitch', starts: '2026-08-05T16:00:00+03:00', ends: '2026-08-05T17:00:00+03:00',
		company: 'companies/finpath', attendees: ['contacts/sam-diaz'], origin: 'calendar',
	}, '');

	// 5. No `ends`. The minutes are UNKNOWABLE, which is absent and not zero.
	meeting('2026/08/2026-08-24--11-00--northwind--open-ended', {
		name: 'Open ended', starts: '2026-08-24T11:00:00+03:00',
		company: 'companies/northwind', attendees: ['contacts/dana-oren'], origin: 'manual',
	}, '');

	// 6. Older than the window a `--since` run will ask for.
	meeting('2026/05/2026-05-06--10-00--northwind--old-standup', {
		name: 'Old standup', starts: '2026-05-06T10:00:00+03:00', ends: '2026-05-06T10:15:00+03:00',
		company: 'companies/northwind', attendees: ['contacts/dana-oren'], origin: 'calendar',
	}, '');

	return { ws, data, scratch };
}

const run = (f, extra = ['--contributor', 'contacts/dana-oren']) => spawnSync(process.execPath,
	[BIN, '--retrospective', REF, '--data-root', f.data, '--scratch-root', f.scratch, ...extra],
	{ cwd: f.ws, encoding: 'utf8' });

const weeksOf = (f) => listRecords(path.join(f.data, 'perspective', 'activity-weeks'))
	.map((p) => readRecord(p).fields)
	.sort((a, b) => (a.period < b.period ? -1 : 1));
const source = (f, label = 'this-workspace') => readRecord(recordPath('sources', `${SLUG}/meetings--${label}`, 'source', f.data));
const scratchLines = (f) => fs.readFileSync(path.join(f.scratch, 'meetings', `${BASE}.jsonl`), 'utf8')
	.split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('the sources enum carries `meetings` — a reader writing a kind the descriptor refuses fails `check`, not a unit test', () => {
	const doc = yaml.load(fs.readFileSync(path.join(COLLECTIONS, 'sources.collection.yaml'), 'utf8'));
	assert.ok(doc.schema.properties.kind.enum.includes('meetings'),
		`sources.kind is ${JSON.stringify(doc.schema.properties.kind.enum)} — the reader would write a record the engine rejects`);
});

test('a meeting is kept when the contributor is an attendee REF or carries a handle in attendees_raw, and never otherwise', () => {
	const f = fixture();
	const r = run(f);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /scanned 6 · attended 5 \(4 by attendee ref, 1 by attendees_raw\)/);
	const refs = scratchLines(f).map((m) => m.ref);
	assert.ok(refs.includes('meetings/2026/08/2026-08-20--14-00--harbor-mutual--review'), 'the raw-only meeting is theirs');
	assert.ok(!refs.some((x) => x.includes('finpath')), 'a meeting the contributor is not on is not theirs, however near it sits');
});

test('an email works as well as a contacts ref, because the run record carries the same handle', () => {
	const f = fixture();
	const r = run(f, ['--contributor', DANA]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /attended 5 \(4 by attendee ref, 1 by attendees_raw\)/,
		'the email resolves to the contact, so the structural matches still fire');
});

test('a bare display name is refused outright — it is never a person key', () => {
	const f = fixture();
	const r = run(f, ['--contributor', 'Dana Oren']);
	assert.equal(r.status, 2);
	assert.match(r.stderr, /never a person key/);
});

test('the week counts meetings, minutes and counterparts, in fields that mean only that', () => {
	const f = fixture();
	run(f);
	const weeks = weeksOf(f);
	assert.deepEqual(weeks.map((w) => w.period), ['2026-W19', '2026-W32', '2026-W34', '2026-W35']);

	const w32 = weeks.find((w) => w.period === '2026-W32');
	assert.equal(w32.meetings_attended, 2, 'the sync and the discovery call; the Finpath pitch is not theirs');
	assert.equal(w32.meeting_minutes, 90, '60 + 30, from starts and ends');
	assert.equal(w32.meeting_counterparts, 2, 'Sam and Priya — Nick has no email and is not a person key');
	assert.ok(w32.start_date && w32.end_date, 'the week carries its dates so a gantt can draw it');
	assert.equal(w32.source, `perspective/sources/${SLUG}/meetings--this-workspace`);
	assert.equal(w32.retrospective, REF);
	assert.equal(w32.sessions, undefined, 'a meeting is not an agent session');
	assert.equal(w32.turns_user, undefined, 'and nobody took a turn at anything');

	const w35 = weeks.find((w) => w.period === '2026-W35');
	assert.equal(w35.meetings_attended, 1);
	assert.equal(w35.meeting_minutes, undefined, 'a meeting with no `ends` is unmeasurable — absent, never a zero-length meeting');
	assert.equal(w35.meeting_counterparts, undefined, 'and it had no other attendee at all');
});

test('⚠ NOT ONE WORD of a summary, prep or analysis reaches a record — the ref is the pointer', () => {
	const f = fixture();
	run(f);
	const everything = listRecords(path.join(f.data, 'perspective'))
		.map((p) => fs.readFileSync(p, 'utf8')).join('\n')
		+ fs.readFileSync(path.join(f.scratch, 'meetings', `${BASE}.jsonl`), 'utf8');
	assert.ok(!everything.includes(JUDGED), 'a word from a meeting body or its judged artefacts must not appear anywhere');
	assert.ok(!everything.includes('meeting-summaries/'), 'not even the summary REF — this module cites the meeting');
});

test('every counterpart with an email becomes a collaborator, joined to the CRM record the meeting already pointed at', () => {
	const f = fixture();
	const r = run(f);
	const rows = listRecords(path.join(f.data, 'perspective', 'world', 'users', SLUG)).map((p) => readRecord(p).fields);
	const sam = rows.find((x) => x.name === 'Sam Diaz');
	// The email is the KEY; the display name rides along only because it collides with nobody —
	// `lib/collaborators.mjs` owns that rule and drops the name the moment it would be ambiguous.
	assert.deepEqual(sam.handles, [SAM, 'Sam Diaz']);
	assert.ok(sam.handles.includes(SAM), 'the merge key is the email');
	// ⚠ NOT a name match: `meetings.attendees` is an x-reference somebody already committed to, so
	// following it is the opposite of guessing from a string.
	assert.equal(sam.contact, 'contacts/sam-diaz');
	assert.deepEqual(sam.roles_observed, ['attendee']);
	assert.deepEqual(sam.sources, [`perspective/sources/${SLUG}/meetings--this-workspace`]);
	assert.equal(sam.first_seen, '2026-08-03');

	const priya = rows.find((x) => x.name === 'Priya Raman');
	assert.equal(priya.evidence_count, 2, 'the discovery call and the review');
	assert.equal(priya.last_seen, '2026-08-20');

	assert.ok(!rows.some((x) => x.name === 'Nick Noemail'), 'an attendee with no email is not a person this module can key');
	assert.match(r.stdout, /1 attendee\(s\) with no email got NO collaborator \(Nick Noemail\)/,
		'and the gap is stated in the receipt rather than swallowed');
});

test('the source record says what was reachable and what it may not claim', () => {
	const f = fixture();
	run(f);
	const src = source(f);
	assert.equal(src.fields.kind, 'meetings');
	assert.equal(src.fields.reach, 'available');
	assert.equal(src.fields.location, '${workspaceFolder}');
	assert.equal(src.fields.counts.scanned, 6);
	assert.equal(src.fields.counts.attended, 5);
	assert.equal(src.fields.counts.by_attendees_raw, 1);
	assert.equal(src.fields.counts.attendees_without_an_email, 1);
	assert.equal(src.fields.counts.first, '2026-05-06');
	assert.equal(src.fields.read_with, 'read-meetings@1');
	assert.match(src.body, /Attendance is not participation/);
	assert.match(src.body, /NOT ONE WORD of a summary/);
});

test('the scratch parking lot is what the cluster stage reads — refs and minutes, never a domain record', () => {
	const f = fixture();
	run(f);
	const lines = scratchLines(f);
	assert.equal(lines.length, 5);
	const sync = lines.find((m) => m.ref.endsWith('weekly-sync'));
	assert.equal(sync.minutes, 60);
	assert.equal(sync.company, 'companies/northwind');
	assert.deepEqual(sync.handles, [SAM], 'the counterpart emails only — the contributor is on every meeting');
	assert.equal(sync.matched, 'attendee-ref');
	assert.equal(lines.find((m) => m.ref.endsWith('open-ended')).minutes, undefined);
	// The peer collection's records are read and never copied: nothing under data/perspective/ is a meeting.
	assert.ok(!fs.existsSync(path.join(f.data, 'perspective', 'meetings')), 'this module never holds a domain object');
});

test('--since bounds the read and says how much it left behind', () => {
	const f = fixture();
	const r = run(f, ['--contributor', 'contacts/dana-oren', '--since', '2026-08-01']);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /attended 4 /);
	assert.match(r.stdout, /1 older than 2026-08-01/);
	assert.deepEqual(weeksOf(f).map((w) => w.period), ['2026-W32', '2026-W34', '2026-W35']);
});

test('--dry-run writes nothing at all — no record, no parking lot', () => {
	const f = fixture();
	const r = run(f, ['--contributor', 'contacts/dana-oren', '--dry-run']);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /DRY RUN, nothing written/);
	assert.equal(fs.existsSync(path.join(f.data, 'perspective', 'sources')), false);
	assert.equal(fs.existsSync(path.join(f.scratch, 'meetings')), false);
});

test('a re-run writes the same bytes — the whole reason a stage is resumable', () => {
	const f = fixture();
	run(f);
	const snapshot = listRecords(path.join(f.data, 'perspective')).map((p) => [p, fs.readFileSync(p, 'utf8')]);
	run(f);
	for (const [p, before] of snapshot) assert.equal(fs.readFileSync(p, 'utf8'), before, `${p} changed on a re-read`);
	assert.equal(listRecords(path.join(f.data, 'perspective')).length, snapshot.length, 'and no record was added');
});

test('a workspace with no meetings collection is a STATED gap, not a failure', () => {
	const f = fixture({ withMeetings: false });
	const r = run(f);
	assert.equal(r.status, 0, 'an absent capability is not a failed run');
	assert.match(r.stdout, /✖ meetings this-workspace unavailable/);
	const src = source(f);
	assert.equal(src.fields.reach, 'unavailable');
	assert.match(src.body, /declared PEER/);
	assert.equal(fs.existsSync(path.join(f.scratch, 'meetings')), false);
});

// ⚠ Whose meetings these are is the RUN RECORD's answer — every id is keyed by its `contributor`
// slug, so `--contributor` only chooses which identity of that person to look them up by. An address
// this workspace has never seen therefore falls back to the run's declared handles, and the receipt
// SAYS SO: the fallback is honest, and silence about it is how a reader quietly profiles the wrong
// person.
test('an address the workspace does not know falls back to the run record’s handles, and says so', () => {
	const f = fixture();
	const r = run(f, ['--contributor', 'stranger@elsewhere.example']);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /stranger@elsewhere\.example matches no contacts record here — matched on the run record's own handles instead/);
	// Two, not five: with no contact ref there is no structural match, only the raw attendee lines.
	assert.match(r.stdout, /attended 2 \(0 by attendee ref, 2 by attendees_raw\)/);
});
