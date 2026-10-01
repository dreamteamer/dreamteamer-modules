// A codex rollout is one object per EVENT, not one per message, and a SESSION is not one FILE:
// continuing a thread writes a new rollout carrying the same session_id. What this pins is the
// grouping (53 rollouts were 32 sessions on the real corpus, and one-record-per-file silently
// dropped every continuation), the token arithmetic across sittings, and the two roles that are not
// the operator.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRecord, recordPath, writeRecord, listRecords } from '../lib/records.mjs';

const BIN = fileURLToPath(new URL('../bin/read-codex-transcripts.mjs', import.meta.url));
const BASE = '2026-09-08--fx', SESSION = `perspective/retrospective-sessions/${BASE}`;
const SLUG = 'fx';   // the contributor — evidence and model ids are keyed by it, not by the run
const SID = '01a04811-0000-7000-8000-000000000001';

const line = (ts, type, payload) => JSON.stringify({ timestamp: ts, ordinal: '0', type, payload }) + '\n';
const meta = (ts, extra = {}) => line(ts, 'session_meta', { session_id: SID, id: SID, timestamp: ts, cwd: '/tmp/fx-repo', originator: 'test', ...extra });
const msg = (ts, role, text) => line(ts, 'response_item', { type: 'message', role, content: [{ type: 'input_text', text }] });
const seg = (ts, role, text) => line(ts, 'realtime_item', { type: 'transcript_segment', role, text });
const call = (ts, name, input) => line(ts, 'response_item', { type: 'custom_tool_call', name, input });
const out = (ts, text) => line(ts, 'response_item', { type: 'custom_tool_call_output', output: [{ type: 'input_text', text }] });
const tokens = (ts, o) => line(ts, 'event_msg', { type: 'token_count', info: { total_token_usage: o } });

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-'));
	const data = path.join(root, 'data');
	const dir = path.join(root, '.codex', 'sessions', '2026', '08', '28');
	fs.mkdirSync(dir, { recursive: true });
	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data), { contributor: SLUG, handles: ['me@acme.example'], started: '2026-09-08', activity_weeks_back: 300 });

	// Sitting one.
	fs.writeFileSync(path.join(dir, 'rollout-2026-08-28T10-00-00-a.jsonl'),
		meta('2026-08-28T10:00:00.000Z')
		+ msg('2026-08-28T10:00:05.000Z', 'developer', 'harness context nobody typed')
		+ msg('2026-08-28T10:00:06.000Z', 'user', '<recommended_plugins>\nthe app talking, wearing the user role\n</recommended_plugins>')
		+ msg('2026-08-28T10:00:10.000Z', 'user', 'Port the reader to the new format')
		+ call('2026-08-28T10:00:20.000Z', 'exec', 'read /Users/me/work/a.ts and /Users/me/work/b.ts')
		+ out('2026-08-28T10:00:25.000Z', 'ok')
		+ msg('2026-08-28T10:00:40.000Z', 'assistant', 'done, four words back')
		+ tokens('2026-08-28T10:00:41.000Z', { input_tokens: 100, cached_input_tokens: 40, cache_write_input_tokens: 5, output_tokens: 10 }));
	// Sitting two, HOURS later, same session_id — a continuation, not a new session.
	fs.writeFileSync(path.join(dir, 'rollout-2026-08-28T18-00-00-b.jsonl'),
		meta('2026-08-28T18:00:00.000Z', { parent_thread_id: SID })
		+ msg('2026-08-28T18:00:10.000Z', 'user', 'now the tests')
		+ call('2026-08-28T18:00:20.000Z', 'exec', 'touch /Users/me/work/a.ts')
		+ out('2026-08-28T18:00:25.000Z', 'Script failed\nScript error: nope')
		+ msg('2026-08-28T18:00:30.000Z', 'assistant', 'two words')
		+ tokens('2026-08-28T18:00:31.000Z', { input_tokens: 200, cached_input_tokens: 60, cache_write_input_tokens: 0, output_tokens: 20 }));
	return { root, data };
}
const run = (root, data, extra = []) =>
	execFileSync('node', [BIN, '--retrospective', SESSION, '--home', root, '--data-root', data, ...extra], { encoding: 'utf8' });
const only = (data) => {
	const files = listRecords(path.join(data, 'perspective', 'conversations'));
	assert.equal(files.length, 1, 'two rollouts of one thread are ONE conversation');
	return readRecord(files[0]).fields;
};

test('two rollouts of one thread are one conversation, and the receipt says both numbers', () => {
	const { root, data } = fixture();
	const receipt = run(root, data);
	assert.match(receipt, /codex rollouts 2 in 1 session\(s\)/);
	const c = only(data);
	assert.equal(c.session_id, SID);
	assert.equal(c.harness, 'codex');
	assert.equal(c.sittings, 2, 'the record says how many files a reader would have to open');
	assert.equal(c.started_at, '2026-08-28T10:00:00.000Z');
	assert.equal(c.ended_at, '2026-08-28T18:00:31.000Z');
});

test('turns, tools and words come from BOTH sittings; `developer` is not an operator turn', () => {
	const { root, data } = fixture();
	run(root, data);
	const c = only(data);
	assert.equal(c.turns_user, 2, 'the developer context injection is the harness, not a person');
	assert.equal(c.harness_envelopes, 1, 'and a <recommended_plugins> block wearing the user role is counted as what it is');
	assert.equal(c.turns_assistant, 2);
	assert.equal(c.tool_calls, 2);
	assert.equal(c.tool_errors, 1);
	assert.equal(c.files_edited, 2, 'distinct absolute paths across both sittings, counted once each');
	assert.equal(c.input_words, 10, 'seven words then three');
	assert.equal(c.output_words, 6);
	assert.equal(c.title, 'Port the reader to the new format');
});

test('the token bill is SUMMED across sittings, and the cached half is not double-counted', () => {
	const { root, data } = fixture();
	run(root, data);
	const c = only(data);
	// total_token_usage restarts per rollout, so the session is 100+200 in, 40+60 cached, 10+20 out.
	assert.equal(c.tokens_cache_read, 100);
	assert.equal(c.tokens_input, 200, 'input minus cached, so one meaning across both harnesses');
	assert.equal(c.tokens_output, 30);
	assert.equal(c.tokens_cache_write, 5);
	assert.equal(c.tokens_total, 335);
});

test('the idle clock restarts between sittings — the eight hours between them are not work', () => {
	const { root, data } = fixture();
	run(root, data);
	// 35s inside the first file, 31s inside the second. The 8h gap is a break, not active time.
	assert.ok(only(data).active_minutes < 2, `expected a couple of minutes, got ${only(data).active_minutes}`);
});

test('a week record is written once per session, not once per file', () => {
	const { root, data } = fixture();
	run(root, data);
	const weeks = listRecords(path.join(data, 'perspective', 'activity-weeks')).map((f) => readRecord(f).fields);
	assert.equal(weeks.length, 1);
	assert.equal(weeks[0].sessions, 1, 'two rollouts of one thread are one session in the week');
	assert.equal(weeks[0].tool_calls, 2);
	assert.equal(weeks[0].start_date, '2026-08-24');
});

test('a rollout with no session_meta is reported, never given an invented id', () => {
	const { root, data } = fixture();
	fs.writeFileSync(path.join(root, '.codex', 'sessions', '2026', '08', '28', 'rollout-junk.jsonl'), line('2026-08-28T11:00:00.000Z', 'world_state', {}));
	assert.match(run(root, data, ['--force']), /1 file\(s\) held no session_meta/);
	only(data);
});

test('the operator SPOKE: a run of user transcript segments is one turn, and it titles the session', () => {
	// A realtime voice session has no typed user message at all. 348 segments against one plain-text
	// typed opener across the real corpus — reading only typed messages reported those sessions as
	// having no operator in them.
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-voice-'));
	const data = path.join(root, 'data');
	const dir = path.join(root, '.codex', 'sessions', '2026', '09', '01');
	fs.mkdirSync(dir, { recursive: true });
	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data), { contributor: SLUG, handles: ['me@acme.example'], started: '2026-09-08', activity_weeks_back: 300 });
	fs.writeFileSync(path.join(dir, 'rollout-voice.jsonl'),
		meta('2026-09-01T09:00:00.000Z')
		+ msg('2026-09-01T09:00:01.000Z', 'user', '<realtime_delegation>the app, not a person</realtime_delegation>')
		+ seg('2026-09-01T09:00:05.000Z', 'user', 'right, so')
		+ seg('2026-09-01T09:00:06.000Z', 'user', 'walk the ledger with me')
		+ seg('2026-09-01T09:00:09.000Z', 'assistant', 'opening it now')
		+ seg('2026-09-01T09:00:20.000Z', 'user', 'and the second account too')
		+ msg('2026-09-01T09:00:30.000Z', 'assistant', 'done'));
	execFileSync('node', [BIN, '--retrospective', SESSION, '--home', root, '--data-root', data], { encoding: 'utf8' });
	const c = only(data);
	assert.equal(c.turns_user, 2, 'two RUNS of segments, not the four fragments they arrived in');
	assert.equal(c.spoken_turns, 2, 'and both of them were spoken');
	assert.equal(c.turns_assistant, 2, 'one spoken run plus one typed message');
	assert.equal(c.harness_envelopes, 1);
	assert.equal(c.title, 'right, so', 'the title is what the operator said, never the envelope the app injected');
	assert.equal(c.input_words, 12, 'every spoken fragment counts its words, even though the run is one turn');
});
