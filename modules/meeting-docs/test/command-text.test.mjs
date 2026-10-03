// The commands and skills say what the descriptors say. Each key the text tells an agent to read or
// write is checked against the descriptor that declares it, so the two cannot drift apart unseen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { MODULES } from '../../../tests/helpers/workspace.mjs';

const read = (rel) => fs.readFileSync(path.join(MODULES, rel), 'utf8');
const fields = (rel) => yaml.load(read(rel)).fields;
const SUMMARIZE = read('meeting-docs/commands/summarize-meeting.command.md');
const RECORDINGS = fields('recordings/collections/meeting-recordings.collection.yaml');
const SUMMARIES = fields('meeting-docs/collections/meeting-summaries.collection.yaml');

/** Every prose file this module ships. */
const shipped = ['commands', 'skills'].flatMap((d) => {
	const out = [];
	const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) e.isDirectory() ? walk(path.join(p, e.name)) : e.name.endsWith('.md') && out.push(path.join(p, e.name)); };
	walk(path.join(MODULES, 'meeting-docs', d));
	return out;
});

test('the first step of summarize-meeting stops on a restricted meeting, naming the field', () => {
	const privacy = SUMMARIZE.indexOf('`privacy`');
	assert.ok(privacy > 0, 'summarize-meeting never names `privacy`');
	assert.ok(privacy < SUMMARIZE.indexOf('read two sources'), 'the privacy check must come before any source is read');
	assert.match(SUMMARIZE, /`privacy: restricted`: no summary is written/);
});

test('the speaker map is `transcription.speakers`; the two caveat fields are both read, and told apart', () => {
	assert.equal(RECORDINGS.notes?.type, 'string', 'meeting-recordings declares no top-level `notes`');
	assert.equal(RECORDINGS.transcription?.type, 'map');
	assert.match(RECORDINGS.transcription.description, /`notes`/, 'the recordings descriptor says the block carries the transcriber\'s notes');
	for (const f of [SUMMARIZE, read('meeting-docs/commands/analyze-meetings.command.md'), read('meeting-docs/skills/analyzing-meetings/SKILL.md')]) {
		assert.match(f, /`transcription\.speakers`/);
		assert.match(f, /`transcription\.notes`/, 'the transcriber\'s own caveats are read');
		assert.match(f, /top-level/, 'and the recording\'s own `notes` beside them');
	}
});

test('who was in the room is the meeting\'s `attendees_contacts`; no shipped text puts contact refs in `attendees`', () => {
	const meetings = fields('meetings/collections/meetings.collection.yaml');
	assert.equal(meetings.attendees_contacts?.type, 'contacts', 'the meetings module this one depends on declares attendees_contacts');
	assert.equal(meetings.attendees?.type, 'object');
	const PREPS = fields('meeting-docs/collections/meeting-preps.collection.yaml');
	assert.match(PREPS.attendees.description, /attendees_contacts/);
	assert.match(read('meeting-docs/commands/create-meeting.command.md'), /`attendees_contacts`/);
	assert.match(read('meeting-docs/commands/process-new-meetings.command.md'), /`attendees_contacts`/);
	assert.match(read('meeting-docs/skills/preparing-for-meetings/SKILL.md'), /`attendees_contacts`/);
	const stale = shipped.filter((f) => /attendees as `contacts\/` refs|meeting's `attendees`[^_]/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(MODULES, f));
	assert.deepEqual(stale, []);
});

test('the id rule: pass --id with the meeting\'s id, and say why', () => {
	assert.match(SUMMARIZE, /Pass `--id <the meeting's id>`/);
	assert.match(SUMMARIZE, /filed beside the meeting it summarises, under the month the call was\s+held, not on the day it was written/);
	assert.match(read('meeting-docs/collections/meeting-summaries.collection.yaml'), /passes `--id <the meeting's id>`/);
});

test('the summary is written in the language the meeting was held in', () => {
	assert.match(SUMMARIZE, /write the summary in the language the meeting was held in/);
});

test('author is the harness name, which the descriptor pattern accepts', () => {
	const pattern = new RegExp(SUMMARIES.author.pattern);
	assert.match(SUMMARIZE, /\| `author` \| `agents\/<harness>`, the name of the harness running this command: `agents\/claude-code` under Claude Code/);
	assert.ok(pattern.test('agents/claude-code'));
	assert.match(SUMMARIES.author.description, /`agents\/<harness>`/);
});

test('source takes every recording, and the descriptor allows a list', () => {
	assert.equal(SUMMARIES.source.many, true);
	assert.match(SUMMARIZE, /every recording whose transcript you read, one `meeting-recordings\/<id>` element each/);
	assert.doesNotMatch(SUMMARIZE, /\+ <n> screenshots/);
});

test('every post-transcript command and the pipeline stop on a restricted meeting', () => {
	for (const f of ['commands/extract-tasks-from-meetings.command.md', 'commands/analyze-meetings.command.md', 'commands/process-new-meetings.command.md', 'skills/analyzing-meetings/SKILL.md']) {
		assert.match(read(`meeting-docs/${f}`), /`privacy: restricted`/, f);
	}
});

test('a critique is `about` an engagement, never a company', () => {
	const analyses = fields('meeting-docs/collections/meeting-analyses.collection.yaml');
	assert.equal(analyses.about.type, 'engagements');
	assert.doesNotMatch(read('meeting-docs/commands/analyze-meetings.command.md'), /`about` to the company/);
});

test('preps and the pipeline name the engagements module this one depends on, not an unnamed standing record', () => {
	const deps = JSON.parse(read('meeting-docs/package.json')).dreamteamer.dependencies;
	assert.ok(deps.includes('@dreamteamer/engagements'));
	for (const f of ['commands/prepare-for-meeting.command.md', 'skills/preparing-for-meetings/SKILL.md', 'commands/process-new-meetings.command.md']) {
		assert.doesNotMatch(read(`meeting-docs/${f}`), /this module does not ship one/, f);
	}
	assert.match(read('meeting-docs/commands/process-new-meetings.command.md'), /`\/update-engagements`/);
});
