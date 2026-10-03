// The people fields after the 0.1.2 remodel: `attendees` is the Calendar API's attendee list as
// objects, `attendees_contacts` the workspace's contact refs, `organizer` the API's object, and
// `attendees_raw` is gone. Half of this is pure (the mapping and the parser), half runs the real
// engine on a packed install: the compiled shape, a record in the old shape refused by `check`,
// the sync script and the migration writing through the store, and the export withholding both
// sensitive fields.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { virginWorkspace, installPacked, closure, compileAndCheck, compiledDescriptor, run, cleanup } from '../../../tests/helpers/workspace.mjs';
import { attendeeOf, attendeesOf, organizerOf, peopleOf } from '../skills/fetching-meetings/bin/event-people.mjs';
import { parseRawAttendee, planRecord, RESIDUE_HEADING } from '../bin/migrate-attendees.mjs';

// One Calendar API event, as `gcal.mjs event` prints it: an accepted organizer, a pending guest, a room.
const EVENT = {
	id: 'evt-1', summary: 'Weekly sync',
	organizer: { email: 'Dana.O@northwind.example', displayName: 'Dana Oren', self: true },
	attendees: [
		{ email: 'Dana.O@northwind.example', displayName: 'Dana Oren', organizer: true, self: true, responseStatus: 'accepted' },
		{ email: 'sam.d@harbormutual.example', responseStatus: 'needsAction', optional: true },
		{ email: 'room-8@resource.calendar.example', displayName: 'Floor 8', resource: true, responseStatus: 'accepted' },
	],
};

describe('the mapping from the API event (pure)', () => {
	test('an attendee keeps the API keys, lowercases the address, maps needsAction once and drops false flags', () => {
		assert.deepEqual(attendeeOf(EVENT.attendees[0]), { email: 'dana.o@northwind.example', displayName: 'Dana Oren', responseStatus: 'accepted', organizer: true, self: true });
		assert.deepEqual(attendeeOf(EVENT.attendees[1]), { email: 'sam.d@harbormutual.example', responseStatus: 'needs-action', optional: true });
	});
	test('a room is dropped, and so is an entry with no address', () => {
		assert.equal(attendeeOf(EVENT.attendees[2]), null);
		assert.equal(attendeeOf({ displayName: 'nobody' }), null);
		assert.deepEqual(attendeesOf(EVENT).map((a) => a.email), ['dana.o@northwind.example', 'sam.d@harbormutual.example']);
	});
	test('the organizer is the API object, trimmed to the declared keys', () => {
		assert.deepEqual(organizerOf(EVENT), { email: 'dana.o@northwind.example', displayName: 'Dana Oren', self: true });
		assert.equal(organizerOf({}), null);
		assert.deepEqual(peopleOf({}), { attendees: [], organizer: null });
	});
});

describe('the parser for 0.1.1 attendees_raw strings (pure)', () => {
	test('the three shapes the sync wrote parse back into the API shape', () => {
		assert.deepEqual(parseRawAttendee('sam.d@harbormutual.example — Sam Diaz (organizer + accepted)'),
			{ attendee: { email: 'sam.d@harbormutual.example', displayName: 'Sam Diaz', organizer: true, responseStatus: 'accepted' }, remarks: [], resource: false });
		assert.deepEqual(parseRawAttendee("'Priya Raman' <priya.r@harbormutual.example> (needsAction)"),
			{ attendee: { email: 'priya.r@harbormutual.example', displayName: 'Priya Raman', responseStatus: 'needsAction' }, remarks: [], resource: false });
		assert.deepEqual(parseRawAttendee('<dana.o@northwind.example> (self, optional) [declined]'),
			{ attendee: { email: 'dana.o@northwind.example', self: true, optional: true, responseStatus: 'declined' }, remarks: [], resource: false });
		assert.deepEqual(parseRawAttendee('tom.w@northwind.example').attendee, { email: 'tom.w@northwind.example' });
	});
	test('a name in the bracket group is taken as the display name; a remark is kept as a remark', () => {
		const r = parseRawAttendee('tom.w@northwind.example (Tom Whitfield - organizer; no guests on the invite)');
		assert.deepEqual(r.attendee, { email: 'tom.w@northwind.example', displayName: 'Tom Whitfield', organizer: true });
		assert.deepEqual(r.remarks, ['no guests on the invite']);
	});
	test('a string with no address is a remark in full, and a room the sync labelled is a resource', () => {
		assert.deepEqual(parseRawAttendee('Tom Whitfield (from the recording filename)'), { attendee: null, remarks: ['Tom Whitfield (from the recording filename)'], resource: false });
		assert.equal(parseRawAttendee('room-8@resource.calendar.example (room resource - needsAction)').resource, true);
		assert.equal(parseRawAttendee('a@example.invalid + b@example.invalid — rooms').attendee, null);
	});
	test('a record in the 0.1.2 shape plans to nothing — the second run is a no-op', () => {
		assert.equal(planRecord({ name: 'x', attendees: [{ email: 'a@example.invalid' }], attendees_contacts: ['contacts/a'], organizer: { email: 'a@example.invalid' } }), null);
		assert.equal(planRecord({ name: 'x' }), null);
	});
	test('a 0.1.1 record plans the rename, the objects, the organizer object and the residue into notes', () => {
		const plan = planRecord({
			name: 'x', notes: 'Agreed to ship.',
			attendees: ['contacts/dana-oren', 'contacts/sam-diaz'],
			attendees_raw: ['dana.o@northwind.example (self + organizer)', 'sam.d@harbormutual.example — Sam Diaz (accepted)', 'Priya Raman (from the recording filename)'],
			organizer: 'dana.o@northwind.example',
		});
		assert.deepEqual(plan.changes.attendees_contacts, ['contacts/dana-oren', 'contacts/sam-diaz']);
		assert.deepEqual(plan.changes.attendees, [
			{ email: 'dana.o@northwind.example', self: true, organizer: true },
			{ email: 'sam.d@harbormutual.example', displayName: 'Sam Diaz', responseStatus: 'accepted' },
		]);
		assert.equal(plan.changes.attendees_raw, null);
		assert.deepEqual(plan.changes.organizer, { email: 'dana.o@northwind.example', self: true });
		assert.equal(plan.changes.notes, `Agreed to ship.\n\n${RESIDUE_HEADING}\n\n- Priya Raman (from the recording filename)\n`);
		assert.deepEqual(plan.counts, { attendees: 2, contacts: 2, residue: 1, rooms: 0 });
	});
});

describe('on the engine, from the packed module', () => {
	let root, d, pkg, meetingFile, meetingId;
	const runScript = (script, args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', timeout: 60_000 });
	const frontmatter = (file) => yaml.load(fs.readFileSync(path.join(root, file), 'utf8').split('\n---')[0].replace(/^---\n/, ''));
	before(() => {
		root = virginWorkspace();
		installPacked(root, [...closure('meetings'), ...closure('notebooklm')]);
		// the scripts find the workspace by its lockfile, as every consumer has one
		fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
		compileAndCheck(root);
		d = yaml.load(compiledDescriptor(root, 'meetings'));
		pkg = path.join(root, 'node_modules', '@dreamteamer', 'meetings');
		assert.equal(run(root, ['add', 'companies', '--name', 'Northwind']).status, 0);
		assert.equal(run(root, ['add', 'contacts', '--name', 'Dana Oren', '--email', 'dana.o@northwind.example']).status, 0);
		assert.equal(run(root, ['add', 'contacts', '--name', 'Sam Diaz', '--email', 'sam.d@harbormutual.example']).status, 0);
		const r = run(root, ['add', 'meetings', '--name', 'Weekly sync', '--starts', '2026-08-30T10:00:00+03:00', '--company', 'companies/northwind', '--attendees_contacts', 'contacts/dana-oren', '--attendees_contacts', 'contacts/sam-diaz']);
		assert.equal(r.status, 0, r.stderr);
		meetingFile = 'data/meetings/2026/08/2026-08-30--10-00--northwind--weekly-sync.meeting.md';
		meetingId = '2026/08/2026-08-30--10-00--northwind--weekly-sync';
		assert.ok(fs.existsSync(path.join(root, meetingFile)));
	});
	after(cleanup);

	test('attendees compiles as a sensitive list of objects with the API keys; attendees_contacts as contacts; attendees_raw is not a field', () => {
		const a = d.fields.attendees;
		assert.equal(a.type, 'object');
		assert.equal(a.many, true);
		assert.equal(a.sensitive, true);
		assert.deepEqual(Object.keys(a.fields), ['email', 'displayName', 'responseStatus', 'organizer', 'self', 'optional']);
		assert.equal(a.fields.email.required, true);
		assert.deepEqual(a.fields.responseStatus.enum, ['needs-action', 'declined', 'tentative', 'accepted']);
		assert.equal(d.fields.attendees_contacts.type, 'contacts');
		assert.equal(d.fields.attendees_contacts.many, true);
		assert.equal(d.fields.organizer.type, 'object');
		assert.equal(d.fields.organizer.sensitive, true);
		assert.equal(d.fields.attendees_raw, undefined);
		assert.deepEqual(d.display.list.columns.filter((c) => /attendees/.test(c)), ['attendees_contacts']);
	});

	test('a record carrying attendees_raw is refused by check, by name', () => {
		const file = path.join(root, meetingFile);
		const text = fs.readFileSync(file, 'utf8');
		fs.writeFileSync(file, text.replace('\n---', '\nattendees_raw:\n  - dana.o@northwind.example (self)\n---'));
		const r = run(root, ['check']);
		assert.notEqual(r.status, 0, 'check passed a record carrying attendees_raw');
		assert.match(r.stdout + r.stderr, /unknown field "attendees_raw"/);
		fs.writeFileSync(file, text);
		assert.equal(run(root, ['check']).status, 0);
	});

	test('event-people writes two attendee objects and the organizer from the event, and no room', () => {
		const eventFile = path.join(root, 'event.json');
		fs.writeFileSync(eventFile, JSON.stringify(EVENT));
		const r = runScript(path.join(pkg, 'skills', 'fetching-meetings', 'bin', 'event-people.mjs'), [`meetings/${meetingId}`, '--event', eventFile]);
		assert.equal(r.status, 0, r.stderr + r.stdout);
		assert.match(r.stdout, /wrote 2 attendee\(s\) and the organizer .* \(1 room\(s\) dropped\)/);
		const fm = frontmatter(meetingFile);
		assert.deepEqual(fm.attendees, [
			{ email: 'dana.o@northwind.example', displayName: 'Dana Oren', responseStatus: 'accepted', organizer: true, self: true },
			{ email: 'sam.d@harbormutual.example', responseStatus: 'needs-action', optional: true },
		]);
		assert.deepEqual(fm.organizer, { email: 'dana.o@northwind.example', displayName: 'Dana Oren', self: true });
		assert.deepEqual(fm.attendees_contacts, ['contacts/dana-oren', 'contacts/sam-diaz'], 'the refs are untouched');
		assert.equal(run(root, ['check']).status, 0);
	});

	test('the migration takes a 0.1.1 record to the 0.1.2 shape through the store, and a second run is a no-op', () => {
		// a second meeting, written in the OLD shape by hand: refs in `attendees`, strings in `attendees_raw`, an address in `organizer`
		const old = 'data/meetings/2026/08/2026-08-31--09-00--northwind--old-shape.meeting.md';
		fs.writeFileSync(path.join(root, old), [
			'---', 'name: Old shape', "starts: '2026-08-31T09:00:00+03:00'", 'company: companies/northwind', 'origin: calendar',
			'attendees:', '  - contacts/dana-oren', '  - contacts/sam-diaz',
			'attendees_raw:', "  - 'dana.o@northwind.example (self + organizer)'", "  - 'sam.d@harbormutual.example — Sam Diaz (needsAction)'", "  - 'Tom Whitfield (from the recording filename)'",
			'organizer: dana.o@northwind.example', 'privacy: open', 'confidence: normal', '---', '',
		].join('\n'));
		const script = path.join(pkg, 'bin', 'migrate-attendees.mjs');
		const plan = runScript(script, []);
		assert.equal(plan.status, 0, plan.stderr + plan.stdout);
		assert.match(plan.stdout, /would migrate 1 of 2 meeting\(s\) \(1 already in shape\) · attendees 2 · contacts 2 · residue lines 1 · rooms 0/);
		assert.match(plan.stdout, /nothing written/);
		assert.match(fs.readFileSync(path.join(root, old), 'utf8'), /attendees_raw:/, 'the plan wrote');

		const apply = runScript(script, ['--write']);
		assert.equal(apply.status, 0, apply.stderr + apply.stdout);
		assert.match(apply.stdout, /migrated 1 of 2 meeting\(s\)/);
		const fm = frontmatter(old);
		assert.equal(fm.attendees_raw, undefined);
		assert.deepEqual(fm.attendees_contacts, ['contacts/dana-oren', 'contacts/sam-diaz']);
		assert.deepEqual(fm.attendees, [
			{ email: 'dana.o@northwind.example', self: true, organizer: true },
			{ email: 'sam.d@harbormutual.example', displayName: 'Sam Diaz', responseStatus: 'needs-action' },
		]);
		assert.deepEqual(fm.organizer, { email: 'dana.o@northwind.example', self: true });
		assert.match(fs.readFileSync(path.join(root, old), 'utf8'), new RegExp(`${RESIDUE_HEADING.replace(/[()]/g, '\\$&')}\\n\\n- Tom Whitfield \\(from the recording filename\\)`));
		assert.equal(run(root, ['check']).status, 0);

		const again = runScript(script, ['--write', '--json']);
		assert.equal(again.status, 0, again.stderr);
		assert.equal(JSON.parse(again.stdout).changed, 0);
	});

	test('the export withholds attendees and organizer: no address reaches the meetings shard, and both are named as omitted', () => {
		const r = run(root, ['notebooklm', '--out', 'bundle', '--collections', 'meetings']);
		assert.equal(r.status, 0, r.stderr + r.stdout);
		const shard = fs.readFileSync(path.join(root, 'bundle', 'meetings.md'), 'utf8');
		assert.ok(!shard.includes('@'), `an address reached the export:\n${shard.split('\n').filter((l) => l.includes('@')).join('\n')}`);
		assert.match(shard, /attendees_contacts/);
		const instructions = fs.readFileSync(path.join(root, 'bundle', 'instructions.md'), 'utf8');
		assert.match(instructions, /meetings\.attendees\b/);
		assert.match(instructions, /meetings\.organizer\b/);
	});
});
