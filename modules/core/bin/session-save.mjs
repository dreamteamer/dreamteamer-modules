#!/usr/bin/env node
// The session reader: one coding-agent session's transcript, read once, as the fields of a `sessions`
// record — turns, tool calls, tokens, cache, cost, durations, models, lines changed, and where the
// transcript is. The harness already keeps the figures; this script only reads them.
//
//   node node_modules/@dreamteamer/core/bin/session-save.mjs --json            print the fields
//   node node_modules/@dreamteamer/core/bin/session-save.mjs --write           upsert sessions/<session id>
//   … [--session <id>] [--transcript <path>] [--hook] [--quiet] [--set <field>=<value> …]
//
// The session is `$CLAUDE_CODE_SESSION_ID` (set in every Bash and hook subprocess) unless `--session`
// names one; `--hook` reads a hook's stdin JSON (`session_id`, `transcript_path`) instead. The transcript
// is `<config dir>/projects/<encoded cwd>/<session id>.jsonl`, where the config dir is `$CLAUDE_CONFIG_DIR`
// or `~/.claude` and the encoded cwd replaces every character but letters and digits with `-`.
//
// Metrics come from the transcript's `cost-state` line — the figures `/usage` shows, at list price —
// and, when that line is absent (an older harness, a transcript cut short), from the per-request
// `usage` blocks summed once per `requestId` and priced from the table below. Exit 0 on a read; 1 when
// the session or its transcript cannot be found, or a write is refused.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** List price per token, by model id prefix: input · output · cache write (5 min · 1 h) · cache read.
 *  Used only when the transcript carries no `cost-state`; a model not listed leaves `cost_usd` empty. */
export const PRICES = {
	'claude-opus-5': { input: 4e-6, output: 2e-5, write5m: 5e-6, write1h: 8e-6, read: 2e-7 },
	'claude-fable-5': { input: 1e-5, output: 5e-5, write5m: 1.25e-5, write1h: 2e-5, read: 2.5e-7 },
	'claude-sonnet-5': { input: 2e-6, output: 1e-5, write5m: 2.5e-6, write1h: 4e-6, read: 1e-7 },
	'claude-haiku-5': { input: 1e-6, output: 5e-6, write5m: 1.25e-6, write1h: 2e-6, read: 1e-7 },
};
const priceOf = (model) => PRICES[Object.keys(PRICES).find((k) => String(model).startsWith(k))];

/** The encoded project folder the harness keeps a cwd's transcripts under. */
export const encodeCwd = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');
export const configDir = (env = process.env) => env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
export const transcriptPathOf = (sessionId, cwd = process.cwd(), env = process.env) => path.join(configDir(env), 'projects', encodeCwd(cwd), `${sessionId}.jsonl`);

/** Parse a transcript's text. Pure: counts, the cost-state line, and one usage per distinct request. */
export function parseTranscript(text) {
	const p = { turns: 0, toolCalls: 0, compactions: 0, first: null, last: null, costState: null, title: null, lastPrompt: null, sessionId: null, cwd: null, requests: new Map(), models: new Set() };
	const tools = new Set();
	for (const raw of text.split('\n')) {
		if (!raw.trim()) continue;
		let line; try { line = JSON.parse(raw); } catch { continue; }
		p.sessionId ??= line.sessionId ?? null;
		if (line.type === 'cost-state') { p.costState = line; continue; }
		if (line.type === 'ai-title') { p.title = line.aiTitle ?? p.title; continue; }
		if (line.type === 'last-prompt') { p.lastPrompt = line.lastPrompt ?? p.lastPrompt; continue; }
		if (line.type === 'system' && line.subtype === 'compact_boundary') { p.compactions++; continue; }
		if (line.type !== 'user' && line.type !== 'assistant') continue;
		if (line.isSidechain) continue;
		p.cwd ??= line.cwd ?? null;
		if (line.timestamp) { p.first ??= line.timestamp; p.last = line.timestamp; }
		const content = line.message?.content;
		const blocks = Array.isArray(content) ? content : [];
		if (line.type === 'user') {
			if (!line.isMeta && !blocks.some((b) => b.type === 'tool_result')) p.turns++;
			continue;
		}
		for (const b of blocks) if (b.type === 'tool_use' && !tools.has(b.id)) { tools.add(b.id); p.toolCalls++; }
		const model = line.message?.model;
		if (model && !model.startsWith('<')) p.models.add(model);
		const req = line.requestId ?? line.message?.id;
		if (req && line.message?.usage && !p.requests.has(req)) p.requests.set(req, { model, usage: line.message.usage });
	}
	return p;
}

/** Tokens, cost and models from the `usage` blocks — the fallback when no `cost-state` was written. */
export function usageTotals(requests) {
	const t = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0, unknown: false };
	for (const { model, usage: u } of requests.values()) {
		const w5 = u.cache_creation?.ephemeral_5m_input_tokens ?? (u.cache_creation ? 0 : u.cache_creation_input_tokens ?? 0);
		const w1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
		t.input_tokens += u.input_tokens ?? 0; t.output_tokens += u.output_tokens ?? 0;
		t.cache_read_tokens += u.cache_read_input_tokens ?? 0; t.cache_write_tokens += u.cache_creation_input_tokens ?? w5 + w1;
		const price = priceOf(model);
		if (!price) { t.unknown = true; continue; }
		t.cost_usd += (u.input_tokens ?? 0) * price.input + (u.output_tokens ?? 0) * price.output + (u.cache_read_input_tokens ?? 0) * price.read + w5 * price.write5m + w1 * price.write1h;
	}
	return t;
}

const round = (n, d) => n == null ? n : Math.round(n * 10 ** d) / 10 ** d;
const minutes = (ms) => ms == null ? null : round(ms / 60000, 1);

/** The record's fields, from a parsed transcript. `cost-state` wins; the usage sum fills what it lacks. */
export function fieldsOf(parsed, { sessionId, transcript } = {}) {
	const c = parsed.costState;
	const models = c?.modelUsage ? Object.keys(c.modelUsage) : [...parsed.models];
	const sum = (k) => Object.values(c.modelUsage).reduce((n, m) => n + (m[k] ?? 0), 0);
	const u = c?.modelUsage ? { input_tokens: sum('inputTokens'), output_tokens: sum('outputTokens'), cache_read_tokens: sum('cacheReadInputTokens'), cache_write_tokens: sum('cacheCreationInputTokens'), cost_usd: c.totalCostUSD, unknown: !!c.hasUnknownModelCost } : usageTotals(parsed.requests);
	const started = c?.startTime ? new Date(c.startTime).toISOString() : parsed.first;
	const wall = c?.totalDuration ?? (parsed.first && parsed.last ? Date.parse(parsed.last) - Date.parse(parsed.first) : null);
	const id = sessionId ?? parsed.sessionId;
	const out = {
		name: parsed.title ?? parsed.lastPrompt?.slice(0, 80) ?? `session ${String(id).slice(0, 8)}`,
		started, ended: parsed.last, harness: 'claude-code', session_id: id, transcript,
		turns: parsed.turns, tool_calls: parsed.toolCalls,
		input_tokens: u.input_tokens, output_tokens: u.output_tokens, cache_read_tokens: u.cache_read_tokens, cache_write_tokens: u.cache_write_tokens,
		cost_usd: u.unknown && !c ? null : round(u.cost_usd, 4), models,
		wall_minutes: minutes(wall), api_minutes: minutes(c?.totalAPIDuration ?? null),
		lines_added: c?.totalLinesAdded ?? null, lines_removed: c?.totalLinesRemoved ?? null,
	};
	for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
	return out;
}

/** The workspace root: the nearest ancestor with package.json AND package-lock.json, never a folder directly inside git_modules/. */
export function findWorkspace(from = process.cwd()) {
	for (let d = path.resolve(from); ; d = path.dirname(d)) {
		if (path.basename(path.dirname(d)) !== 'git_modules' && fs.existsSync(path.join(d, 'package.json')) && fs.existsSync(path.join(d, 'package-lock.json'))) return d;
		if (path.dirname(d) === d) return null;
	}
}

/** `dt <args>` in the workspace: the installed engine's bin when there is one, `npx dreamteamer` otherwise. */
function dt(ws, args, quiet) {
	const local = path.join(ws, 'node_modules', 'dreamteamer', 'bin', 'dreamteamer.js');
	const r = fs.existsSync(local) ? spawnSync(process.execPath, [local, ...args], { cwd: ws, encoding: 'utf8' }) : spawnSync('npx', ['--no-install', 'dreamteamer', ...args], { cwd: ws, encoding: 'utf8' });
	if (!quiet && r.stdout) process.stdout.write(r.stdout);
	if (r.status !== 0 && !quiet && r.stderr) process.stderr.write(r.stderr);
	return r;
}

/** Keep a copy of the transcript where the workspace keeps files, and say how the record should point at it. */
function keepTranscript(ws, file, id, started, quiet) {
	const r = dt(ws, ['resolve', '${env:FILES_FOLDER}'], true);
	const folder = r.status === 0 ? r.stdout.trim() : '';
	if (!folder || folder.includes('${')) return `\${userHome}/${path.relative(os.homedir(), file).split(path.sep).join('/')}`;
	const month = (started ?? new Date().toISOString()).slice(0, 7).replace('-', '/');
	const rel = `sessions/${month}/${id}.jsonl`;
	try { fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true }); fs.copyFileSync(file, path.join(folder, rel)); }
	catch (e) { if (!quiet) console.error(`transcript not copied: ${e.message}`); }
	return `\${env:FILES_FOLDER}/${rel}`;
}

export function main(argv, env = process.env) {
	const flag = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
	const quiet = argv.includes('--quiet');
	let sessionId = flag('--session') ?? env.CLAUDE_CODE_SESSION_ID, file = flag('--transcript');
	if (argv.includes('--hook')) {
		try { const h = JSON.parse(fs.readFileSync(0, 'utf8')); sessionId = h.session_id ?? sessionId; file = h.transcript_path ?? file; } catch { /* no stdin: fall through to the env */ }
	}
	if (!sessionId) { console.error('no session: set CLAUDE_CODE_SESSION_ID (every Bash and hook subprocess has it) or pass --session <id>'); return 1; }
	file ??= transcriptPathOf(sessionId, process.cwd(), env);
	if (!fs.existsSync(file)) { console.error(`no transcript at ${file}`); return 1; }
	const parsed = parseTranscript(fs.readFileSync(file, 'utf8'));
	const ws = findWorkspace();
	const write = argv.includes('--write');
	const fields = fieldsOf(parsed, { sessionId, transcript: write && ws ? keepTranscript(ws, file, sessionId, parsed.costState?.startTime ? new Date(parsed.costState.startTime).toISOString() : parsed.first, quiet) : undefined });
	for (let i = 0; i < argv.length; i++) if (argv[i] === '--set' && argv[i + 1]?.includes('=')) { const [k, ...v] = argv[i + 1].split('='); fields[k] = v.join('='); }
	if (!write) { console.log(JSON.stringify(fields, null, argv.includes('--json') ? 2 : 0)); return 0; }
	if (!ws) { console.error('no workspace: run from inside a dreamteamer workspace'); return 1; }
	const pairs = Object.entries(fields).flatMap(([k, v]) => Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]);
	const exists = dt(ws, ['get', `sessions/${sessionId}`, '--json'], true).status === 0;
	const r = exists
		? dt(ws, ['set', `sessions/${sessionId}`, ...pairs.map(([k, v]) => `${k}=${v}`)], quiet)
		: dt(ws, ['add', 'sessions', '--id', sessionId, ...pairs.flatMap(([k, v]) => [`--${k}`, String(v)])], quiet);
	if (r.status !== 0) { if (quiet) process.stderr.write(r.stderr ?? ''); return 1; }
	if (!quiet) console.log(`${exists ? 'updated' : 'added'} sessions/${sessionId}: ${fields.turns} turns · ${fields.tool_calls} tool calls · ${fields.cost_usd ?? '?'} USD`);
	return 0;
}

// Both sides realpath'd: reached through a symlink the invoked path and the resolved one differ, and
// a guard that silently never runs reads as a clean pass.
const isMain = () => {
	if (!process.argv[1]) return false;
	const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
	return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
};
if (isMain()) process.exit(main(process.argv.slice(2)));
