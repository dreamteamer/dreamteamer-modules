// The reader against a synthetic ~ tree: one account, one conversation with a sidecar, one orphan.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRecord, listRecords, recordPath, writeRecord } from '../../skills/running-retrospectives/lib/records.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', '..', 'skills', 'running-retrospectives', 'bin', 'read-claude-transcripts.mjs');
const SESSION = 'perspective/retrospective-sessions/2026-09-07--fx';
const SLUG = 'fx';   // the contributor — every source and conversation id is keyed by it, not by the run
const line = (o) => JSON.stringify(o) + '\n';
const ts = (i) => new Date(Date.UTC(2026, 8, 2, 9, i)).toISOString();

/** Every reader resolves its key off the run record, so a data root without one cannot be read. */
function seedSession(data) {
	const id = SESSION.split('/').pop();
	writeRecord(recordPath('retrospective-sessions', id, 'retrospective-session', data),
		{ contributor: SLUG, handles: ['dana.o@northwind.example'], started: id.slice(0, 10), stage: 'installed' });
	return data;
}

function home() {
	const h = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-home-'));
	const p = path.join(h, '.claude', 'projects', '-work-acme');
	fs.mkdirSync(path.join(p, '11111111-1111-4111-8111-111111111111', 'subagents'), { recursive: true });
	fs.writeFileSync(path.join(p, '11111111-1111-4111-8111-111111111111.jsonl'),
		line({ type: 'user', uuid: 'a', timestamp: ts(1), cwd: '/work/acme', message: { role: 'user', content: 'add the parser test' } }) +
		line({ type: 'assistant', uuid: 'b', timestamp: ts(2), cwd: '/work/acme', message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'npm test' } }], usage: { input_tokens: 10, output_tokens: 5 } } }) +
		line({ type: 'user', uuid: 'c', timestamp: ts(3), cwd: '/work/acme', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] } }) +
		line({ type: 'user', uuid: 'd', timestamp: ts(4), cwd: '/work/acme', message: { role: 'user', content: 'now the fixture please' } }));
	fs.writeFileSync(path.join(p, '11111111-1111-4111-8111-111111111111', 'subagents', 'agent-x.jsonl'), line({ type: 'assistant', message: { id: 's1', content: [] } }));
	fs.writeFileSync(path.join(p, 'agent-orphan.jsonl'), line({ type: 'assistant', message: { id: 's2', content: [] } }));
	return h;
}

test('writes one summary per conversation, one source per tree, one window per week; receipt reconciles files', () => {
	const h = home();
	const data = seedSession(fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-data-')));
	const out = execFileSync('node', [BIN, '--retrospective', SESSION, '--home', h, '--data-root', data], { encoding: 'utf8' });
	assert.match(out, /files 3 · conversations 1 · sidecars 2 · written 1/);
	const summaries = listRecords(path.join(data, 'perspective', 'conversations'));
	assert.equal(summaries.length, 1);
	const { fields } = readRecord(summaries[0]);
	assert.equal(fields.turns_user, 2);
	assert.equal(fields.harness, 'claude-code');
	assert.equal(fields.account, 'default');
	assert.equal(fields.depth, 'minimal', 'depth is minimal until record-judgement flips it, whatever the gate said');
	assert.ok(fields.transcript_path.startsWith('${userHome}/') || fields.transcript_path.startsWith(h), 'a template when under $HOME');
	assert.equal(fields.source, `perspective/sources/${SLUG}/claude-transcripts--default`);
	const sources = listRecords(path.join(data, 'perspective', 'sources'));
	assert.equal(sources.length, 1);
	assert.equal(readRecord(sources[0]).fields.reach, 'available');
	const windows = listRecords(path.join(data, 'perspective', 'activity-weeks'));
	assert.equal(windows.length, 1);
	assert.equal(readRecord(windows[0]).fields.period, '2026-W36');
	assert.equal(readRecord(windows[0]).fields.turns_user, 2);
	// second run: nothing rewritten at the same inspector version
	const again = execFileSync('node', [BIN, '--retrospective', SESSION, '--home', h, '--data-root', data], { encoding: 'utf8' });
	assert.match(again, /written 0 · skipped 1/);
});

// metrics/2 — the weekly record stopped being two numbers. Everything asserted here was absent
// before, which is exactly why a timeline of it could not be read.
test('the weekly window carries the session-cost metrics, not just sessions and turns', () => {
	const h = home();
	const data = seedSession(fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-data-')));
	execFileSync('node', [BIN, '--retrospective', SESSION, '--home', h, '--data-root', data], { encoding: 'utf8' });
	const { fields } = readRecord(listRecords(path.join(data, 'perspective', 'activity-weeks'))[0]);
	assert.equal(fields.sessions, 1);
	assert.equal(fields.tokens_input, 10, 'summed from the conversations that STARTED in the week');
	assert.equal(fields.tokens_output, 5);
	assert.equal(fields.tool_calls, 1);
	assert.equal(fields.input_words, 8, 'the two operator turns');
	assert.equal(fields.interruptions, 0);
	assert.equal(typeof fields.active_minutes, 'number');
});

// A re-read recounts every mechanical number. `summary` is the one field on this collection a model
// wrote, and a reader that quietly deleted it would cost a whole backfill pass.
test('a re-read at a new version keeps the week\'s judged summary', () => {
	const h = home();
	const data = seedSession(fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-data-')));
	const run = () => execFileSync('node', [BIN, '--retrospective', SESSION, '--home', h, '--data-root', data, '--force'], { encoding: 'utf8' });
	run();
	const file = listRecords(path.join(data, 'perspective', 'activity-weeks'))[0];
	const before = readRecord(file);
	fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('period:', 'summary: shipped the parser and its fixture\nperiod:'));
	run();
	const after = readRecord(file);
	assert.equal(after.fields.summary, 'shipped the parser and its fixture');
	assert.equal(after.fields.sessions, before.fields.sessions, 'and still recounts everything else');
});
