// find — the effort ladder, as four pure decisions and nothing else.
//
//   rung 0  lexical     exact words; the right rung whenever the asker can quote the corpus
//   rung 1  vector      embeddings; the strongest single backend on a paraphrase
//   rung 2  structured  lex + vec + hyde in one invocation; hedges a vocabulary gap against an
//                       abstraction gap, which fail for opposite reasons and are rescued by opposite
//                       lanes. One invocation, because cost is dominated by loading the model.
//   rung 3  graph       for a question whose answer set is defined by a reference ("what's broken
//                       in X"), similarity is the wrong relation: the ladder stops ranking and asks
//                       the graph for every record carrying the reference the hits agree on.

/** Words that carry no retrieval signal. Deliberately short: an aggressive stop list throws away the
 *  domain nouns that are the whole point of the lexical lane. */
const STOP = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'in', 'on', 'at',
	'for', 'and', 'or', 'but', 'it', 'its', 'this', 'that', 'we', 'i', 'my', 'our', 'you', 'your',
	'what', 'which', 'who', 'when', 'where', 'how', 'why', 'do', 'does', 'did', 'with', 'from', 'about']);

/** The question reduced to its content words — the mechanical `lex:` default when a caller supplies
 *  none. It is a floor, not a good expansion: it cannot help a question that shares no vocabulary
 *  with its answer, which is exactly when a caller should pass `--lex`. */
export function contentWords(question) {
	// The leading dot is part of the token: `.env` and `.gitignore` are rare, decisive domain nouns, and
	// dropping the dot turns a filename into a generic word.
	return String(question ?? '').toLowerCase().match(/\.?[a-z0-9][a-z0-9._-]*/g)?.filter((w) => !STOP.has(w) && w.replace(/\W/g, '').length > 1) ?? [];
}

/**
 * The structured query document qmd accepts — `intent:` then one line per typed lane.
 *
 * Lanes the caller did not supply are omitted, never defaulted to the raw question on every line.
 * Repeating one string across three lanes does not hedge anything: it asks the same question three
 * ways in the same words, which is the failure the rung exists to fix. `lex` falls back to the
 * question's content words because that is a genuinely different query; `vec` falls back to the
 * question itself because the semantic lane wants prose; `hyde` has NO mechanical fallback, because a
 * hypothetical answer cannot be derived from the question without a model.
 */
export function buildQueryDocument({ question, lex, vec, hyde } = {}) {
	const q = String(question ?? '').trim();
	if (!q) throw new Error('a query document needs a question');
	const lines = [`intent: ${q}`];
	const lexLine = (lex ?? '').trim() || contentWords(q).join(' ');
	if (lexLine) lines.push(`lex: ${lexLine}`);
	const vecLine = (vec ?? '').trim() || q;
	if (vecLine) lines.push(`vec: ${vecLine}`);
	const hydeLine = (hyde ?? '').trim();
	if (hydeLine) lines.push(`hyde: ${hydeLine}`);
	return lines.join('\n');
}

/**
 * A hit's path without its `:line` anchor. qmd returns `path:line`, which makes a citation openable,
 * but `data/notes/x.md:8` is not a file: resolving the anchored path finds nothing, silently.
 */
export function stripLineAnchor(hit) {
	return String(hit ?? '').replace(/:\d+(?::\d+)?$/, '');
}

/**
 * The reference a set of hits AGREES on, or null.
 *
 * The value is derived from the hits, never known in advance; their agreement is the whole signal.
 *
 * It refuses rather than guesses. A genuinely mixed result set has no dominant reference, and
 * expanding through a weak plurality would hand back a confident set built on one coincidence. The
 * threshold is a MAJORITY of the hits that carry the field at all, and at least two of them — one hit
 * agreeing with itself is not agreement.
 */
export function agreedReference(refsPerHit, { min = 2, ratio = 0.5 } = {}) {
	const counts = new Map();
	let carrying = 0;
	for (const ref of refsPerHit ?? []) {
		if (!ref) continue;
		carrying += 1;
		counts.set(ref, (counts.get(ref) ?? 0) + 1);
	}
	if (carrying === 0) return null;
	let best = null;
	let bestN = 0;
	for (const [ref, n] of counts) if (n > bestN) { best = ref; bestN = n; }
	if (bestN < min || bestN / carrying <= ratio) return null;
	return { ref: best, agreeing: bestN, carrying };
}

/** The rungs, named. `effort` is the caller's budget, not a quality dial — see the header. */
export const RUNGS = {
	0: { name: 'lexical', verb: 'search', why: 'exact words. The cheapest exact answer when you already know the phrase' },
	1: { name: 'vector', verb: 'vsearch', why: 'embeddings. The strongest single backend on a paraphrased question' },
	2: { name: 'structured', verb: 'query', why: 'lex+vec+hyde in ONE invocation — hedges a vocabulary gap against an abstraction gap' },
	3: { name: 'structured+graph', verb: 'query', why: 'then close the set through the reference the hits agree on' },
};

/**
 * Which rung a question wants, when the caller did not say.
 *
 * A deliberately timid hint. It answers one question only — "is the asker quoting the corpus, or
 * describing it?" A quoted phrase goes to rung 0, the cheapest exact answer; everything else goes to rung 2,
 * because a paraphrase can fail on either vocabulary or abstraction and the hedge covers both.
 * Nothing here tries to detect a set-shaped question: that is rung 3, and it is a decision about
 * what the ASKER wants back, which a heuristic on wording has no business making for them.
 */
export function suggestEffort(question) {
	const q = String(question ?? '').trim();
	if (/^".*"$/.test(q) || /^'.*'$/.test(q)) return 0;
	return 2;
}

/**
 * Which collection a set of carrying hits actually lives in, given the reference they agreed on.
 *
 * The collection comes from the records that CARRY the agreed reference, because those are the
 * records the set is made of; the first hit may be a record with no such field at all. Several
 * collections may qualify — an issue and a feature can both point at one repo — so the commonest wins.
 */
export function collectionOfAgreeing(carried, ref) {
	const counts = new Map();
	for (const c of carried ?? []) if (c && c.ref === ref && c.collection) counts.set(c.collection, (counts.get(c.collection) ?? 0) + 1);
	let best = null;
	let bestN = 0;
	for (const [c, n] of counts) if (n > bestN) { best = c; bestN = n; }
	return best;
}
