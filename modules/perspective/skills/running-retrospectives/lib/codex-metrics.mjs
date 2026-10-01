// The deterministic pass over a CODEX rollout — the same contract `lib/metrics.mjs` produces for a
// Claude transcript, computed from a different wire format. COUNTED, never judged.
//
// ⚠ WHY A SECOND FILE AND NOT A BRANCH IN metrics.mjs: the two formats share no line shape. A Claude
// transcript is one object per message with `type: user|assistant` and a `message.content` array; a
// codex rollout is one object per EVENT — `{timestamp, ordinal, type, payload}` — where a message is
// a `response_item` whose payload carries the role, a tool call is a `custom_tool_call`, and the
// token bill arrives as its own periodic `token_count` event. Threading that through one reader
// would mean a format switch on every field; two readers producing ONE record shape is the smaller
// thing to hold, and the shape is what the rest of the module consumes.
//
// The field set is deliberately a SUBSET of the Claude one and says so by ABSENCE, never by zero:
// a codex rollout carries no interruption event, no permission-denial marker and no skill-load
// signal, so `interruptions`, `permission_denials` and `skills_loaded` are left off the record
// rather than written as 0 — a 0 there is a measurement, and this format cannot make it.
import { statSync } from 'node:fs';
import fs from 'node:fs';
import readline from 'node:readline';
import { resolveRepo } from './repo.mjs';
import { words } from './metrics.mjs';

export const CODEX_INSPECTOR_VERSION = 'codex-metrics/1';

/** The same idle rule the Claude reader uses — a gap over ten minutes is not work, it is a break. */
const IDLE_MS = 10 * 60_000;
/** Absolute paths inside a tool's arguments. ⚠ A HEURISTIC, and the honest name for it: codex tools
 *  are free-form (`exec` takes a line of JavaScript), so there is no structured file argument to
 *  read. This counts distinct absolute paths mentioned in tool input — a volume signal, never a
 *  claim that each was edited. `files_touched` is what the record calls it, not `files_edited`. */
const ABS_PATH = /\/(?:Users|home|opt|var|tmp|srv)\/[A-Za-z0-9._~@+-]+(?:\/[A-Za-z0-9._~@+-]+)*/g;
/** Conservative: only what the harness itself prints when a call did not run. */
const TOOL_ERROR = /^(Script failed|Error:|error:)|\bScript error:/m;
/**
 * ⚠ MOST CODEX "USER" MESSAGES ARE NOT THE USER. The desktop app injects its own context as messages
 * with `role: user`, each opening with a tag — measured over the real corpus: 398
 * `<realtime_delegation>`, 121 `<codex_delegation>`, 40 `<recommended_plugins>`, 25
 * `<environment_context>`, 12 `<heartbeat>`. 596 envelopes against a handful of typed lines, and 46
 * of 47 sessions OPENED with one, so counting them made every session look like a long human brief
 * and titled all fourteen new activity candidates `<recommended_plugins>`.
 *
 * The Claude reader has the same distinction (`classifyUserLine`'s `envelope` kind); this is the
 * codex spelling of it. An envelope is counted — as an envelope — and is never a turn, never words,
 * and never the title.
 */
const ENVELOPE = /^\s*<(recommended_plugins|realtime_delegation|codex_delegation|environment_context|heartbeat|user_instructions|app-context)>/;

const textOf = (content) => {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content.map((c) => (typeof c === 'string' ? c : c?.text ?? '')).join('\n');
};

/**
 * The session id a rollout file belongs to, read from its first `session_meta`, or '' when it has
 * none. Cheap: it stops at the first line that answers.
 *
 * ⚠ A CODEX SESSION SPANS SEVERAL FILES. Continuing a thread writes a NEW rollout whose
 * `session_meta` repeats the original `session_id` and adds `parent_thread_id`. Measured on the
 * first read: 53 rollouts, 32 sessions — and a reader keyed one-record-per-FILE silently dropped
 * every continuation, because the second file's record landed on the first's path and was skipped as
 * already current. Its turns, tokens and tool calls went nowhere, and the weekly counters counted
 * 53 sessions that did not exist.
 */
export async function sessionIdOf(file) {
	const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
	try {
		for await (const line of rl) {
			if (!line.trim()) continue;
			let d;
			try { d = JSON.parse(line); } catch { continue; }
			if (d.type === 'session_meta') return d.payload?.session_id || d.payload?.id || '';
		}
	} finally { rl.close(); }
	return '';
}

/**
 * Every rollout of ONE session → one conversation record's mechanical fields. Pass the files in the
 * order they were written; the counters are additive and the timestamps are min/max, so order only
 * matters for `title` (the first thing the operator actually typed).
 *
 * Returns null when no file in the group holds a `session_meta` — that is not a session, and
 * inventing an id for it would put a record in the collection nothing can ever join back to.
 */
export async function computeCodexMetrics(files, { account = 'codex' } = {}) {
	const group = Array.isArray(files) ? files : [files];
	const s = {
		firstTs: null, lastTs: null, activeMs: 0, prevTs: null,
		turnsUser: 0, turnsAssistant: 0, toolCalls: 0, toolErrors: 0,
		envelopes: 0, spokenTurns: 0, lastSegmentRole: '',
		inputWords: 0, outputWords: 0, files: new Set(), tools: new Set(),
		firstUserText: '', cwd: '', sessionId: '', meta: null, metas: 0,
		tok: null, models: new Set(), forked: false, subagents: new Set(),
	};

	for (const file of group) {
	let fileTok = null;
	const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
	for await (const line of rl) {
		if (!line.trim()) continue;
		let d;
		try { d = JSON.parse(line); } catch { continue; }   // a torn line costs volume, never the session
		const p = d.payload ?? {};
		const ts = Date.parse(d.timestamp ?? '');
		if (Number.isFinite(ts)) {
			if (s.firstTs === null || ts < s.firstTs) s.firstTs = ts;
			if (s.lastTs === null || ts > s.lastTs) s.lastTs = ts;
			if (s.prevTs !== null) { const gap = ts - s.prevTs; if (gap > 0 && gap < IDLE_MS) s.activeMs += gap; }
			s.prevTs = ts;
		}

		if (d.type === 'session_meta') {
			s.metas++;
			// The FIRST one is the session; later ones are forks and spawned agents inside the same
			// rollout, counted rather than split into records nothing else references.
			if (!s.meta) { s.meta = p; s.sessionId = p.session_id || p.id || ''; s.cwd = p.cwd || ''; }
			else if (p.agent_nickname) s.subagents.add(p.agent_nickname);
			if (p.forked_from_id) s.forked = true;
			continue;
		}
		if (d.type === 'turn_context') { if (p.model) s.models.add(p.model); continue; }
		// ⚠ THE OPERATOR SPOKE. A realtime voice session carries no typed user message at all — the
		// human half is `transcript_segment` with `role: user`, and there were 348 of them against a
		// single plain-text typed opener across the whole corpus. Segments are FRAGMENTS of one
		// utterance, so a contiguous RUN of them is one turn; counting each would inflate a two-minute
		// exchange into forty turns.
		if (d.type === 'realtime_item' && p.type === 'transcript_segment') {
			const text = String(p.text ?? '');
			const role = p.role === 'user' || p.role === 'assistant' ? p.role : '';
			if (!role) continue;
			if (role !== s.lastSegmentRole) {
				if (role === 'user') { s.turnsUser++; s.spokenTurns++; } else s.turnsAssistant++;
				s.lastSegmentRole = role;
			}
			if (role === 'user') { s.inputWords += words(text); if (!s.firstUserText && text.trim()) s.firstUserText = text.trim(); }
			else s.outputWords += words(text);
			continue;
		}
		// ⚠ `total_token_usage` is cumulative WITHIN a rollout and restarts in the next one, so the
		// session's bill is the last figure of each file added up — taking the last of the group would
		// report only the final sitting.
		if (d.type === 'event_msg' && p.type === 'token_count') { if (p.info?.total_token_usage) fileTok = p.info.total_token_usage; continue; }
		if (d.type !== 'response_item') continue;

		if (p.type === 'message') {
			// ⚠ `developer` is the harness's own context injection, not a person. Counting it as a user
			// turn would make every session look like it began with a long human brief.
			const body = textOf(p.content);
			if (p.role === 'user') {
				if (ENVELOPE.test(body)) { s.envelopes++; continue; }
				s.turnsUser++;
				s.lastSegmentRole = '';   // a typed message ends whatever spoken run was open
				s.inputWords += words(body);
				if (!s.firstUserText && body.trim()) s.firstUserText = body.trim();
			} else if (p.role === 'assistant') {
				s.turnsAssistant++;
				s.lastSegmentRole = '';
				s.outputWords += words(body);
			}
			continue;
		}
		if (p.type === 'custom_tool_call' || p.type === 'function_call') {
			s.toolCalls++;
			if (p.name) s.tools.add(String(p.name));
			const args = typeof p.input === 'string' ? p.input : typeof p.arguments === 'string' ? p.arguments : '';
			for (const m of args.matchAll(ABS_PATH)) s.files.add(m[0]);
			continue;
		}
		if (p.type === 'custom_tool_call_output' || p.type === 'function_call_output') {
			const body = textOf(p.output);
			if (TOOL_ERROR.test(body)) s.toolErrors++;
		}
	}
	// A new file is a new sitting: the gap ACROSS files is not work, so the idle clock restarts
	// rather than charging the session for the hours between two rollouts.
	s.prevTs = null;
	if (fileTok) {
		if (!s.tok) s.tok = { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0 };
		for (const k of ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens']) {
			s.tok[k] = (s.tok[k] ?? 0) + Number(fileTok[k] ?? 0);
		}
	}
	}

	if (!s.meta) return null;

	let datedFromMtime = false;
	if (s.firstTs === null) {
		try { s.firstTs = s.lastTs = statSync(group[0]).mtimeMs; datedFromMtime = true; }
		catch { /* unreadable stat leaves 1970, and check will say so */ }
	}

	const { repo } = resolveRepo(s.cwd);
	// A message shape is not a turn boundary for a typed message, so a run of segments and a typed
	// message never merge; but a typed message DOES end the current spoken run.
	const title = (s.firstUserText.split('\n').find((l) => l.trim()) || '(untitled codex session)').trim().slice(0, 140);
	const t = s.tok ?? {};
	// `input_tokens` on codex is the WHOLE input including the cached part; the Claude record's
	// `tokens_input` is the uncached remainder, so the cached half is subtracted to keep one meaning
	// across the two harnesses. `tokens_total` stays the number to quote.
	const cached = Number(t.cached_input_tokens ?? 0);
	const tokensInput = Math.max(0, Number(t.input_tokens ?? 0) - cached);
	const tokensOutput = Number(t.output_tokens ?? 0);
	const cacheWrite = Number(t.cache_write_input_tokens ?? 0);

	const m = {
		session_id: s.sessionId,
		harness: 'codex',
		account,
		title,
		started_at: s.firstTs !== null ? new Date(s.firstTs).toISOString() : '',
		ended_at: s.lastTs !== null ? new Date(s.lastTs).toISOString() : '',
		active_minutes: +(s.activeMs / 60_000).toFixed(1),
		repo_name: repo === 'unknown' ? '' : repo,
		turns_user: s.turnsUser,
		turns_assistant: s.turnsAssistant,
		// Named, not hidden: 596 across the corpus, and the reason `turns_user` is small.
		harness_envelopes: s.envelopes || undefined,
		spoken_turns: s.spokenTurns || undefined,
		tool_calls: s.toolCalls,
		tool_errors: s.toolErrors,
		files_edited: s.files.size,
		tools_used: [...s.tools].sort().slice(0, 40),
		tokens_input: tokensInput,
		tokens_output: tokensOutput,
		tokens_cache_read: cached,
		tokens_cache_write: cacheWrite,
		tokens_total: tokensInput + tokensOutput + cached + cacheWrite,
		input_words: s.inputWords,
		output_words: s.outputWords,
		inspector_version: CODEX_INSPECTOR_VERSION,
		dated_from_mtime: datedFromMtime || undefined,
		_repo_cwd: s.cwd,
		_models: [...s.models].sort(),
		_subagents: s.subagents.size,
		_forked: s.forked || undefined,
		_rollouts: group.length,
	};
	return { ...m, ...codexGate(m) };
}

/** THE GATE — about VOLUME, never value, and the same three thresholds the Claude gate applies. */
export function codexGate(m) {
	let reason = '';
	if (m.turns_user === 0) reason = 'no operator turns';
	else if (m.turns_user <= 1 && m.turns_assistant <= 2 && m.tool_calls <= 3) reason = 'false start (one prompt, no work)';
	else if (m.input_words < 20 && m.turns_user <= 2 && m.tool_calls === 0) reason = 'trivial exchange, no tools';
	return { candidate: !reason, gate_reason: reason };
}
