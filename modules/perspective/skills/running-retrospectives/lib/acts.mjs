// Ported verbatim from an earlier conversation-analyzer module (decision 310). Edit here; the original is history.
// Heuristic DIALOGUE ACT classification — the cheap prior the model later refines.
//
// Terminology: these are *dialogue acts* (speech-act theory / conversation analysis) — what a turn
// DOES, not what it is about. The taxonomy and the reasoning behind each class live in the skill's
// references/dialogue-acts.md; this file is only the regex layer.
//
// Rules are ORDERED and first-match-wins. That ordering is the classifier — a turn that both
// corrects and adds work is a `correction`, because the correction is the expensive part.
// Everything unmatched is a `directive`, which is the honest default for an operator turn.

const first = (rules, text, ctx) => {
	for (const [name, test] of rules) if (test(text, ctx)) return name;
	return null;
};

const shortish = (t, n = 60) => t.length <= n;

const USER_RULES = [
	['approval', (t) => shortish(t, 60) && /^(y|yes+|ok|okay|k|go|go ahead|do it|yep|yeah|sure|lgtm|approved?|proceed|continue|perfect|great|nice|thanks|ty|👍|\+1|✅)\b/i.test(t)],
	['rejection', (t) => /^(n|no+|nope|stop|don'?t|cancel|revert|undo|abort|scrap|forget it)\b/i.test(t) || /\b(don'?t do that|not that|revert (it|that)|undo (it|that))\b/i.test(t)],
	['correction', (t) => /\b(that'?s (wrong|not (right|what)|incorrect)|you (missed|forgot|broke|misunderstood|didn'?t)|not what i (asked|meant|wanted|said)|i (said|asked for)|still (broken|failing|not working|wrong|doesn'?t)|didn'?t work|doesn'?t work|it'?s still|wrong\b|actually,? (no|it|that|you))/i.test(t)],
	// asked BEFORE meta so "why did you use opus" reads as a question, not a preference
	['question', (t) => /\?/.test(t) && (shortish(t, 400) || /^(what|why|how|when|where|which|who|can|could|do|does|did|is|are|should|would|will)\b/i.test(t))],
	['meta', (t) => /\b(use (opus|sonnet|haiku|fable|the .{0,20}model)|switch to (opus|sonnet|haiku)|be (less|more) (verbose|concise|terse)|stop (being|doing|adding)|from now on|next time|always |never |remember (this|that)|add (this|that) to (claude\.md|the skill|memory))\b/i.test(t)],
	['refinement', (t, c) => c.userTurns > 0 && /^(also|and |plus |additionally|now |then |next,? |instead|but |one more|another)\b/i.test(t)],
	['answer', (t, c) => c.lastAgentAskedQuestion && shortish(t, 300)],
	// a long paste with no imperative and no question is the operator handing over material
	['context', (t) => t.length > 500 && !/\?/.test(t) && !/^(add|make|create|write|fix|change|update|remove|delete|run|build|implement|refactor|do|use|check|find|show|give|let'?s|please|can you|i want|i need)\b/i.test(t)],
];

const AGENT_RULES = [
	['refusal', (t) => /\b(i (can'?t|cannot|won'?t) (help|assist|do that|create|provide)|i'?m (not able|unable) to|i (have to|must) decline|i won'?t be able to)\b/i.test(t)],
	['handoff', (_t, c) => c.hasSubagent],
	['question', (t, c) => c.hasAskUser || (/\?\s*$/.test(t.trimEnd()) && t.length < 1200)],
	['plan', (t, c) => c.hasPlanTool || /\b(here'?s (my|the) plan|the plan\b|my plan\b|i'?ll (start by|first|begin)|## plan|approach:|proposed approach|step 1[.:)]|plan:)/i.test(t)],
	['execution', (t, c) => c.hasTools && t.length < 600],
	['report', (t, c) => c.hasTools || (c.prevHadTools && t.length >= 200)],
	['assertion', () => true],
];

// A concession is counted SEPARATELY from the act (a turn can be both a report and an apology),
// because "how often did it climb down" is a friction metric, not a taxonomy slot.
export const APOLOGY_RE = /\b(i apologi[sz]e|i'?m sorry|sorry (about|for|,)|my (mistake|apologies|error)|you'?re (absolutely |quite |completely )?right|you are right|i was wrong|that was (my |an )?(error|mistake|wrong)|i (incorrectly|mistakenly|wrongly|erroneously)|good catch|my bad)\b/i;

export const USER_ACTS = ['directive', 'refinement', 'correction', 'rejection', 'approval', 'question', 'answer', 'context', 'meta', 'interruption', 'slash_command'];
export const AGENT_ACTS = ['plan', 'execution', 'report', 'question', 'assertion', 'refusal', 'handoff'];

export function classifyUserTurn(text, ctx) {
	return first(USER_RULES, text, ctx) ?? 'directive';
}

export function classifyAgentTurn(text, ctx) {
	return first(AGENT_RULES, text, ctx) ?? 'assertion';
}
