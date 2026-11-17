// The commands and skills say what the descriptors say — the meetings descriptor this module reads
// people from, and this module's own recording descriptor. Pinned after the meetings 0.1.2 remodel
// moved the contact refs to `attendees_contacts`: a speaker count read off `attendees | length` would
// have counted the API's raw list, declined guests included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { MODULES } from '../../../tests/helpers/workspace.mjs';

const read = (rel) => fs.readFileSync(path.join(MODULES, rel), 'utf8');
const fields = (rel) => yaml.load(read(rel)).fields;
const MEETINGS = fields('meetings/collections/meetings.collection.yaml');
const RECORDINGS = fields('recordings/collections/meeting-recordings.collection.yaml');

/** Every prose file this module ships: the commands, the skills (the identifying skill and /identify-speakers
 *  among them, cr-modules-019), the README and SETUP. */
const shipped = ['commands', 'skills'].flatMap((d) => {
	const out = [];
	const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) e.isDirectory() ? walk(path.join(p, e.name)) : e.name.endsWith('.md') && out.push(path.join(p, e.name)); };
	walk(path.join(MODULES, 'recordings', d));
	return out;
}).concat(['README.md', 'SETUP.md'].map((f) => path.join(MODULES, 'recordings', f)));

test('the shipped walk reaches every prose file the package ships, the identifying skill and /identify-speakers included', () => {
	const rel = shipped.map((f) => path.relative(path.join(MODULES, 'recordings'), f));
	for (const f of ['skills/identifying-speakers/SKILL.md', 'commands/identify-speakers.command.md', 'skills/transcribing-recordings/SKILL.md', 'commands/transcribe-recording.command.md', 'README.md', 'SETUP.md']) {
		assert.ok(rel.includes(f), `${f} is not in the walk`);
	}
	const files = JSON.parse(read('recordings/package.json')).files;
	for (const f of rel) assert.ok(files.includes(f.split('/')[0]), `${f} is outside the package's files`);
});

test('every command this module ships has its binding on meeting-recordings, and every binding names a shipped command', () => {
	const cmds = fs.readdirSync(path.join(MODULES, 'recordings', 'commands')).map((f) => f.replace(/\.command\.md$/, '')).sort();
	const bound = fs.readdirSync(path.join(MODULES, 'recordings', 'command-bindings')).map((f) => yaml.load(read(`recordings/command-bindings/${f}`)).command.replace(/^commands\//, '')).sort();
	assert.deepEqual(bound, cmds);
	assert.ok(cmds.includes('identify-speakers'));
});

test('the speaker count is the meeting\'s `attendees_contacts | length`, a field the meetings module declares', () => {
	assert.equal(MEETINGS.attendees_contacts?.type, 'contacts');
	assert.match(read('recordings/commands/transcribe-recording.command.md'), /`attendees_contacts \| length`/);
	assert.match(read('recordings/skills/transcribing-recordings/SKILL.md'), /`attendees_contacts \| length`/);
	const stale = shipped.filter((f) => /`attendees \| length`/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(MODULES, f));
	assert.deepEqual(stale, [], 'a count off the raw API list includes people who declined');
});

test('a shim meeting\'s people are written as `attendees_contacts` refs, never into the API list', () => {
	assert.match(read('recordings/commands/match-recording-to-meeting.command.md'), /`attendees_contacts` as `contacts\/` refs/);
	assert.equal(MEETINGS.attendees?.type, 'object', 'the raw list is the API\'s objects, which a shim has none of');
});

test('the transcription block carries the transcriber\'s notes, and the descriptor says so', () => {
	assert.equal(RECORDINGS.transcription.type, 'map');
	assert.match(RECORDINGS.transcription.description, /`notes`: the transcriber's own caveats/);
	assert.equal(RECORDINGS.notes.type, 'string');
	assert.match(RECORDINGS.notes.description, /the capture itself/);
	assert.match(read('recordings/commands/transcribe-recording.command.md'), /`transcription\.notes`/);
});

/** Every prose file the recordings and meeting-docs packages ship: their commands and skills, and their
 *  README and SETUP where they have one. */
const prose = ['recordings', 'meeting-docs'].flatMap((mod) => {
	const out = [];
	const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) e.isDirectory() ? walk(path.join(p, e.name)) : e.name.endsWith('.md') && out.push(path.join(p, e.name)); };
	for (const d of ['commands', 'skills']) if (fs.existsSync(path.join(MODULES, mod, d))) walk(path.join(MODULES, mod, d));
	for (const f of ['README.md', 'SETUP.md']) if (fs.existsSync(path.join(MODULES, mod, f))) out.push(path.join(MODULES, mod, f));
	return out;
});

test('line 27 no shipped prose runs `run`, `identify` or `prints` without the node entry, which writes their --context (finding transcribe-skill-runs-the-python-without-a-context)', () => {
	assert.ok(prose.some((f) => f.includes(`${path.sep}meeting-docs${path.sep}commands${path.sep}`)), 'the walk reaches meeting-docs');
	// a bare `transcribe_meeting.py run|identify|prints`, a line continuation between them included
	const bare = /transcribe_meeting\.py(?:\s|\\)+(run|identify|prints)\b/;
	const hits = prose.filter((f) => bare.test(fs.readFileSync(f, 'utf8'))).map((f) => `${path.relative(MODULES, f)}: ${bare.exec(fs.readFileSync(f, 'utf8'))[0].replace(/\s+/g, ' ')}`);
	assert.deepEqual(hits, [], 'without --context a transcript keeps no voice signature and /identify-speakers can never name it');
	// the skill's audio route and its direct-upload route each run the entry's `run`
	const skill = read('recordings/skills/transcribing-recordings/SKILL.md');
	const entryRun = /node node_modules\/@dreamteamer\/recordings\/bin\/transcribe\.mjs(?:\s|\\)+run\b/;
	const audio = skill.slice(skill.indexOf('## audio route'), skill.indexOf('## text routes'));
	const upload = skill.slice(skill.indexOf('### direct upload'), skill.indexOf('## audio route'));
	assert.match(audio, entryRun, 'the audio route runs the entry');
	assert.match(upload, entryRun, 'the direct upload runs the entry');
	// and no command runs the script by hand at all: the entry sets the venv (test_locations.py)
	const byHand = prose.filter((f) => /uv run python transcribe_meeting\.py/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(MODULES, f));
	assert.deepEqual(byHand, [], 'every command goes through the entry');
	// a shell variable a command uses is one the prose defines
	const undefinedSk = prose.filter((f) => { const t = fs.readFileSync(f, 'utf8'); return /\$SK\b|"\$SK"/.test(t) && !/\bSK=/.test(t); }).map((f) => path.relative(MODULES, f));
	assert.deepEqual(undefinedSk, [], '`$SK` is used and never set');
});
