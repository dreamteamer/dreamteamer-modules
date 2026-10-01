#!/usr/bin/env node
// digest — a bounded, context-safe rendering of a conversation, addressed by conversations id, for a
// model to JUDGE.
//
// This is the one script here whose output is MEANT to be read into a context window, so it has a
// hard character budget and spends it deliberately:
//   · every user turn, in full order, clipped per-turn — the person's words are the signal
//   · assistant turns as openers only — enough to see what it did and where it wobbled
//   · the mechanical metrics up front, so the model does not re-derive what was already counted
//   · a sample of tool errors, because that is where the friction actually shows
// When it has to drop material it SAYS SO in the output, so the reader can discount for it.
//
//   node bin/digest.mjs <transcript.jsonl|conversation-id> [--budget 12000] [--data-root <dir>] [--json-metrics]
import fs from 'node:fs';
import path from 'node:path';
import { eachLine, textOf, toolUsesOf, toolResultsOf, classifyUserLine, assistantMessageId } from '../lib/transcript.mjs';
import { DATA, render } from '../lib/workspace.mjs';
import { readRecord, recordPath } from '../lib/records.mjs';
import { computeMetrics } from '../lib/metrics.mjs';

const argv = process.argv.slice(2);
const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
// A flag's VALUE is not the target: `--budget 3000 file.jsonl` must not digest "3000".
const FLAG_VALUES = new Set(['budget', 'data-root'].map((n) => opt(n)).filter(Boolean));
const target = argv.find((a) => !a.startsWith('--') && !FLAG_VALUES.has(a));
if (!target) { console.error('usage: digest.mjs <transcript|session-id> [--budget 12000]'); process.exit(2); }

const BUDGET = +opt('budget', '12000');
const hit = target.endsWith('.jsonl') && fs.existsSync(target)
	? { path: path.resolve(target), account: '', session_id: path.basename(target, '.jsonl') }
	: (() => { const f = recordPath('conversations', target, 'conversation', opt('data-root', DATA)); if (!fs.existsSync(f)) return null; const { fields } = readRecord(f); return { path: render(fields.transcript_path), account: fields.account ?? '', session_id: fields.session_id }; })();
if (!hit) { console.error(`no transcript matches "${target}"`); process.exit(2); }

const m = await computeMetrics(hit.path, hit);
if (argv.includes('--json-metrics')) { process.stdout.write(JSON.stringify(m) + '\n'); process.exit(0); }

// ---- second pass: collect turns -------------------------------------------------------------
const userTurns = [];
const agentTurns = [];
const errors = [];
let pendingId = null;
let pending = null;
const flush = () => { if (pending && (pending.text.trim() || pending.tools.length)) agentTurns.push(pending); pending = null; };

await eachLine(hit.path, (r) => {
	if (r.isSidechain || !r.message) return;
	if (r.type === 'assistant') {
		const id = assistantMessageId(r);
		if (id !== pendingId) { flush(); pendingId = id; pending = { i: userTurns.length, text: '', tools: [] }; }
		pending.text += textOf(r.message.content);
		for (const t of toolUsesOf(r.message.content)) pending.tools.push(t.name);
		return;
	}
	if (r.type !== 'user') return;
	const cls = classifyUserLine(r);
	if (cls.kind === 'tool_result') {
		for (const tr of toolResultsOf(r.message.content)) {
			if (!tr.is_error || errors.length >= 8) continue;
			const body = typeof tr.content === 'string' ? tr.content : textOf(tr.content);
			errors.push(body.replace(/\s+/g, ' ').slice(0, 220));
		}
		return;
	}
	if (cls.kind === 'envelope') return;
	flush();
	userTurns.push({ kind: cls.kind, text: cls.kind === 'slash_command' ? `/${cls.command} ${cls.text}` : cls.text });
});
flush();

// ---- spend the budget -------------------------------------------------------------------------
// User turns get 70% and are never sampled away — losing one loses an intent. Assistant turns
// get the rest and ARE sampled, evenly, because their job here is only to show the shape of the work.
const userBudget = Math.floor(BUDGET * 0.7);
const perUser = Math.max(200, Math.floor(userBudget / Math.max(1, userTurns.length)));
const clip = (t, n) => (t.length > n ? t.slice(0, n) + ` …[+${t.length - n} chars]` : t);

const agentBudget = BUDGET - userBudget;
const perAgent = 220;
const keepAgent = Math.max(1, Math.floor(agentBudget / perAgent));
const step = Math.max(1, Math.ceil(agentTurns.length / keepAgent));
const sampledAgent = agentTurns.filter((_, i) => i % step === 0);

const L = [];
L.push(`# digest · ${m.title}`);
L.push('');
L.push(`\`${m.session_id}\` · account **${m.account}** · repo **${m.repo_name || '?'}**`);
L.push(`${m.started_at.slice(0, 16).replace('T', ' ')} → ${m.ended_at.slice(11, 16)} · ${m.active_minutes}min active`);
L.push('');
L.push('## counted (do not re-derive; these are exact)');
L.push('```json');
L.push(JSON.stringify({
	turns_user: m.turns_user, turns_assistant: m.turns_assistant,
	tool_calls: m.tool_calls, tool_errors: m.tool_errors,
	files_edited: m.files_edited, permission_denials: m.permission_denials,
	skills_loaded: m.skills_loaded, commands_invoked: m.commands_invoked,
	repo_name: m.repo_name,
	heuristic_user_acts: Object.fromEntries(Object.entries(m).filter(([k, v]) => k.startsWith('user_') && v)),
	heuristic_agent_acts: Object.fromEntries(Object.entries(m).filter(([k, v]) => k.startsWith('agent_') && v)),
}, null, 1));
L.push('```');
L.push('');
L.push(`## operator turns (${userTurns.length}, all shown, each clipped to ~${perUser} chars)`);
userTurns.forEach((t, i) => { L.push(''); L.push(`**[u${i + 1} · ${t.kind}]** ${clip(t.text.replace(/\n{3,}/g, '\n\n'), perUser)}`); });
L.push('');
L.push(`## agent turns (${agentTurns.length} total, ${sampledAgent.length} sampled every ${step})`);
sampledAgent.forEach((t) => {
	const head = t.text.replace(/\s+/g, ' ').trim().slice(0, perAgent);
	L.push(`- after u${t.i} — ${head || '(no text)'}${t.tools.length ? `  ·tools: ${[...new Set(t.tools)].join(',')}` : ''}`);
});
if (errors.length) { L.push(''); L.push(`## tool errors (first ${errors.length} of ${m.tool_errors})`); errors.forEach((e) => L.push(`- ${e}`)); }
if (step > 1) { L.push(''); L.push(`> ⚠ ${agentTurns.length - sampledAgent.length} agent turns were sampled out to fit the budget. Operator turns are complete.`); }

process.stdout.write(L.join('\n') + '\n');
