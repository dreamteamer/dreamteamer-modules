// find — the effort ladder, as four pure decisions and nothing else.
//
// ⚠ EVERY RUNG HERE WAS MEASURED BEFORE IT WAS BUILT, and two of them contradicted the design they
// replaced. The numbers come from a 300-document markdown corpus with questions worded the way an
// asker phrases them BEFORE knowing the corpus's vocabulary, plus a control fixture worded in the
// corpus's own words. What they settled:
//
//   rung 0  lexical    recall 0.22 on paraphrase · MRR 1.00 in 9ms on a known phrase
//   rung 1  vector     recall 0.80, and the best MRR (0.62) and recall@1 (0.48) of any single backend
//   rung 2  structured recovers BOTH questions that score 0.00 on every single-shot backend
//   rung 3  graph      4 of 4 where retrieval tops out at 3 of 4, in 0.347s
//
// ⚠ RUNG 0 IS NOT A FALLBACK. On a question asked in the corpus's own words, lexical scores MRR 1.00
// in 9ms and the full re-ranked pipeline scores the same in ~22,900ms — 2,500x the cost for an
// identical rank-1 answer, and vector alone is WORSE there (0.81), because embeddings blur a literal
// string that FTS5 matches exactly. When you know the phrase, reaching for retrieval is a pure loss.
//
// ⚠ RUNG 2 IS A HEDGE, NOT A SMARTER QUERY, and the ablation is the reason. Two questions that no
// backend answers fail for OPPOSITE reasons and are rescued by OPPOSITE lanes: a vocabulary gap goes
// lex 1 / hyde 2 / vec 3, and an abstraction gap goes lex MISS / vec 1 / hyde 1. Neither lane wins
// both, and the asker cannot tell which they have — not knowing the corpus's words is WHY they are
// asking. So all three lanes go in ONE invocation, which is what makes hedging affordable: cost is
// dominated by per-invocation model load, so three lanes cost about one load and three separate
// queries cost three.
//
// ⚠ RUNG 3 IS A ROUTE, NOT A RANK — the biggest thing the measurements changed. For a question whose
// answer set is defined by a REFERENCE ("what's broken in X"), retrieval returned 1 of 4 plain and
// 3 of 4 structured, with TEN slots available for four answers, and could not close it at any rung.
// The fourth record is not less similar by mistake; it is a different thing that shares a parent.
// Similarity is the wrong relation for that question, so the ladder stops ranking and asks the graph.

/** Words that carry no retrieval signal. Deliberately short: an aggressive stop list throws away the
 *  domain nouns that are the whole point of the lexical lane. */
const STOP = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'in', 'on', 'at',
	'for', 'and', 'or', 'but', 'it', 'its', 'this', 'that', 'we', 'i', 'my', 'our', 'you', 'your',
	'what', 'which', 'who', 'when', 'where', 'how', 'why', 'do', 'does', 'did', 'with', 'from', 'about']);

/** The question reduced to its content words — the mechanical `lex:` default when a caller supplies
 *  none. ⚠ It is a FLOOR, not a good expansion: the measured failure it cannot fix is a question that
 *  shares no vocabulary with its answer at all, which is exactly when a caller should pass `--lex`. */
export function contentWords(question) {
	// ⚠ THE LEADING DOT IS PART OF THE TOKEN. `.vscodeignore`, `.env` and `.gitignore` are domain nouns
	// in these repos, and they are precisely the rare, decisive terms the lexical lane exists to carry —
	// dropping the dot turns a filename into a generic word.
	return String(question ?? '').toLowerCase().match(/\.?[a-z0-9][a-z0-9._-]*/g)?.filter((w) => !STOP.has(w) && w.replace(/\W/g, '').length > 1) ?? [];
}

/**
 * The structured query document qmd accepts — `intent:` then one line per typed lane.
 *
 * ⚠ LANES THE CALLER DID NOT SUPPLY ARE OMITTED, never defaulted to the raw question on every line.
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
 * ⚠ STRIP THE LINE ANCHOR BEFORE RESOLVING A HIT. qmd returns `path:line`, which is a feature — it is
 * what makes a citation openable — and it is also why graph expansion silently resolves NOTHING if
 * you skip this: `data/rnd/x.md:8` is not a file, and the path LOOKS correct in the output. It cost a
 * debugging round to find, and it fails without an error.
 */
export function stripLineAnchor(hit) {
	return String(hit ?? '').replace(/:\d+(?::\d+)?$/, '');
}

/**
 * The reference a set of hits AGREES on, or null.
 *
 * ⚠ DERIVED FROM THE HITS, NEVER KNOWN IN ADVANCE — that is what separates rung 3 from a demo built
 * backwards from its answer. Measured: 6 of the 7 hits carrying a `repo` agreed on one value, and
 * that agreement is the whole signal.
 *
 * ⚠ AND IT REFUSES RATHER THAN GUESSES. A genuinely mixed result set has no dominant reference, and
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
	0: { name: 'lexical', verb: 'search', why: 'exact words. MRR 1.00 in 9ms when you already know the phrase' },
	1: { name: 'vector', verb: 'vsearch', why: 'embeddings. Best MRR and recall@1 of any single backend' },
	2: { name: 'structured', verb: 'query', why: 'lex+vec+hyde in ONE invocation — hedges a vocabulary gap against an abstraction gap' },
	3: { name: 'structured+graph', verb: 'query', why: 'then close the set through the reference the hits agree on' },
};

/**
 * Which rung a question wants, when the caller did not say.
 *
 * ⚠ THIS IS A HINT AND IT IS DELIBERATELY TIMID. It answers one question only — "is the asker quoting
 * the corpus, or describing it?" — because that is the one split the measurements actually support. A
 * quoted phrase goes to rung 0, where it scores MRR 1.00 for 9ms; everything else goes to rung 2,
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
 * ⚠ THIS EXISTS BECAUSE TAKING IT FROM THE FIRST HIT WAS A REAL DEFECT, and it failed in the way that
 * is hardest to catch: the first hit was a document carrying no reference field at all, so the
 * expansion filtered the WRONG collection, the engine exited non-zero, and the rung reported "the hits
 * agree on no reference" — a refusal that reads as principled and is actually a bug. Found only by
 * walking the live flow; every unit below it was green.
 *
 * The collection must come from the records that CARRY the agreed reference, because those are the
 * records the set is made of. Several collections may qualify — an issue and a feature can both point
 * at one repo — so the commonest wins.
 */
export function collectionOfAgreeing(carried, ref) {
	const counts = new Map();
	for (const c of carried ?? []) if (c && c.ref === ref && c.collection) counts.set(c.collection, (counts.get(c.collection) ?? 0) + 1);
	let best = null;
	let bestN = 0;
	for (const [c, n] of counts) if (n > bestN) { best = c; bestN = n; }
	return best;
}
