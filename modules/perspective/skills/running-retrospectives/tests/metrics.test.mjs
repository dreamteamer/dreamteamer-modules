// The parser's promise: turns_user counts the OPERATOR, not the lines. Fixture built here, not read
// from disk, so the trap each line represents is visible beside the assertion it protects.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeMetrics, INSPECTOR_VERSION } from '../lib/metrics.mjs';

const ts = (i) => new Date(Date.UTC(2026, 8, 1, 10, i)).toISOString();
const base = (i, extra) => ({ cwd: '/work/acme-portal', sessionId: 'fx-1', uuid: `u${i}`, timestamp: ts(i), isSidechain: false, version: '2.0', ...extra });
const user = (i, content, extra = {}) => base(i, { type: 'user', message: { role: 'user', content }, ...extra });
const asst = (i, id, content, usage) => base(i, { type: 'assistant', message: { id, role: 'assistant', model: 'claude-sonnet-5', content, usage } });

function fixture(lines) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-fx-'));
	const file = path.join(dir, 'fx-1.jsonl');
	fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
	return file;
}

test('turns_user counts operator turns only; assistant turns fold on message.id', async () => {
	const file = fixture([
		user(1, 'please add a test for the parser'),                                                   // turn · directive
		asst(2, 'm1', [{ type: 'text', text: "I'll add it." }], { input_tokens: 100, output_tokens: 20 }),
		asst(2, 'm1', [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/work/acme-portal/x.test.mjs' } }], { input_tokens: 100, output_tokens: 20 }), // same id → same turn; usage counted once
		user(3, [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),                          // tool result — not a turn
		user(4, '<system-reminder>ambient</system-reminder>'),                                          // envelope
		user(5, '<task-notification>agent done</task-notification>'),                                    // envelope (the 3.3× impostor)
		user(6, "that's wrong, you missed the fixture"),                                                 // turn · correction
		asst(7, 'm2', [{ type: 'text', text: "You're right — fixing." }], { input_tokens: 50, output_tokens: 10 }),
		user(8, 'This session is being continued from a previous conversation that ran out of context. Summary: please add a test…'), // compaction replay — envelope
	]);
	const m = await computeMetrics(file, { session_id: 'fx-1', account: 'default' });
	assert.equal(m.turns_user, 2);
	assert.equal(m.turns_assistant, 2);
	assert.equal(m.user_directive, 1);
	assert.equal(m.user_correction, 1);
	assert.equal(m.tool_calls, 1);
	assert.equal(m.files_edited, 1);
	assert.equal(m.tokens_input, 150, 'usage summed once per message.id');
	assert.equal(m.tokens_output, 30);
	assert.equal(m.inspector_version, INSPECTOR_VERSION);
	assert.equal(m.started_at, ts(1));
	assert.equal(m.ended_at, ts(8));
	assert.equal(m.candidate, true);
	assert.equal(m._repo_cwd, '/work/acme-portal');
	for (const k of ['cwds', 'top_tools', 'tool_entropy', 'apologies', 'prior_score', 'user_chars']) assert.equal(k in m, false, `${k} was dropped from the port`);
});

test('the volume gate: one prompt and no work is minimal, with every mechanical field present', async () => {
	const file = fixture([user(1, 'hi'), asst(2, 'm1', [{ type: 'text', text: 'Hello.' }], { input_tokens: 5, output_tokens: 2 })]);
	const m = await computeMetrics(file, { session_id: 'fx-2', account: 'default' });
	assert.equal(m.candidate, false);
	assert.match(m.gate_reason, /false start|trivial/);
	for (const k of ['turns_user', 'turns_assistant', 'tool_calls', 'tool_errors', 'files_edited', 'tokens_input', 'permission_denials', 'user_directive', 'agent_plan']) assert.equal(typeof m[k], 'number', k);
});

// Regression, found on the first dogfood pass over 1,066 real conversations: four .jsonl files carry
// no timestamp on ANY line — they are pure `/compact` checkpoint files (754 lines, every one
// `type: summary`, no user or assistant turn at all). started_at is required and keys both the id and
// every activity window, so a record for one was landing in 1970/01 and `dt check` refused it.
test('a transcript with no timestamp anywhere is dated from the file mtime, and says so', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-fx-'));
	const file = path.join(dir, 'fx-3.jsonl');
	fs.writeFileSync(file, [
		{ type: 'summary', summary: 'a compact checkpoint', leafUuid: 'x' },
		{ type: 'summary', summary: 'another one', leafUuid: 'y' },
	].map((l) => JSON.stringify(l)).join('\n') + '\n');
	const mtime = new Date('2026-08-14T08:30:00.000Z');
	fs.utimesSync(file, mtime, mtime);
	const m = await computeMetrics(file, { session_id: 'fx-3', account: 'default' });
	assert.equal(m.dated_from_mtime, true);
	assert.equal(m.started_at, mtime.toISOString());
	assert.equal(m.ended_at, mtime.toISOString());
	assert.equal(m.turns_user, 0);
	assert.equal(m.candidate, false, 'no operator turns is a gate failure, not a date failure');
	assert.equal(m.started_at.startsWith('1970'), false);
});

test('a transcript that HAS timestamps never claims the mtime fallback', async () => {
	const file = fixture([user(1, 'a real turn with a real timestamp'), asst(2, 'm1', [{ type: 'text', text: 'ok' }], { input_tokens: 1, output_tokens: 1 })]);
	const m = await computeMetrics(file, { session_id: 'fx-4', account: 'default' });
	assert.equal(m.dated_from_mtime, undefined);
	assert.equal(m.started_at, ts(1));
});

// ── metrics/2 — the session-cost layer ────────────────────────────────────────────────────────
// Every assertion here fails against metrics/1, where the field simply did not exist.

test('metrics/2 counts the words on both sides, and the correction ratio is corrected-over-produced', async () => {
	const file = fixture([
		user(1, 'add a parser for the statement format'),                        // 7 words · directive
		asst(2, 'm1', [{ type: 'text', text: 'one two three four five' }], { input_tokens: 10, output_tokens: 5 }),
		user(3, "that's wrong, you missed the header row"),                      // 7 words · correction
		asst(4, 'm2', [{ type: 'text', text: 'six seven eight nine ten' }], { input_tokens: 10, output_tokens: 5 }),
	]);
	const m = await computeMetrics(file, { session_id: 'fx-w', account: 'default' });
	assert.equal(m.input_words, 14, 'both operator turns counted, envelope stripped');
	assert.equal(m.output_words, 10, 'assistant text only — tool inputs are not deliverable words');
	assert.equal(m.correction_ratio, 0.7, '7 corrected words over 10 produced');
});

test('a session that produced no words has NO correction_ratio rather than a flattering zero', async () => {
	const file = fixture([
		user(1, "that's wrong, revert it"),
		asst(2, 'm1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git revert HEAD' } }], { input_tokens: 5, output_tokens: 1 }),
	]);
	const m = await computeMetrics(file, { session_id: 'fx-z', account: 'default' });
	assert.equal(m.output_words, 0);
	assert.equal(m.correction_ratio, undefined, 'absent, not 0 — 0 would read as a clean session');
});

test('the tool mix, the MCP servers behind it, and skills USED as a subset of skills loaded', async () => {
	const file = fixture([
		user(1, 'find the invoice thread and file it'),
		asst(2, 'm1', [
			{ type: 'tool_use', id: 't1', name: 'Grep', input: { pattern: 'invoice' } },
			{ type: 'tool_use', id: 't2', name: 'mcp__google-workspace__search_gmail_messages', input: {} },
			{ type: 'tool_use', id: 't3', name: 'mcp__google-workspace__get_gmail_message_content', input: {} },
			{ type: 'tool_use', id: 't4', name: 'mcp__etherscan__get_transactions', input: {} },
			{ type: 'tool_use', id: 't5', name: 'Skill', input: { skill: 'processing-finance-invoices' } },
			{ type: 'tool_use', id: 't6', name: 'SlashCommand', input: { command: '/close-financial-month' } },
		], { input_tokens: 10, output_tokens: 5 }),
	]);
	const m = await computeMetrics(file, { session_id: 'fx-t', account: 'default' });
	assert.deepEqual(m.mcp_servers, ['etherscan', 'google-workspace'], 'one entry per server, not per tool');
	assert.deepEqual(m.skills_used, ['processing-finance-invoices'], 'a typed slash command is not proof a skill ran');
	assert.deepEqual(m.skills_loaded, ['close-financial-month', 'processing-finance-invoices'], 'loaded is the wider set');
	assert.ok(m.tools_used.includes('Grep') && m.tools_used.includes('Skill'), 'the tool mix is named, not just counted');
	assert.equal(m.tools_used.length, 6);
});

// The first dogfood pass measured 552 interruptions across a third of sessions — 2.2× the permission
// denials — while the field to hold them did not exist. This is that field.
test('interruptions are counted, still count as a turn, and are not classified as a dialogue act', async () => {
	const file = fixture([
		user(1, 'refactor the reader'),
		asst(2, 'm1', [{ type: 'text', text: 'starting now' }], { input_tokens: 5, output_tokens: 2 }),
		user(3, '[Request interrupted by user for tool use]'),
		user(4, '[Request interrupted by user]'),
		asst(5, 'm2', [{ type: 'text', text: 'stopped' }], { input_tokens: 5, output_tokens: 1 }),
	]);
	const m = await computeMetrics(file, { session_id: 'fx-i', account: 'default' });
	assert.equal(m.interruptions, 2);
	assert.equal(m.turns_user, 3, 'the operator did speak — an interruption is the cheapest thing they can say');
	assert.equal(m.user_directive, 1, 'and it is not a directive');
	assert.equal(m.input_words, 3, 'interrupt boilerplate is the harness talking, not words he typed');
});

// metrics/3 — the input bill. `input_tokens` is only the uncached remainder, and quoting it as the
// cost of a session under-reports by two orders of magnitude on real agentic work.
test('cache tokens are captured, and tokens_total is the number to quote', async () => {
	const file = fixture([
		user(1, 'keep going'),
		asst(2, 'm1', [{ type: 'text', text: 'ok' }], { input_tokens: 12, output_tokens: 300, cache_read_input_tokens: 40000, cache_creation_input_tokens: 1500 }),
		asst(2, 'm1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }], { input_tokens: 12, output_tokens: 300, cache_read_input_tokens: 40000, cache_creation_input_tokens: 1500 }),
		user(3, [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
		asst(4, 'm2', [{ type: 'text', text: 'done' }], { input_tokens: 8, output_tokens: 100, cache_read_input_tokens: 41000, cache_creation_input_tokens: 0 }),
	]);
	const m = await computeMetrics(file, { session_id: 'fx-c', account: 'default' });
	assert.equal(m.tokens_input, 20, 'still counted once per message.id');
	assert.equal(m.tokens_cache_read, 81000);
	assert.equal(m.tokens_cache_write, 1500);
	assert.equal(m.tokens_total, 82920, 'all four components — 4000× the uncached input alone');
});
