// THE CONTEXT THE TRANSCRIBER READS (cr-modules-019 task 7). The Python never reads a record other than
// the one it writes, so the node entry resolves, with the engine (`dt get`, `dt list`, `dt resolve`), what
// naming a voice needs: the recording's meeting, its distinct attendees and whether their count is
// certain (design section 10 step 1), the workspace's people, the documents written from the transcript,
// and the folders the voice-print store may not live in (section 8). It hands that over as one JSON file
// passed by `--context`, removed when the child exits.
//
// A real engine and a fixture workspace with the synthetic cast; the transcriber itself is replaced by a
// stand-in `uv` on PATH that copies its argv, its environment and the context file into a temp folder.
// Nothing here runs Python or touches a voice-print store: VOICE_PRINTS_HOME points at a temp folder.
//
// Test names starting `line 03 ` and `line 10 ` are the node half of acceptance lines 3 and 10, run by
// name pattern (plan rulings D11, D12).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { virginWorkspace, installCopied, closure, run, cleanup } from '../../../tests/helpers/workspace.mjs';
import * as voiceContext from '../lib/voice-context.mjs';
const { recordingContext, personRecords, distinctAttendees } = voiceContext;
const normName = (s) => voiceContext.normName(s);

const temps = [];
after(() => { cleanup(); for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); temps.push(d); return d; };

// ── the fixture: one compiled workspace, records written through the engine ─────────────────────────
const root = virginWorkspace();
// the node entry finds its workspace the way every module script does: package.json beside package-lock.json
if (!fs.existsSync(path.join(root, 'package-lock.json'))) fs.writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion": 3}\n');
installCopied(root, [...new Set([...closure('recordings'), ...closure('meeting-docs'), ...closure('tasks')])]);
const compiled = run(root, ['compile']);
const dt = (...args) => {
	const r = run(root, args);
	assert.equal(r.status, 0, `dt ${args.join(' ')} failed:\n${r.stderr}\n${r.stdout}`);
	return r.stdout;
};
const getJson = (ref) => JSON.parse(dt('get', ref, '--json'));
/** Merge `fields` into a record's frontmatter on disk — the way the transcriber writes a record. */
function patch(ref, fields) {
	const file = path.join(root, getJson(ref).$file);
	const text = fs.readFileSync(file, 'utf8');
	const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
	const fm = { ...yaml.load(m[1]), ...fields };
	fs.writeFileSync(file, `---\n${yaml.dump(fm, { lineWidth: -1 })}---\n${m[2]}`);
}
const idOf = (out) => /data\/[^/]+\/(.+)\.[a-z-]+\.md/.exec(out)[1];

const S = {};
function seed() {
	if (S.done) return S;
	assert.equal(compiled.status, 0, `compile failed:\n${compiled.stderr}`);
	dt('add', 'companies', '--name', 'Northwind');
	dt('add', 'companies', '--name', 'Harbor Mutual');
	// contacts: Dana's own contact record, Sam at Northwind, Priya at Harbor Mutual, Tom with no user
	dt('add', 'contacts', '--name', 'Dana Oren', '--email', 'dana@harbor.example', '--company', 'companies/harbor-mutual');
	dt('add', 'contacts', '--name', 'Sam Diaz', '--email', 'sam@northwind.example', '--company', 'companies/northwind');
	dt('add', 'contacts', '--name', 'Priya Raman', '--email', 'priya.r@harbor.example', '--company', 'companies/harbor-mutual');
	dt('add', 'contacts', '--name', 'Tom Whitfield', '--email', 'tom@northwind.example', '--company', 'companies/northwind');
	// users: Dana joined by `contact`; Priya joined only by a handle equal to her contact's email; Tom
	// Whitfield's user joined to nothing (no contact field, an address no contact carries)
	dt('add', 'users', '--name', 'Dana Oren', '--contact', 'contacts/dana-oren', '--email', 'dana.o@harbor.example');
	dt('add', 'users', '--name', 'Priya Raman', '--email', 'priya@work.example', '--handles', 'PRIYA.R@harbor.example', '--handles', 'praman');
	dt('add', 'users', '--name', 'Tom W', '--id', 'tom-w', '--email', 'tw@elsewhere.example');
	dt('add', 'users', '--name', 'Build Bot', '--id', 'build-bot', '--kind', 'agent', '--human_owner', 'users/dana-oren');

	// a 1:1 — Dana (user, joined by contact) and Sam (contact); the calendar marks Dana's address as self
	S.oneToOne = `meetings/${idOf(dt('add', 'meetings', '--name', 'Northwind weekly', '--company', 'companies/northwind',
		'--starts', '2026-08-30T15:00:00+03:00', '--ours', 'users/dana-oren',
		'--attendees_contacts', 'contacts/dana-oren', '--attendees_contacts', 'contacts/sam-diaz', '--location', 'https://meet.example/abc'))}`;
	patch(S.oneToOne, { attendees: [{ email: 'dana@harbor.example', self: true }, { email: 'sam@northwind.example' }] });
	// Priya (user, joined only by a handle) and her own contact, with Sam: three records, two people... plus Sam = 2
	S.byHandle = `meetings/${idOf(dt('add', 'meetings', '--name', 'Harbor review', '--company', 'companies/harbor-mutual',
		'--starts', '2026-09-01T10:00:00+03:00', '--ours', 'users/priya-raman',
		'--attendees_contacts', 'contacts/priya-raman', '--attendees_contacts', 'contacts/sam-diaz'))}`;
	// Tom W (a user joinable to no contact) with Tom Whitfield's contact: maybe one person, maybe two
	S.unjoinable = `meetings/${idOf(dt('add', 'meetings', '--name', 'Northwind planning', '--company', 'companies/northwind',
		'--starts', '2026-09-02T10:00:00+03:00', '--ours', 'users/tom-w', '--ours', 'users/dana-oren',
		'--attendees_contacts', 'contacts/tom-whitfield', '--attendees_contacts', 'contacts/dana-oren'))}`;
	// a meeting stored under a company folder, outside the id template — written as a file, read by the engine
	fs.mkdirSync(path.join(root, 'data/meetings/northwind/2026/09'), { recursive: true });
	fs.writeFileSync(path.join(root, 'data/meetings/northwind/2026/09/2026-09-03--northwind-onsite.meeting.md'),
		'---\nname: Northwind onsite\nstarts: 2026-09-03T09:00:00+03:00\nlocation: Northwind office, room 4\nours:\n  - users/dana-oren\nattendees_contacts:\n  - contacts/sam-diaz\n---\n');
	S.underCompany = 'meetings/northwind/2026/09/2026-09-03--northwind-onsite';

	const rec = (name, date, meeting, extra = {}) => {
		const args = ['add', 'meeting-recordings', '--name', name, '--date', date, '--recording_file', `\${env:FILES_FOLDER}/meeting-recordings/${name.toLowerCase().replace(/\W+/g, '-')}.m4a`];
		if (meeting) args.push('--meeting', meeting);
		const ref = `meeting-recordings/${idOf(dt(...args))}`;
		if (Object.keys(extra).length) patch(ref, extra);
		return ref;
	};
	S.rec1 = rec('Northwind weekly', '2026-08-30T15:00:00+03:00', S.oneToOne, {
		fingerprint: 'ab12'.repeat(16),
		transcription: { diarization_id: '7c1d09a4e2b1', speakers: { speaker_0: 'Dana Oren', speaker_1: 'Sam Diaz' },
			speaker_sources: { speaker_0: { name: 'Dana Oren', person: 'users/dana-oren', origin: 'hand', status: 'confirmed' } } },
	});
	S.rec2 = rec('Harbor review', '2026-09-01T10:00:00+03:00', S.byHandle, {
		transcription: { diarization_id: '0a1b2c3d4e5f', speakers: {},
			previous_speakers: { diarization_id: 'ffeeddccbbaa', labels: {
				speaker_0: { name: 'Sam Diaz', new_label: 'speaker_1', share: 0.8, offered: true },
				speaker_1: { name: 'Priya Raman', source: { name: 'Priya Raman', person: 'users/priya-raman', origin: 'hand', status: 'confirmed' }, new_label: 'speaker_0', share: 0.9, offered: true } } } },
	});
	S.rec3 = rec('Northwind planning', '2026-09-02T10:00:00+03:00', S.unjoinable, {
		transcription: { diarization_id: '112233445566', speakers: {},
			speaker_questions: { speaker_1: { quotes: [], proposed: { person: 'contacts/sam-diaz', origin: 'attendees', why: 'the only attendee left' } } } },
	});
	S.rec4 = rec('Northwind onsite', '2026-09-03T09:00:00+03:00', S.underCompany);
	S.rec5 = rec('Solo memo', '2026-09-04T08:00:00+03:00', null, { transcription: { engine: 'cpu', speakers: { speaker_0: 'Sam Diaz' } } });

	// documents written from the transcripts
	S.summary = `meeting-summaries/${idOf(dt('add', 'meeting-summaries', '--name', 'Northwind weekly summary', '--meeting', S.oneToOne, '--source', S.rec1))}`;
	S.analysis = `meeting-analyses/${idOf(dt('add', 'meeting-analyses', '--name', 'Northwind weekly critique', '--source', S.oneToOne))}`;
	S.task = `tasks/${idOf(dt('add', 'tasks', '--name', 'Send Sam the pricing sheet', '--source', S.rec1))}`;
	S.otherTask = `tasks/${idOf(dt('add', 'tasks', '--name', 'Book the Harbor onsite', '--source', S.rec2))}`;
	// linked to the Harbor review by `meeting` / `meetings` alone, with no `source` naming it
	S.summary2 = `meeting-summaries/${idOf(dt('add', 'meeting-summaries', '--name', 'Harbor review summary', '--meeting', S.byHandle))}`;
	S.analysis2 = `meeting-analyses/${idOf(dt('add', 'meeting-analyses', '--name', 'Harbor arc critique', '--meetings', S.byHandle, '--source', 'file:notes.txt'))}`;
	S.done = true;
	return S;
}
const people = (ctx) => ctx.candidates.map((c) => [c.person, c.kind]).sort();

describe('recordingContext — the attendees, made distinct (design section 10 step 1)', () => {
	test('line 03 a 1:1 with Dana Oren (a user joined by `contact`) and Sam Diaz (a contact) counts two', async () => {
		seed();
		const ctx = await recordingContext(root, S.rec1);
		assert.deepEqual(people(ctx), [['contacts/sam-diaz', 'contact'], ['users/dana-oren', 'user']]);
		assert.equal(ctx.attendee_count, 2);
		assert.equal(ctx.attendee_count_certain, true);
		const dana = ctx.candidates.find((c) => c.person === 'users/dana-oren');
		assert.equal(dana.name, 'Dana Oren');
		assert.equal(dana.contact, 'contacts/dana-oren', 'the joined contact travels with the user');
		assert.equal(dana.you, true, 'the calendar marks Dana\'s address as self');
		assert.equal(ctx.candidates.find((c) => c.person === 'contacts/sam-diaz').you, undefined);
	});

	test('line 03 a user joined only by a `handles` address counts once', async () => {
		seed();
		const ctx = await recordingContext(root, S.rec2);
		assert.deepEqual(people(ctx), [['contacts/sam-diaz', 'contact'], ['users/priya-raman', 'user']]);
		assert.equal(ctx.attendee_count, 2);
		assert.equal(ctx.attendee_count_certain, true);
	});

	test('line 10 a user joinable to no contact makes the count uncertain, so elimination is off', async () => {
		seed();
		const ctx = await recordingContext(root, S.rec3);
		assert.deepEqual(people(ctx), [['contacts/tom-whitfield', 'contact'], ['users/dana-oren', 'user'], ['users/tom-w', 'user']]);
		assert.equal(ctx.attendee_count, 3);
		assert.equal(ctx.attendee_count_certain, false);
	});

	test('line 10 the count is certain only when every user is joined: the pure rule on its own', () => {
		const users = [{ ref: 'users/dana-oren', name: 'Dana Oren', email: 'dana.o@harbor.example' }];
		const contacts = [{ ref: 'contacts/dana-oren', name: 'Dana Oren', email: 'Dana.O@Harbor.example' }, { ref: 'contacts/sam-diaz', name: 'Sam Diaz', email: 'sam@northwind.example' }];
		const joined = distinctAttendees({ ours: ['users/dana-oren'], attendees_contacts: ['contacts/dana-oren', 'contacts/sam-diaz'] }, users, contacts);
		assert.deepEqual([joined.count, joined.certain], [2, true], 'joined by `email`, case-insensitively');
		const alone = distinctAttendees({ ours: ['users/dana-oren'], attendees_contacts: [] }, [{ ref: 'users/dana-oren', name: 'Dana Oren' }], []);
		assert.deepEqual([alone.count, alone.certain], [1, true], 'no attendees_contacts: nothing to double-count');
	});

	test('line 03 a user is EVERY contact it joins: a second contact record matching its email is not a second person', () => {
		// Dana's user points at her older contact (another address) by `contact`; the calendar filed the
		// meeting's attendee as a second contact whose email is the user's own email. Both rules join her.
		const users = [{ ref: 'users/dana-oren', name: 'Dana Oren', email: 'dana.o@harbor.example', contact: 'contacts/dana-oren' }];
		const contacts = [
			{ ref: 'contacts/dana-oren', name: 'Dana Oren', email: 'dana@harbor.example' },
			{ ref: 'contacts/dana-o', name: 'Dana O', email: 'dana.o@harbor.example' },
			{ ref: 'contacts/sam-diaz', name: 'Sam Diaz', email: 'sam@northwind.example' },
		];
		const d = distinctAttendees({ ours: ['users/dana-oren'], attendees_contacts: ['contacts/dana-o', 'contacts/sam-diaz'] }, users, contacts);
		assert.deepEqual([d.count, d.certain], [2, true]);
		assert.deepEqual(d.candidates.map((c) => [c.person, c.kind]), [['users/dana-oren', 'user'], ['contacts/sam-diaz', 'contact']], 'Dana is one choice, not two');
		assert.equal(d.candidates[0].contact, 'contacts/dana-o', 'the joined contact the meeting lists travels with the user');
		// both of her contact records in the meeting: still two people
		const both = distinctAttendees({ ours: ['users/dana-oren'], attendees_contacts: ['contacts/dana-oren', 'contacts/dana-o', 'contacts/sam-diaz'] }, users, contacts);
		assert.deepEqual([both.count, both.certain], [2, true]);
		assert.deepEqual(both.candidates.map((c) => c.person), ['users/dana-oren', 'contacts/sam-diaz']);
	});

	test('line 10 no linked meeting gives `meeting: null`, no count, and the workspace\'s users and contacts as candidates', async () => {
		seed();
		const ctx = await recordingContext(root, S.rec5);
		assert.equal(ctx.meeting, null);
		assert.equal(ctx.attendee_count, null);
		assert.equal(ctx.attendee_count_certain, false);
		// humans only (an agent row is no voice); a contact joined to a user (Dana's by `contact`, Priya's by a
		// handle) is that user, one candidate; the rest are contacts, which naming proposes and never writes
		assert.deepEqual(people(ctx), [['contacts/sam-diaz', 'contact'], ['contacts/tom-whitfield', 'contact'],
			['users/dana-oren', 'user'], ['users/priya-raman', 'user'], ['users/tom-w', 'user']]);
		assert.equal(ctx.candidates.find((c) => c.person === 'users/dana-oren').contact, 'contacts/dana-oren');
		assert.equal(ctx.candidates.find((c) => c.person === 'contacts/sam-diaz').name, 'Sam Diaz');
		assert.deepEqual(ctx.workspace_users.map((u) => u.person), ['users/dana-oren', 'users/priya-raman', 'users/tom-w']);
	});

	test('a meeting stored under a company folder resolves, with its location', async () => {
		seed();
		const ctx = await recordingContext(root, S.rec4);
		assert.deepEqual(ctx.meeting, { ref: S.underCompany, name: 'Northwind onsite', date: '2026-09-03T09:00:00+03:00', location: 'Northwind office, room 4' });
		assert.equal(ctx.attendee_count, 2);
	});
});

describe('recordingContext — the rest of one record\'s context', () => {
	test('workspace, record, its path, the audio rendered by the engine, meeting with location, known names, guard', async () => {
		seed();
		const ctx = await recordingContext(root, S.rec1);
		assert.equal(ctx.workspace, 'probe');
		assert.equal(ctx.record, S.rec1);
		assert.equal(ctx.record_path, path.join(root, getJson(S.rec1).$file));
		assert.equal(ctx.audio, path.join(root, 'files', 'meeting-recordings', 'northwind-weekly.m4a'));
		assert.equal(ctx.meeting.location, 'https://meet.example/abc');
		assert.equal(ctx.known['users/dana-oren'], 'Dana Oren');
		assert.equal(ctx.known['contacts/sam-diaz'], 'Sam Diaz');
		assert.deepEqual(ctx.guard, { workspace: root, files_folder: path.join(root, 'files'), inbox_folders: [path.join(root, 'inbox')] });
		// a path or a bare id names the same record
		assert.equal((await recordingContext(root, ctx.record_path)).record, S.rec1);
		assert.equal((await recordingContext(root, S.rec1.replace(/^meeting-recordings\//, ''))).record, S.rec1);
	});

	test('documents: the summaries, analyses and tasks whose `source` names the recording or its meeting', async () => {
		seed();
		const ctx = await recordingContext(root, S.rec1);
		// the summary names the meeting by `meeting` AND the recording by `source`: listed once
		assert.deepEqual(ctx.documents.map((d) => [d.ref, d.kind]).sort(), [[S.analysis, 'analysis'], [S.summary, 'summary'], [S.task, 'task']].sort());
		assert.ok(ctx.documents.every((d) => typeof d.created === 'string' && d.created.length > 9), JSON.stringify(ctx.documents));
		assert.deepEqual((await recordingContext(root, S.rec4)).documents, []);
	});

	test('documents: a summary whose `meeting` and an analysis whose `meetings` name the recording\'s meeting', async () => {
		seed();
		const ctx = await recordingContext(root, S.rec2);
		assert.deepEqual(ctx.documents.map((d) => [d.ref, d.kind]).sort(), [[S.analysis2, 'analysis'], [S.otherTask, 'task'], [S.summary2, 'summary']].sort());
	});
});

describe('personRecords — this workspace\'s recordings that name a person', () => {
	test('finds a name in `previous_speakers` and an open proposal, by reference or by the name string', async () => {
		seed();
		const sam = await personRecords(root, 'contacts/sam-diaz');
		assert.deepEqual(sam.map((r) => r.record).sort(), [S.rec1, S.rec2, S.rec3, S.rec5].sort());
		const by = Object.fromEntries(sam.map((r) => [r.record, r]));
		assert.deepEqual(by[S.rec2].matches, [{ label: 'speaker_0', where: 'previous_speakers', diarization_id: 'ffeeddccbbaa', new_label: 'speaker_1' }]);
		assert.deepEqual(by[S.rec3].matches, [{ label: 'speaker_1', where: 'speaker_questions', diarization_id: '112233445566' }]);
		assert.deepEqual(by[S.rec1].matches, [{ label: 'speaker_1', where: 'speakers', diarization_id: '7c1d09a4e2b1' }]);
		assert.equal(by[S.rec1].fingerprint, 'ab12'.repeat(16));
		assert.equal(by[S.rec1].record_path, path.join(root, getJson(S.rec1).$file));
		const priya = await personRecords(root, 'users/priya-raman');
		assert.deepEqual(priya.map((r) => [r.record, r.matches]), [[S.rec2, [{ label: 'speaker_1', where: 'previous_speakers', diarization_id: 'ffeeddccbbaa', new_label: 'speaker_0' }]]]);
		const dana = await personRecords(root, 'users/dana-oren');
		assert.deepEqual(dana.map((r) => [r.record, r.matches]), [[S.rec1, [{ label: 'speaker_0', where: 'speaker_sources', diarization_id: '7c1d09a4e2b1' }]]],
			'a source entry naming another person under the same string would not match: the reference decides');
		assert.deepEqual(await personRecords(root, 'contacts/tom-whitfield'), []);
	});

	test('an `earlier:<key>` entry is reported on the earlier diarisation\'s label it carries (finding earlier-key-drops-its-label)', async () => {
		seed();
		const ref = (() => {
			const out = dt('add', 'meeting-recordings', '--name', 'Northwind retro', '--date', '2026-09-05T10:00:00+03:00');
			return `meeting-recordings/${idOf(out)}`;
		})();
		patch(ref, { transcription: { speakers: {}, previous_speakers: { diarization_id: 'aabbccddeeff', labels: {
			speaker_0: { name: 'Priya Raman', new_label: 'speaker_0', share: 1, offered: true },
			'earlier:speaker_3': { name: 'Tom Whitfield', source: { person: 'contacts/tom-whitfield' }, label: 'speaker_0', new_label: 'speaker_1', share: 0.5, offered: false },
			'earlier:speaker_4': { name: 'Tom Whitfield', source: { person: 'contacts/tom-whitfield' }, new_label: null, share: 0, offered: false } } } } });
		const tom = await personRecords(root, 'contacts/tom-whitfield');
		assert.deepEqual(tom.map((r) => [r.record, r.matches]), [[ref, [
			{ label: 'speaker_0', where: 'previous_speakers', diarization_id: 'aabbccddeeff', new_label: 'speaker_1' },
			{ label: 'earlier:speaker_4', where: 'previous_speakers', diarization_id: 'aabbccddeeff', new_label: null }]]]);
	});

	test('line 24 a name typed in another case or spacing names the person, as the Python halves match it (finding forget-misses-a-name-in-another-case)', async () => {
		seed();
		const out = dt('add', 'meeting-recordings', '--name', 'Northwind standup', '--date', '2026-09-06T10:00:00+03:00');
		const ref = `meeting-recordings/${idOf(out)}`;
		// prints._norm / identify._norm / naming._key: whitespace collapsed, casefolded — no reference on any of these
		patch(ref, { transcription: { speakers: { speaker_0: 'tom whitfield', speaker_1: 'Tom  Whitfield', speaker_2: 'Tom Whitfield-Smith' },
			previous_speakers: { diarization_id: 'aabbccddee00', labels: { speaker_0: { name: 'TOM WHITFIELD', new_label: 'speaker_1', share: 1, offered: true } } },
			speaker_questions: { speaker_3: { quotes: [], proposed: { name: ' tom\twhitfield ', origin: 'previous' } } } } });
		const tom = await personRecords(root, 'contacts/tom-whitfield');
		const row = tom.find((r) => r.record === ref);
		assert.ok(row, `the record naming 'tom whitfield' is not found: ${JSON.stringify(tom.map((r) => r.record))}`);
		assert.deepEqual(row.matches, [
			{ label: 'speaker_0', where: 'speakers', diarization_id: null },
			{ label: 'speaker_1', where: 'speakers', diarization_id: null },
			{ label: 'speaker_0', where: 'previous_speakers', diarization_id: 'aabbccddee00', new_label: 'speaker_1' },
			{ label: 'speaker_3', where: 'speaker_questions', diarization_id: null }]);
	});
});

describe('normName — the one name rule, as the Python halves have it', () => {
	test('line 24 case and every run of whitespace fold; nothing else does', () => {
		assert.equal(normName('  Dana \t Oren\n'), 'dana oren');
		assert.equal(normName('STRASSE'), normName('stra\u00dfe'), 'casefold, not lower: the sharp s folds to ss');
		assert.equal(normName(null), '');
		assert.equal(normName('Dana\u00a0Oren'), 'dana oren', 'a no-break space is whitespace to str.split()');
		assert.equal(normName('Dana\u001fOren'), 'dana oren', 'so is a unit separator');
		assert.equal(normName('Dana\ufeffOren'), 'dana\ufeffOren'.toLowerCase(), 'a byte-order mark is not (JavaScript\'s \\s says it is)');
		assert.notEqual(normName('Dana Oren'), normName('Dana-Oren'));
	});
});

// ── the node entry: a stand-in transcriber copies what it was handed ────────────────────────────────
const ENTRY = path.join(root, 'modules', 'recordings', 'bin', 'transcribe.mjs');
function stubUv() {
	const dir = tmp('dtm-vc-bin-');
	fs.writeFileSync(path.join(dir, 'uv'), [
		'#!/bin/sh',
		'printf "%s\\n" "$@" > "$CAPTURE/argv"',
		'printf "%s" "$VOICE_PRINTS_HOME" > "$CAPTURE/voice_prints_home"',
		'prev=""; for a in "$@"; do if [ "$prev" = "--context" ]; then printf "%s" "$a" > "$CAPTURE/context_path"; cp "$a" "$CAPTURE/context.json"; fi; prev="$a"; done',
		'exit 0', ''].join('\n'), { mode: 0o755 });
	return dir;
}
const BIN = stubUv();
/** Run the node entry with the stand-in uv first on PATH; return what the stand-in captured. */
function entry(args, { dotenv } = {}) {
	const capture = tmp('dtm-vc-cap-');
	const envFile = path.join(root, '.env');
	const before = fs.readFileSync(envFile, 'utf8');
	if (dotenv) fs.writeFileSync(envFile, before + dotenv);
	const env = { ...process.env, PATH: `${BIN}${path.delimiter}${process.env.PATH}`, CAPTURE: capture, TRANSCRIPTION_HOME: tmp('dtm-vc-th-') };
	delete env.VOICE_PRINTS_HOME;
	let r;
	try { r = spawnSync(process.execPath, [ENTRY, ...args], { cwd: root, env, encoding: 'utf8', timeout: 120_000 }); }
	finally { fs.writeFileSync(envFile, before); }
	const read = (f) => (fs.existsSync(path.join(capture, f)) ? fs.readFileSync(path.join(capture, f), 'utf8') : null);
	const argv = read('argv')?.split('\n').filter((l, i, a) => i < a.length - 1) ?? null;
	return { r, argv, context: read('context.json') && JSON.parse(read('context.json')), contextPath: read('context_path'), voicePrintsHome: read('voice_prints_home') };
}
const head3 = (argv) => argv.slice(0, 3);

describe('transcribe.mjs hands the child its context', () => {
	test('line 03 `run` writes the recording\'s context to a temp file, passes it by --context, and removes it after', () => {
		seed();
		const file = path.join(root, getJson(S.rec1).$file);
		const { r, argv, context, contextPath } = entry(['run', file, '/audio/x.m4a', '--speakers', '2']);
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(head3(argv), ['run', 'python', 'transcribe_meeting.py']);
		assert.deepEqual(argv.slice(3, 8), ['run', file, '/audio/x.m4a', '--speakers', '2']);
		assert.equal(argv.at(-2), '--context');
		assert.equal(context.record, S.rec1);
		assert.equal(context.attendee_count, 2);
		assert.ok(!fs.existsSync(contextPath), 'the context file outlived the child');
	});

	test('VOICE_PRINTS_HOME in the workspace .env reaches the child', () => {
		seed();
		const store = path.join(tmp('dtm-vc-store-'), 'voice-prints');
		const { r, voicePrintsHome } = entry(['prints', 'list'], { dotenv: `VOICE_PRINTS_HOME=${store}\n` });
		assert.equal(r.status, 0, r.stderr);
		assert.equal(voicePrintsHome, store);
	});

	test('`setup` forwards its arguments (D9): `setup --speaker-models all` reaches the child\'s argv', () => {
		const { r, argv } = entry(['setup', '--speaker-models', 'all']);
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(argv, ['run', 'python', 'transcribe_meeting.py', 'setup', '--speaker-models', 'all']);
	});

	test('one record: `identify <record>` and `label <record>` get that record\'s context; the argument becomes its path', () => {
		seed();
		const one = entry(['identify', S.rec1]);
		assert.equal(one.r.status, 0, one.r.stderr);
		assert.deepEqual(one.argv.slice(3, 5), ['identify', path.join(root, getJson(S.rec1).$file)]);
		assert.equal(one.context.record, S.rec1);
		assert.equal(one.context.records, undefined);
		const label = entry(['label', S.rec4, '--only', 'speaker_1']);
		assert.equal(label.r.status, 0, label.r.stderr);
		assert.deepEqual(label.argv.slice(3, 7), ['label', path.join(root, getJson(S.rec4).$file), '--only', 'speaker_1']);
		assert.equal(label.context.meeting.ref, S.underCompany);
		const answer = entry(['identify', '--answer', S.rec1, 'speaker_1=contacts/sam-diaz', 'speaker_0=skip']);
		assert.deepEqual(answer.argv.slice(3), ['identify', '--answer', path.join(root, getJson(S.rec1).$file), 'speaker_1=contacts/sam-diaz', 'speaker_0=skip', '--context', answer.contextPath]);
		assert.equal(answer.context.record, S.rec1);
	});

	test('several records: `identify --question <r1> <r2>` gets `{records: [<context>…]}`', () => {
		seed();
		const { r, context } = entry(['identify', '--question', S.rec1, S.rec3]);
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(context.records.map((c) => c.record), [S.rec1, S.rec3]);
		assert.deepEqual(context.records.map((c) => c.attendee_count_certain), [true, false]);
		assert.equal(context.workspace, 'probe');
		assert.ok(context.guard.workspace);
	});

	test('`evaluate-speakers` gets every recording that has a `transcription.diarization_id`', () => {
		seed();
		const { r, argv, context } = entry(['evaluate-speakers', 'plan']);
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(argv.slice(3, 5), ['evaluate-speakers', 'plan']);
		assert.deepEqual(context.records.map((c) => c.record).sort(), [S.rec1, S.rec2, S.rec3].sort());
		assert.ok(context.records.every((c) => 'meeting' in c && 'documents' in c && 'candidates' in c));
	});

	test('`prints forget|never <person>` and `identify --revert --person <ref>` get `person_records`', () => {
		seed();
		for (const args of [['prints', 'forget', 'contacts/sam-diaz'], ['prints', 'never', 'contacts/sam-diaz'], ['identify', '--revert', '--person', 'contacts/sam-diaz']]) {
			const { r, argv, context } = entry(args);
			assert.equal(r.status, 0, r.stderr);
			assert.deepEqual(argv.slice(3, 3 + args.length), args, 'the person stays a reference');
			assert.deepEqual(context.person, { ref: 'contacts/sam-diaz', name: 'Sam Diaz' });
			assert.deepEqual(context.person_records.map((p) => p.record).sort(), [S.rec1, S.rec2, S.rec3, S.rec5].sort(), args.join(' '));
			assert.equal(context.workspace, 'probe');
		}
		const fr = entry(['prints', 'forget-recording', S.rec1]);
		assert.equal(fr.context.record, S.rec1);
		const rebuild = entry(['prints', 'rebuild']);
		assert.equal(rebuild.r.status, 0, rebuild.r.stderr);
		assert.deepEqual([rebuild.context.workspace, rebuild.context.record, rebuild.context.known['users/dana-oren']], ['probe', undefined, 'Dana Oren']);
		// rebuild computes from the diarised recordings what the active model lacks (finding rebuild-before-new-model-signatures-drops-sources)
		assert.deepEqual(rebuild.context.records.map((c) => c.record).sort(), [S.rec1, S.rec2, S.rec3].sort());
	});

	test('line 27 the text routes go through the entry too: `log` and `parse-labeled` reach the script on the entry\'s venv, with no context, each path made absolute (finding transcribe-skill-runs-the-python-without-a-context)', () => {
		const dir = tmp('dtm-vc-text-');
		const turns = path.join(dir, 'turns.json'), text = path.join(dir, 'transcript.txt'), rec = path.join(dir, 'x.meeting-recording.md');
		for (const f of [turns, text, rec]) fs.writeFileSync(f, '');
		const log = entry(['log', path.relative(root, rec), turns, '--date', '2026-09-01']);
		assert.equal(log.r.status, 0, log.r.stderr);
		assert.deepEqual(log.argv, ['run', 'python', 'transcribe_meeting.py', 'log', rec, turns, '--date', '2026-09-01'], 'a relative path is made absolute: the child runs in the skill folder');
		const parse = entry(['parse-labeled', text]);
		assert.equal(parse.r.status, 0, parse.r.stderr);
		assert.deepEqual(parse.argv, ['run', 'python', 'transcribe_meeting.py', 'parse-labeled', text]);
		assert.equal(parse.context, null, 'a text route keeps no voice: no context');
		const usage = entry(['nonsense']).r.stderr;
		for (const v of ['log', 'parse-labeled']) assert.match(usage, new RegExp(`\\b${v}\\b`));
	});

	test('an unknown verb prints the usage line naming every verb, and exits 2', () => {
		const { r, argv } = entry(['nonsense']);
		assert.equal(r.status, 2);
		assert.equal(argv, null, 'nothing was spawned');
		for (const v of ['sync', 'setup', 'verify', 'run', 'identify', 'prints', 'label', 'evaluate-speakers']) assert.match(r.stderr, new RegExp(`\\b${v}\\b`));
	});

	test('an interrupted child (SIGINT or SIGTERM to the entry) still leaves no context file behind', async () => {
		seed();
		// a stand-in uv that notes where its context is, then becomes a long sleep — the child still running
		const slow = tmp('dtm-vc-slow-');
		fs.writeFileSync(path.join(slow, 'uv'), [
			'#!/bin/sh',
			'prev=""; for a in "$@"; do if [ "$prev" = "--context" ]; then printf "%s" "$a" > "$CAPTURE/context_path.tmp"; mv "$CAPTURE/context_path.tmp" "$CAPTURE/context_path"; fi; prev="$a"; done',
			'exec sleep 60', ''].join('\n'), { mode: 0o755 });
		for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
			const capture = tmp('dtm-vc-cap-');
			const env = { ...process.env, PATH: `${slow}${path.delimiter}${process.env.PATH}`, CAPTURE: capture, TRANSCRIPTION_HOME: tmp('dtm-vc-th-') };
			delete env.VOICE_PRINTS_HOME;
			const child = spawn(process.execPath, [ENTRY, 'identify', S.rec1], { cwd: root, env, stdio: 'ignore' });
			const exited = new Promise((res) => child.on('exit', (c, s) => res([c, s])));
			const at = path.join(capture, 'context_path');
			for (let i = 0; i < 600 && !fs.existsSync(at); i++) await new Promise((res) => setTimeout(res, 100));
			assert.ok(fs.existsSync(at), `${sig}: the child never started`);
			const contextPath = fs.readFileSync(at, 'utf8');
			assert.ok(fs.existsSync(contextPath), `${sig}: the context exists while the child runs`);
			const t0 = Date.now();
			child.kill(sig);
			const [status, signal] = await exited;
			assert.deepEqual([status, signal], [code, null], `${sig}: the entry exits 128 + the signal's number`);
			assert.ok(Date.now() - t0 < 30_000, `${sig}: the entry waited for the child's sleep instead of stopping it`);
			assert.ok(!fs.existsSync(contextPath), `${sig}: the context file outlived the interrupted child`);
			assert.ok(!fs.existsSync(path.dirname(contextPath)), `${sig}: the context's temp folder outlived the interrupted child`);
		}
	});

	test('a record the workspace does not hold is refused before the child starts', () => {
		const { r, argv } = entry(['identify', 'meeting-recordings/2026/01/2026-01-01--nothing']);
		assert.notEqual(r.status, 0);
		assert.equal(argv, null);
		assert.match(r.stderr, /no such record|not a meeting-recordings record/);
	});
});
