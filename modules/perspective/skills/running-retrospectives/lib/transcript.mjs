// Ported verbatim from an earlier conversation-analyzer module (decision 310). Edit here; the original is history.
// Reading a Claude Code transcript, and the handful of facts about its format that everything else
// here depends on. Format notes live in the skill's references/transcript-format.md.
//
// STREAMING IS NOT OPTIONAL. The largest transcript on this machine is 156 MB; `JSON.parse` over a
// whole file, or an array of every line, blows the heap. Every consumer takes a callback.
import fs from 'node:fs';
import readline from 'node:readline';

/** Feed each parsed JSONL line to `onLine`. Unparseable lines are counted, never thrown. */
export async function eachLine(file, onLine) {
	const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
	let bad = 0;
	let n = 0;
	for await (const line of rl) {
		if (!line.trim()) continue;
		let rec;
		try { rec = JSON.parse(line); } catch { bad++; continue; }
		n++;
		onLine(rec, n);
	}
	return { lines: n, unparseable: bad };
}

/** message.content is a string OR a block array. Concatenate the text-bearing blocks. */
export function textOf(content) {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

/**
 * ⚠ Usually EMPTY even when thinking happened. Newer models store the thinking block with only its
 * `signature` and a blank `thinking` string — the reasoning text is not on disk. So this returns ''
 * for most recent sessions, and presence must be counted with countBlocks(c, 'thinking') instead.
 * Anything reasoning-shaped that a summary or analysis wants is therefore unavailable by default;
 * say so rather than concluding the agent did not think.
 */
export function thinkingOf(content) {
	if (!Array.isArray(content)) return '';
	return content.filter((b) => b?.type === 'thinking').map((b) => b.thinking ?? '').join('\n');
}

export function countBlocks(content, type) {
	if (!Array.isArray(content)) return 0;
	return content.reduce((n, b) => n + (b?.type === type ? 1 : 0), 0);
}

export function toolUsesOf(content) {
	if (!Array.isArray(content)) return [];
	return content.filter((b) => b?.type === 'tool_use');
}

export function toolResultsOf(content) {
	if (!Array.isArray(content)) return [];
	return content.filter((b) => b?.type === 'tool_result');
}

// Envelope noise the harness injects into the user role. None of it is the operator speaking, and
// counting any of it as a user turn is the single easiest way to make every ratio in this module lie.
const ENVELOPE = [
	/<system-reminder>[\s\S]*?<\/system-reminder>/g,
	/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g,
	/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g,
	/<command-message>[\s\S]*?<\/command-message>/g,
	/<command-name>[\s\S]*?<\/command-name>/g,
	/<command-args>[\s\S]*?<\/command-args>/g,
	/<command-contents>[\s\S]*?<\/command-contents>/g,
	/<user-prompt-submit-hook>[\s\S]*?<\/user-prompt-submit-hook>/g,
	/<ide_selection>[\s\S]*?<\/ide_selection>/g,
	// the IDE injects this when the operator opens a file; it is the editor speaking, not them,
	// and left in it becomes the record's title ("<ide_opened_file>The user opened…")
	/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g,
	/<ide_diagnostics>[\s\S]*?<\/ide_diagnostics>/g,
];

export function stripEnvelope(text) {
	let t = text ?? '';
	for (const re of ENVELOPE) t = t.replace(re, '');
	return t.trim();
}

export const INTERRUPT_RE = /\[Request interrupted by user/;
const COMMAND_NAME_RE = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/;

// ── the two impostors that inflate turns_user, found by the dreamteamer-engine--dt analysis ──
// Both wear the user role and neither is the operator speaking. On one 3-day unattended build they
// turned 107 real turns into 358 — a 3.3× over-read, and worst on exactly the sessions that look
// most engaged. Since turns_user IS the north-star metric, this poisoned the ratio, prior_score
// and group priority all at once.
//   1. <task-notification> — the harness reporting a background agent finished.
//   2. compaction replay   — /compact re-injects a summary of the prior conversation, verbatim
//      operator history included. Real turns, already counted once.
const TASK_NOTIFICATION_RE = /<task-notification>|\[SYSTEM NOTIFICATION - NOT USER INPUT\]/;
const COMPACT_REPLAY_RE = /^This session is being continued from a previous conversation that ran out of context/m;

/**
 * Classify a `type: "user"` line into what it actually is.
 * Returns { kind, text, command } where kind is one of:
 *   tool_result | interruption | slash_command | envelope | turn
 * `envelope` means the harness spoke, not the operator — never counted as a turn.
 *
 * ⚠ Order matters. task-notification and compaction replay are checked BEFORE the interrupt and
 * command probes, because a replayed compaction summary contains the operator's earlier text
 * verbatim — including any `[Request interrupted` or `<command-name>` in it — and would otherwise
 * be re-counted as a fresh turn every time the session compacts.
 */
export function classifyUserLine(rec) {
	const content = rec.message?.content;
	if (toolResultsOf(content).length) return { kind: 'tool_result', text: '' };
	const raw = textOf(content);
	if (TASK_NOTIFICATION_RE.test(raw)) return { kind: 'envelope', text: '', why: 'task-notification' };
	if (rec.isCompactSummary || COMPACT_REPLAY_RE.test(raw)) return { kind: 'envelope', text: '', why: 'compact-replay' };
	if (INTERRUPT_RE.test(raw)) return { kind: 'interruption', text: raw.trim() };
	const cmd = COMMAND_NAME_RE.exec(raw);
	if (cmd) return { kind: 'slash_command', text: stripEnvelope(raw), command: cmd[1] };
	if (rec.isMeta) return { kind: 'envelope', text: '' };
	const text = stripEnvelope(raw);
	if (!text) return { kind: 'envelope', text: '' };
	return { kind: 'turn', text };
}

/**
 * Assistant turns are SPLIT ACROSS LINES: thinking, text and each tool_use can arrive as separate
 * JSONL records carrying the SAME `message.id`. Counting lines overcounts turns by ~2-3×, so every
 * consumer must fold on message.id. This is the most consequential quirk of the format.
 */
export function assistantMessageId(rec) {
	return rec.message?.id ?? rec.uuid;
}

/** Paths a tool call touched — used for topic entropy and for guessing the subject repo. */
export function pathsInToolInput(name, input) {
	if (!input || typeof input !== 'object') return [];
	const out = [];
	for (const k of ['file_path', 'path', 'notebook_path', 'filePath']) {
		if (typeof input[k] === 'string') out.push(input[k]);
	}
	if (name === 'Bash' && typeof input.command === 'string') {
		// only absolute paths — relative tokens in a shell line are too noisy to attribute
		for (const m of input.command.matchAll(/(?:^|\s)(\/[\w./@~-]{4,})/g)) out.push(m[1]);
	}
	return out;
}

export const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);
export const SKILL_TOOLS = new Set(['Skill', 'SlashCommand', 'activate_skill']);
