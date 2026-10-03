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

/** Every prose file this module ships. */
const shipped = ['commands', 'skills'].flatMap((d) => {
	const out = [];
	const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) e.isDirectory() ? walk(path.join(p, e.name)) : e.name.endsWith('.md') && out.push(path.join(p, e.name)); };
	walk(path.join(MODULES, 'recordings', d));
	return out;
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
