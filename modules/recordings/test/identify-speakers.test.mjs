// /IDENTIFY-SPEAKERS ON THE SURFACE (cr-modules-019 task 11). The Python names voices (tasks 9 and 10); this
// file proves what a workspace and a session see of it: the `speaker_naming` field, the binding that offers
// /identify-speakers by `dt next` (design sections 3, 11 and 12 — a gate can test only a top-level field),
// the command and the identifying skill, the transcription files that no longer fill the name map, and the
// README's voice prints section (design section 15).
//
// A real engine and a fixture workspace with the module installed from this folder (`installCopied`). Nothing
// here runs Python, reads a voice or touches a voice-print store; the records are synthetic (Northwind).
//
// Test names starting `line 05 `, `line 21 `, `line 28 `, `line 40 ` and `line 41 ` are the node half of
// those acceptance lines, run by name pattern (plan rulings D11, D12).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { ROOT, MODULES, virginWorkspace, installCopied, closure, run, cleanup, pkgOf, ENGINE_VERSION } from '../../../tests/helpers/workspace.mjs';
import { engineMeets } from 'dreamteamer/testing';

after(() => cleanup());

const MOD = path.join(MODULES, 'recordings');
const read = (rel) => fs.readFileSync(path.join(MOD, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(MOD, rel));
const SKILL = 'skills/identifying-speakers/SKILL.md';
const COMMAND = 'commands/identify-speakers.command.md';
const BINDING = 'command-bindings/identify-speakers--meeting-recordings.command-binding.yaml';
const TRANSCRIBE_SKILL = 'skills/transcribing-recordings/SKILL.md';
const TRANSCRIBE_COMMAND = 'commands/transcribe-recording.command.md';
const readIf = (rel) => (exists(rel) ? read(rel) : '');

/** Every prose file a user or a session reads: the commands, the skills, the README and SETUP. Never the
 *  developer's `docs/`, which the package does not ship. */
const userFacing = () => {
	const out = ['README.md', 'SETUP.md'];
	const walk = (rel) => {
		for (const e of fs.readdirSync(path.join(MOD, rel), { withFileTypes: true })) {
			const r = path.join(rel, e.name);
			if (e.isDirectory()) walk(r);
			else if (e.name.endsWith('.md')) out.push(r);
		}
	};
	walk('commands');
	walk('skills');
	return out;
};

/** The README's `## Voice prints` section, up to the next second-level heading. */
const voicePrintsSection = () => {
	const m = /^## Voice prints\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(read('README.md'));
	return m ? m[1] : '';
};
const flat = (s) => s.replace(/\s+/g, ' ');

// ── the fixture: one compiled workspace with this folder's recordings ────────────────────────────────────
const W = {};
function workspace() {
	if (W.root) return W;
	const root = virginWorkspace();
	installCopied(root, [...closure('recordings')]);
	const compiled = run(root, ['compile']);
	assert.equal(compiled.status, 0, `compile failed:\n${compiled.stderr}\n${compiled.stdout}`);
	W.root = root;
	W.n = 0;
	return W;
}
const dt = (...args) => {
	const r = run(W.root, args);
	assert.equal(r.status, 0, `dt ${args.join(' ')} failed:\n${r.stderr}\n${r.stdout}`);
	return r.stdout;
};
/** A transcribed recording: `recording_file` set, a `transcription` block written the way the transcriber
 *  writes one, and `speaker_naming` as given (absent for undefined). Returns its reference. */
function recording(naming, transcription = { diarization_id: '7c1d09a4e2b1', speaker_count: 2, speakers: {} }) {
	workspace();
	W.n += 1;
	const out = dt('add', 'meeting-recordings', '--name', `Northwind weekly ${W.n}`, '--date', `2026-11-${String(W.n).padStart(2, '0')}T15:00:00+02:00`,
		'--recording_file', `\${env:FILES_FOLDER}/meeting-recordings/northwind-weekly-${W.n}.m4a`);
	const id = /data\/meeting-recordings\/(.+)\.meeting-recording\.md/.exec(out)[1];
	const ref = `meeting-recordings/${id}`;
	patch(ref, (fm) => {
		if (transcription) fm.transcription = transcription;
		if (naming !== undefined) fm.speaker_naming = naming;
	});
	return ref;
}
/** Change a record's frontmatter on disk, as the transcriber does. */
function patch(ref, fn) {
	const file = path.join(W.root, JSON.parse(dt('get', ref, '--json')).$file);
	const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(fs.readFileSync(file, 'utf8'));
	const fm = yaml.load(m[1]);
	fn(fm);
	fs.writeFileSync(file, `---\n${yaml.dump(fm, { lineWidth: -1 })}---\n${m[2]}`);
}
/** `dt next <ref>`'s state of /identify-speakers: available, done or not-applicable (absent: no binding). */
function identifyState(ref) {
	const r = run(W.root, ['next', ref, '--json']);
	assert.equal(r.status, 0, r.stderr + r.stdout);
	const id = ref.slice('meeting-recordings/'.length);
	const c = JSON.parse(r.stdout).commands.find((x) => /(^|\/)identify-speakers$/.test(x.name));
	return c ? c.states[id] : 'no binding';
}

describe('/identify-speakers offered by dt next, on top-level fields only', () => {
	test('line 41 dt next offers /identify-speakers with speaker_naming empty or waiting, and not when named or closed', () => {
		const empty = recording(undefined);
		const waiting = recording('waiting');
		const named = recording('named');
		const closed = recording('closed');
		assert.equal(identifyState(empty), 'available', 'a transcribed recording the step has not run on');
		assert.equal(identifyState(waiting), 'available', 'machine names not yet shown, or a question open');
		assert.notEqual(identifyState(named), 'available', 'every voice answered, shown or closed by a person');
		assert.notEqual(identifyState(closed), 'available');
		assert.equal(identifyState(named), 'done');
	});

	test('line 41 a recording waiting on unshown names stays offered until --shown makes it named', () => {
		// what an unattended run leaves (task 9's Line41): a provisional name written, never shown
		const ref = recording('waiting', {
			diarization_id: '7c1d09a4e2b1', speakers: { speaker_0: 'Dana Oren' },
			speaker_sources: { speaker_0: { name: 'Dana Oren', person: 'users/dana-oren', origin: 'print', status: 'provisional', score: 0.91 } },
			speaker_questions: { speaker_0: { quotes: [{ at: '01:05', text: 'so the plan for this week is to finish the migration' }, { at: '26:48', text: 'send me the file and I will take that one' }] } },
		});
		assert.equal(identifyState(ref), 'available');
		// `identify --shown` stamps the question and the state follows the table of section 11
		patch(ref, (fm) => { fm.transcription.speaker_questions.speaker_0.shown = '2026-11-20T10:02:11+02:00'; fm.speaker_naming = 'named'; });
		assert.equal(identifyState(ref), 'done');
	});

	test('line 41 not offered without a transcription or without audio — the binding needs recording_file and transcription', () => {
		assert.equal(identifyState(recording(undefined, null)), 'not-applicable', 'nothing transcribed yet');
		const pasted = recording(undefined);
		patch(pasted, (fm) => { delete fm.recording_file; });
		assert.equal(identifyState(pasted), 'not-applicable', 'a pasted transcript has no voices to name');
	});

	test('line 41 the field is the descriptor\'s enum: dt check takes waiting, named and closed and refuses anything else', () => {
		workspace();
		const bad = recording('maybe');
		const r = run(W.root, ['check']);
		assert.notEqual(r.status, 0, 'an unknown speaker_naming value passed dt check');
		assert.match(r.stdout + r.stderr, /speaker_naming/);
		patch(bad, (fm) => { fm.speaker_naming = 'waiting'; });
		const ok = run(W.root, ['check']);
		assert.equal(ok.status, 0, `${ok.stdout}\n${ok.stderr}`);
	});

	test('line 40 a recording set closed is not offered, and once run clears speaker_naming it is offered again', () => {
		// identify on a recording transcribed before voice prints: no diarisation id, closed, the message
		const ref = recording('closed', {
			generated: '2026-09-02', speaker_count: 2, speakers: { speaker_0: 'Dana Oren' },
			identification: { outcome: 'needs-retranscription', reports: ['transcribed before voice prints; transcribe it again to name or confirm its voices'] },
		});
		assert.notEqual(identifyState(ref), 'available');
		// `run` again: a diarisation id, the names moved aside, speaker_naming cleared
		patch(ref, (fm) => {
			delete fm.speaker_naming;
			fm.transcription = { diarization_id: '3be0f1c29a77', speakers: {}, previous_speakers: { labels: { speaker_0: { name: 'Dana Oren', new_label: 'speaker_1', offered: true } } } };
		});
		assert.equal(identifyState(ref), 'available');
	});

	test('line 40 the binding gates on top-level fields only: speaker_naming, transcription, recording_file', () => {
		assert.ok(exists(BINDING), `${BINDING} is missing`);
		const b = yaml.load(read(BINDING));
		assert.equal(b.command, 'commands/identify-speakers');
		assert.equal(b.collection, 'collections/meeting-recordings');
		assert.equal(b.scope, 'record');
		const keys = (f) => Object.entries(f ?? {}).flatMap(([k, v]) => (k === '_or' || k === '_and' ? v.flatMap(keys) : [k]));
		assert.deepEqual([...new Set(keys(b.available_when))].sort(), ['recording_file', 'speaker_naming', 'transcription']);
		assert.deepEqual([...new Set(keys(b.done_when))], ['speaker_naming']);
		const nested = (f) => Object.entries(f ?? {}).some(([k, v]) => (k === '_or' || k === '_and' ? v.some(nested) : Object.keys(v ?? {}).some((op) => !op.startsWith('_'))));
		assert.equal(nested(b.available_when) || nested(b.done_when), false, 'a key inside a map evaluates false for every record');
	});
});

describe('the identifying skill and the command', () => {
	test('line 05 the skill and the command say one question at the end of the run, with two quotes and the attendees', () => {
		for (const rel of [SKILL, COMMAND]) {
			assert.ok(exists(rel), `${rel} is missing`);
			const t = flat(read(rel));
			assert.match(t, /one question at the end of the run/i, rel);
		}
		const skill = flat(read(SKILL));
		assert.match(skill, /two quotes/);
		assert.match(skill, /attendees/);
		assert.match(skill, /--question/);
	});

	test('line 05 an agent never answers the question itself — the sentence is in the skill and the command', () => {
		for (const rel of [SKILL, COMMAND]) {
			assert.match(flat(readIf(rel)), /an agent never answers the question itself and never calls `--answer` or `--confirm` without a person's reply in the conversation/i, rel);
		}
	});

	test('line 05 the skill shows the message, then runs --shown, then applies the reply; never --confirm bare', () => {
		const t = flat(readIf(SKILL));
		const ask = t.search(/identify --question/), shown = t.search(/identify --shown/), answer = t.search(/identify --answer/);
		assert.ok(ask >= 0 && shown > ask && answer > shown, 'the order is --question, --shown, --answer');
		assert.match(t, /right after/i, '--shown right after the message is put to a person');
		assert.match(t, /never (?:run|call) `--confirm` bare/i);
		assert.match(t, /name the labels the person confirmed/i);
		assert.match(t, /confirming a name stores a voice print/i);
	});

	test('line 05 the trust sentence is design section 9\'s: two recordings that match each other, with a minute of their speech between them', () => {
		for (const rel of [SKILL, 'README.md']) {
			assert.match(flat(readIf(rel)), /two recordings that match each other, with a minute of their speech between them/, rel);
		}
	});

	test('line 05 a user is never asked to run label — no user-facing file names label or evaluate-speakers', () => {
		const files = userFacing();
		assert.ok(files.includes(SKILL) && files.includes(COMMAND), 'the walk reaches the new skill and command');
		const developer = /evaluate-speakers|`label`|`label <|(?:^|[\s(])label <record>|transcribe(?:_meeting\.py|\.mjs)\s+label\b|voice-prints-calibration/;
		const named = files.filter((f) => developer.test(read(f)));
		assert.deepEqual(named, [], 'the calibration tools are the developer\'s, described in docs/ only');
		assert.ok(!pkgOf('recordings').files.includes('docs'), 'docs/ is not in the package');
	});

	test('line 05 the skill says what each refusal means', () => {
		const t = flat(readIf(SKILL));
		for (const r of [/transcribed before voice prints/, /--speakers N/, /may hold more than one voice/, /no known voice matched/,
			/a mixed diarisation is suspected/, /conflicts with/, /who was not invited/, /prints rebuild/, /prints reseed/]) assert.match(t, r);
	});
});

describe('transcription writes no name', () => {
	test('line 21 no shipped prose file tells the session to fill transcription.speakers', () => {
		const fill = [
			/name-map/i, /speaker map/i, /\(you fill\)[^|\n]*speakers|`speakers` \(you fill\)/, /fill(?:ing|s)?\b[^.\n|]{0,40}\bspeakers?\b/i,
			/edit\s+`?transcription\.speakers/i, /map(?:ping)? (?:labels to people|speakers)/i, /leave it unmapped/i, /guessing `speaker_0/,
		];
		const hits = userFacing().flatMap((f) => fill.filter((r) => r.test(read(f))).map((r) => `${f}: ${r}`));
		assert.deepEqual(hits, []);
	});

	test('line 21 both transcription files say /identify-speakers writes the names and transcription leaves speakers empty', () => {
		for (const rel of [TRANSCRIBE_SKILL, TRANSCRIBE_COMMAND]) {
			const t = flat(read(rel));
			assert.match(t, /names are written by `\/identify-speakers`/i, rel);
			assert.match(t, /transcription leaves `(?:transcription\.)?speakers` empty/i, rel);
		}
	});

	test('line 21 the re-run row is rewritten: run moves names aside, /identify-speakers proposes them again, log still replaces the block', () => {
		const t = flat(read(TRANSCRIBE_SKILL));
		assert.doesNotMatch(t, /over a hand-filled speaker map/);
		assert.match(t, /`previous_speakers`/);
		assert.match(t, /`log`[^|]*replaces the block/);
	});

	test('line 21 the descriptor names speaker_naming and the transcription block\'s new keys', () => {
		const f = yaml.load(read('collections/meeting-recordings.collection.yaml')).fields;
		assert.equal(f.speaker_naming?.type, 'string');
		assert.deepEqual(f.speaker_naming.enum, ['waiting', 'named', 'closed']);
		assert.ok(!f.speaker_naming.required && !('default' in f.speaker_naming), 'optional, no default: a record without it is one the step has not run on');
		for (const k of ['speakers_hint', 'diarization_fallback', 'diarization_id', 'speaker_sources', 'speaker_questions', 'identification', 'previous_speakers']) {
			assert.match(f.transcription.description, new RegExp(`\`${k}\``), k);
		}
	});
});

describe('the README\'s voice prints', () => {
	test('line 28 the README section carries each clause of line 28', () => {
		const s = flat(voicePrintsSection());
		assert.ok(s, 'no `## Voice prints` section in the README');
		// confirming a name stores a voice print of that person on this computer
		assert.match(s, /Confirming a name stores a voice print/);
		assert.match(s, /stores a \*voice print\* of that person on this computer/);
		// the user's responsibility, where they and the person live
		assert.match(s, /You are responsible for having the right to store a voice print of each person you name, under the law where you and they live/);
		// what the folder holds
		assert.match(s, /What the folder holds/);
		assert.match(s, /every speaker of every recording you transcribe, named or not/);
		// copied nowhere
		assert.match(s, /sends the folder nowhere/);
		assert.match(s, /never written to a record, to git or to an export/);
		// Time Machine excluded, other backups not
		assert.match(s, /excludes the folder from Time Machine/);
		assert.match(s, /cannot stop another backup tool, a disk clone or a migration to a new computer from copying it/);
		// how to forget and what remains
		assert.match(s, /`prints forget <person>`/);
		assert.match(s, /leaves their name on your transcripts/);
		assert.match(s, /`prints never <person>`/);
		assert.match(s, /`prints forget-recording <recording>`/);
	});

	test('line 28 the store defaults table, VOICE_PRINTS_HOME, and the calibration counts left for the shipped file', () => {
		const s = voicePrintsSection();
		assert.match(s, /~\/Library\/Application Support\/dreamteamer\/voice-prints/);
		assert.match(s, /\$\{XDG_DATA_HOME:-~\/\.local\/share\}\/dreamteamer\/voice-prints/);
		assert.match(s, /%LOCALAPPDATA%\\dreamteamer\\voice-prints/);
		assert.match(s, /`VOICE_PRINTS_HOME`/);
		assert.match(s, /\[counts from the shipped file\]/);
		assert.ok(pkgOf('recordings').dreamteamer.env.includes('VOICE_PRINTS_HOME'), 'dreamteamer.env declares VOICE_PRINTS_HOME');
	});

	test('line 28 the README names /identify-speakers in the flow and the speaker model in SETUP', () => {
		assert.match(read('README.md'), /`\/identify-speakers`/);
		assert.match(flat(read('SETUP.md')), /speaker model/);
		assert.match(read('SETUP.md'), /models\/speaker\//);
	});
});

test('the binding compiles alone: dt check modules/recordings --alone exits 0', { skip: !engineMeets('>=0.49.0') && `dt check --alone needs engine 0.49.0; testing ${ENGINE_VERSION}` }, () => {
	const r = run(ROOT, ['check', 'modules/recordings', '--alone']);
	assert.equal(r.status, 0, `exit ${r.status}\n${r.stdout}\n${r.stderr}`);
	assert.match(r.stdout, /✔ modules\/recordings is publishable/);
	const ws = workspace();
	assert.ok(fs.existsSync(path.join(ws.root, '.dreamteamer', 'command-bindings', 'identify-speakers--meeting-recordings.command-binding.yaml')), 'the binding is compiled');
	assert.ok(fs.existsSync(path.join(ws.root, '.dreamteamer', 'skills', 'identifying-speakers', 'SKILL.md')), 'the skill is compiled');
});
