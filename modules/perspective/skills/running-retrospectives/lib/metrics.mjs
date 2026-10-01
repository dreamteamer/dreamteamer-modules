// The deterministic pass — COUNTED, never judged. One streaming read of a JSONL produces every
// MECHANICAL and HEURISTIC field of a perspective/conversations record.
// The version is `metrics/N` — bump it when a number's MEANING changes, not when a regex is tuned.
//
// The SESSION-COST layer: the words the human had to type against the words that came back
// (`input_words` / `output_words`, and the `correction_ratio` guard beside them), the tool and MCP
// mix, the skills actually invoked rather than merely present, and `interruptions` — the person's
// real stop button, typically more frequent than a permission denial.
// `skill_tokens_active` is deliberately NOT here: a transcript does not carry per-skill token
// attribution, and a guess would be worse than the gap.
// The input bill is split: `input_tokens` alone is the uncached remainder and is NOT what a session
// cost; `tokens_total` is the number to quote.
import path from 'node:path';
import { statSync as fsStatSync } from 'node:fs';
import { eachLine, textOf, toolUsesOf, toolResultsOf, classifyUserLine, assistantMessageId, pathsInToolInput, SUBAGENT_TOOLS, SKILL_TOOLS, INTERRUPT_RE } from './transcript.mjs';
import { classifyUserTurn, classifyAgentTurn } from './acts.mjs';
import { resolveRepo, interestingDir } from './repo.mjs';

export const INSPECTOR_VERSION = 'metrics/3';

/**
 * The fields on a conversation record that a COUNTER must never touch — written by a later judgement
 * pass and carried through every re-read, at every inspector version.
 *
 * It lives here, in the file whose whole job is "counted, never judged", because it is the list of
 * what counting may not overwrite. A shared constant belongs in a lib: importing a reader for one
 * constant RUNS it, and its argument check calls `process.exit(2)` at load.
 */
export const JUDGED_KEYS = ['subject_repos', 'divergences', 'plan_changes', 'summary', 'goals', 'key_topics', 'outcome', 'knowledge_kinds', 'interest_score', 'interest_reason'];
const DENIAL_RE = /(user doesn'?t want to (proceed|take this action)|tool use was rejected|user (rejected|denied|refused) (the|this))/i;
const bump = (m, k, n = 1) => k && m.set(k, (m.get(k) ?? 0) + n);
/** Words, the unit everything normalises to — a PRD is words and so is code. Whitespace runs, nothing cleverer. */
export const words = (t) => (String(t ?? '').match(/\S+/g) ?? []).length;
const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

export const USER_ACTS_KEPT = ['directive', 'correction', 'rejection', 'approval', 'question', 'context'];
export const AGENT_ACTS_KEPT = ['plan', 'question', 'refusal'];

export async function computeMetrics(file, { session_id = '', account = '', subagent_paths = [], orphan_subagents = [] } = {}) {
	// Some .jsonl files carry NO timestamp on any line — a file of pure `/compact` checkpoints, every
	// line `type: summary` and no conversation at all, is the case. started_at is required and is what the id and every window are keyed on, so it falls back
	// to the file's mtime and `dated_from_mtime` says so rather than the record landing in 1970.
	const s = {
		cwds: new Map(), dirs: new Map(), skills: new Set(), commands: new Set(), filesEdited: new Set(),
		userActs: new Map(), agentActs: new Map(), seenUsage: new Set(),
		tools: new Set(), mcps: new Set(), skillsUsed: new Set(),
		turnsUser: 0, turnsAssistant: 0, toolCalls: 0, toolErrors: 0, denials: 0, tokIn: 0, tokOut: 0,
		tokCacheRead: 0, tokCacheWrite: 0,
		inputWords: 0, outputWords: 0, correctionWords: 0, interruptions: 0,
		firstTs: null, lastTs: null, activeMs: 0, prevTs: null, aiTitle: '', firstUserText: '',
	};
	let lastAgentAskedQuestion = false, prevHadTools = false, pending = null;
	const flushAssistant = () => {
		if (!pending) return;
		s.turnsAssistant++;
		const act = classifyAgentTurn(pending.text, { hasTools: pending.tools > 0, hasSubagent: pending.hasSubagent, hasAskUser: pending.hasAskUser, hasPlanTool: pending.hasPlanTool, prevHadTools });
		bump(s.agentActs, act);
		lastAgentAskedQuestion = act === 'question';
		prevHadTools = pending.tools > 0;
		pending = null;
	};
	const onTool = (t, p) => {
		s.toolCalls++;
		s.tools.add(t.name);
		// `mcp__<server>__<tool>` is the harness's own spelling — the server is the middle segment.
		if (typeof t.name === 'string' && t.name.startsWith('mcp__')) { const srv = t.name.split('__')[1]; if (srv) s.mcps.add(srv); }
		if (p) p.tools++;
		if (SUBAGENT_TOOLS.has(t.name) && p) p.hasSubagent = true;
		if (t.name === 'AskUserQuestion' && p) p.hasAskUser = true;
		if ((t.name === 'ExitPlanMode' || t.name === 'EnterPlanMode') && p) p.hasPlanTool = true;
		if (SKILL_TOOLS.has(t.name)) {
			const n = t.input?.skill ?? t.input?.command ?? t.input?.name;
			if (n) {
				const name = String(n).replace(/^\//, '');
				s.skills.add(name);
				// USED is the narrower set: a SlashCommand is a command the person typed, and its
				// body may never open a skill. Only the Skill verbs prove a skill's content ran.
				if (t.name !== 'SlashCommand') s.skillsUsed.add(name);
			}
		}
		if (t.name === 'Edit' || t.name === 'Write' || t.name === 'NotebookEdit') { const fp = t.input?.file_path ?? t.input?.notebook_path; if (fp) s.filesEdited.add(fp); }
		for (const fp of pathsInToolInput(t.name, t.input)) { const d = path.dirname(fp); if (interestingDir(d)) bump(s.dirs, d); }
	};

	await eachLine(file, (r) => {
		const ts = r.timestamp ? Date.parse(r.timestamp) : NaN;
		if (!Number.isNaN(ts)) {
			if (s.firstTs === null || ts < s.firstTs) s.firstTs = ts;
			if (s.lastTs === null || ts > s.lastTs) s.lastTs = ts;
			if (s.prevTs !== null) { const gap = ts - s.prevTs; if (gap > 0 && gap < 10 * 60_000) s.activeMs += gap; }
			s.prevTs = ts;
		}
		if (r.cwd) bump(s.cwds, r.cwd);
		if (r.aiTitle && !s.aiTitle) s.aiTitle = r.aiTitle;
		if (r.isSidechain) { if (r.type === 'assistant') for (const t of toolUsesOf(r.message?.content)) onTool(t, null); return; }
		if (r.type === 'assistant') {
			const c = r.message?.content, id = assistantMessageId(r);
			if (!pending || pending.id !== id) { flushAssistant(); pending = { id, text: '', tools: 0, hasSubagent: false, hasAskUser: false, hasPlanTool: false }; }
			const u = r.message?.usage;
			if (u && !s.seenUsage.has(id)) {
				s.seenUsage.add(id);
				// `input_tokens` is the UNCACHED remainder only. On a long agentic session almost the
				// whole input bill is `cache_read_input_tokens`, so reading input_tokens as "what this
				// cost" under-reports by two orders of magnitude.
				s.tokIn += u.input_tokens ?? 0;
				s.tokOut += u.output_tokens ?? 0;
				s.tokCacheRead += u.cache_read_input_tokens ?? 0;
				s.tokCacheWrite += u.cache_creation_input_tokens ?? 0;
			}
			const atext = textOf(c);
			pending.text += atext;
			s.outputWords += words(atext);
			for (const t of toolUsesOf(c)) onTool(t, pending);
			return;
		}
		if (r.type !== 'user') return;
		flushAssistant();
		const cls = classifyUserLine(r);
		if (cls.kind === 'tool_result') {
			for (const tr of toolResultsOf(r.message?.content)) {
				const body = typeof tr.content === 'string' ? tr.content : textOf(tr.content);
				if (tr.is_error) s.toolErrors++;
				if (DENIAL_RE.test(body)) s.denials++;
			}
			return;
		}
		if (cls.kind === 'envelope') return;
		s.turnsUser++;
		if (cls.kind === 'interruption') { s.interruptions++; return; }
		if (cls.kind === 'slash_command') { s.commands.add(cls.command); s.inputWords += words(cls.text) + 1; if (!s.firstUserText) s.firstUserText = `/${cls.command}${cls.text ? ' ' + cls.text : ''}`; return; }
		if (!s.firstUserText && cls.text) s.firstUserText = cls.text;
		const act = classifyUserTurn(cls.text, { userTurns: s.turnsUser - 1, lastAgentAskedQuestion });
		const w = words(cls.text);
		s.inputWords += w;
		// The ratio's numerator. A correction turn is the person paying twice for the same output,
		// so its words are the ones that must FALL while `output_words` holds.
		if (act === 'correction' || act === 'rejection') s.correctionWords += w;
		bump(s.userActs, act);
		lastAgentAskedQuestion = false;
	});
	flushAssistant();

	for (const sc of [...subagent_paths, ...orphan_subagents]) {
		try { await eachLine(sc, (r) => { if (!r.message) return; if (r.type !== 'assistant') { for (const tr of toolResultsOf(r.message.content)) if (tr.is_error) s.toolErrors++; return; } for (const t of toolUsesOf(r.message.content)) onTool(t, null); }); } catch { /* an unreadable sidecar costs volume, never the session */ }
	}

	let datedFromMtime = false;
	if (s.firstTs === null) { try { s.firstTs = s.lastTs = fsStatSync(file).mtimeMs; datedFromMtime = true; } catch { /* unreadable stat leaves 1970, and check will say so */ } }
	const cwd = top(s.cwds);
	const { repo } = resolveRepo(cwd);
	const title = (s.aiTitle || s.firstUserText.split('\n').find((l) => l.trim()) || '(untitled session)').trim().slice(0, 140);
	const m = {
		session_id, harness: 'claude-code', account, title,
		started_at: s.firstTs !== null ? new Date(s.firstTs).toISOString() : '',
		ended_at: s.lastTs !== null ? new Date(s.lastTs).toISOString() : '',
		active_minutes: +(s.activeMs / 60_000).toFixed(1),
		repo_name: repo === 'unknown' ? '' : repo,
		turns_user: s.turnsUser, turns_assistant: s.turnsAssistant,
		tool_calls: s.toolCalls, tool_errors: s.toolErrors, files_edited: s.filesEdited.size,
		skills_loaded: [...s.skills].sort().slice(0, 30), commands_invoked: [...s.commands].sort().slice(0, 30),
		tokens_input: s.tokIn, tokens_output: s.tokOut,
		tokens_cache_read: s.tokCacheRead, tokens_cache_write: s.tokCacheWrite,
		tokens_total: s.tokIn + s.tokOut + s.tokCacheRead + s.tokCacheWrite,
		input_words: s.inputWords, output_words: s.outputWords,
		// Guard against a divide-by-zero reading as a perfect session: a session that produced no
		// words has no ratio at all, and the field is absent rather than 0.
		correction_ratio: s.outputWords ? +(s.correctionWords / s.outputWords).toFixed(4) : undefined,
		tools_used: [...s.tools].sort().slice(0, 40),
		mcp_servers: [...s.mcps].sort().slice(0, 20),
		skills_used: [...s.skillsUsed].sort().slice(0, 30),
		interruptions: s.interruptions,
		permission_denials: s.denials,
		inspector_version: INSPECTOR_VERSION,
		dated_from_mtime: datedFromMtime || undefined,
		_repo_cwd: cwd,
	};
	for (const k of USER_ACTS_KEPT) m[`user_${k}`] = s.userActs.get(k) ?? 0;
	for (const k of AGENT_ACTS_KEPT) m[`agent_${k}`] = s.agentActs.get(k) ?? 0;
	return { ...m, ...gate(m, s) };
}

/** THE GATE — about VOLUME, never value. Fails → depth: minimal, no model involved. */
export function gate(m, s) {
	const userChars = s.firstUserText.length; // cheap proxy; the trimmed port keeps no per-turn char totals
	let reason = '';
	if (m.turns_user === 0) reason = 'no operator turns';
	else if (m.turns_user <= 1 && m.turns_assistant <= 2 && m.tool_calls <= 3) reason = 'false start (one prompt, no work)';
	else if (userChars < 120 && m.turns_user <= 2 && m.tool_calls === 0) reason = 'trivial exchange, no tools';
	return { candidate: !reason, gate_reason: reason };
}
