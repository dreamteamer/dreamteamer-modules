/**
 * THE STAGE CHECKS — a many-valued tags field drawn as one check per declared stage, the way a chat app
 * marks a message: nothing while the stage is not tagged, one check once it is, two once a review of the
 * stage exists — green when the latest such review approves with no open finding, orange when it left
 * remarks (changes requested, rejected, or a finding still `open`), neutral while it has no verdict — and
 * the review's description on hover.
 *
 * The COLLECTION declares it, on the field: `display.viewer: stage-checks` and `display.options` (the
 * engine hands those over as the field row's `viewer_options`):
 *
 *   reviews_from    the collection reviews live in (each has kind, subject, verdict, round, created,
 *                   description, name); absent — the stages draw tag-only
 *   findings_from   the collection a review's findings live in (each has `review` and `status`)
 *   stages          in order, each `{ tag, title?, reviews: matcher[] }` — a matcher is cr-rnd-001's
 *                   stage-map vocabulary: `kind` (any of), `subject` (a field of the record holding the
 *                   review's subject, or `self`), `since` / `before` (a datetime field of the record
 *                   against the review's `created`). Matchers OR; a matcher's keys AND.
 *
 * Pure, so every reading — which review is a stage's, what colour, what the hover says, what a
 * malformed declaration draws — is a unit test. `views/ViewStageChecks.vue` only fetches and draws.
 */

export interface StageMatcher {
	kind?: string[];
	subject?: string;
	since?: string;
	before?: string;
}

export interface StageCheckSpec {
	tag: string;
	title: string;
	reviews: StageMatcher[];
}

export interface StageChecksSpec {
	reviewsFrom: string | null;
	findingsFrom: string | null;
	stages: StageCheckSpec[];
}

/** A review row as the list API returns it — only the keys the checks read. */
export interface Review {
	id: string;
	kind?: string;
	subject?: string | null;
	verdict?: string | null;
	round?: number | null;
	created?: string | null;
	description?: string | null;
	name?: string | null;
}

/** none: not tagged · done: tagged, no review · pending: reviewed, no verdict · approved · remarks */
export type StageState = 'none' | 'done' | 'pending' | 'approved' | 'remarks';

export interface StageCheck {
	stage: StageCheckSpec;
	state: StageState;
	review: Review | null;
	/** the hover and the accessible name: what the check says, in words */
	label: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []);

/** The declared stages, or null when the field declares none. A stage with no tag is dropped; every other
 *  key degrades to empty — a half-written declaration draws what it can say, and never throws in a cell. */
export function stageChecksSpec(options: Record<string, unknown> | undefined | null): StageChecksSpec | null {
	const raw = options?.['stages'];
	if (!Array.isArray(raw)) return null;
	const stages: StageCheckSpec[] = [];
	for (const s of raw) {
		if (!s || typeof s !== 'object') continue;
		const o = s as Record<string, unknown>;
		const tag = str(o['tag']);
		if (!tag) continue;
		const reviews = (Array.isArray(o['reviews']) ? o['reviews'] : [])
			.filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
			.map((m) => {
				const out: StageMatcher = {};
				if (Array.isArray(m['kind'])) out.kind = strings(m['kind']);
				for (const k of ['subject', 'since', 'before'] as const) if (str(m[k])) out[k] = str(m[k]);
				return out;
			});
		stages.push({ tag, title: str(o['title']) ?? tag, reviews });
	}
	if (!stages.length) return null;
	return { reviewsFrom: str(options?.['reviews_from']) ?? null, findingsFrom: str(options?.['findings_from']) ?? null, stages };
}

/** A reference in either spelling — the engine's `c/id` or the app's `/c/id` — as the engine's. */
export const bareRef = (v: unknown): string => (typeof v === 'string' ? v.replace(/^\//, '') : '');
const refsOf = (v: unknown): string[] => (Array.isArray(v) ? v : v == null ? [] : [v]).map(bareRef).filter(Boolean);

const instant = (v: unknown): number | null => {
	if (typeof v !== 'string' || !v) return null;
	const t = Date.parse(v);
	return Number.isNaN(t) ? null : t;
};

/** Does one review satisfy one matcher, for the record `self` (its `<collection>/<id>`)? An empty `since`
 *  field matches nothing (the stage it dates has not happened); an empty `before` field restricts nothing. */
export function reviewMatches(m: StageMatcher, review: Review, record: Record<string, unknown>, self: string): boolean {
	if (m.kind && !m.kind.includes(String(review.kind ?? ''))) return false;
	if (m.subject) {
		const subject = bareRef(review.subject);
		const allowed = m.subject === 'self' ? [bareRef(self)] : refsOf(record[m.subject]);
		if (!subject || !allowed.includes(subject)) return false;
	}
	const created = instant(review.created);
	if (m.since) {
		const at = instant(record[m.since]);
		if (at === null || created === null || created < at) return false;
	}
	if (m.before) {
		const at = instant(record[m.before]);
		if (at !== null && (created === null || created >= at)) return false;
	}
	return true;
}

/** Every reference a stage could find a review's subject in — `self` and each `subject` field's values —
 *  deduped, in declaration order: the set one batched request asks for. */
export function candidateSubjects(spec: StageChecksSpec, record: Record<string, unknown>, self: string): string[] {
	const out: string[] = [];
	for (const s of spec.stages) for (const m of s.reviews) {
		if (!m.subject) continue;
		for (const r of m.subject === 'self' ? [bareRef(self)] : refsOf(record[m.subject])) if (!out.includes(r)) out.push(r);
	}
	return out;
}

/** The review written LAST — by `created` as an instant; `round` breaks only an exact tie, then the id.
 *  Rounds restart (a request retested opens a new round 1) and some reviews carry none, so the highest
 *  round is not the current verdict. */
export function latestReview(reviews: Review[]): Review | null {
	let best: Review | null = null;
	for (const r of reviews) {
		if (!best) { best = r; continue; }
		const a = instant(r.created) ?? -Infinity;
		const b = instant(best.created) ?? -Infinity;
		if (a !== b) { if (a > b) best = r; continue; }
		const ra = r.round ?? 0, rb = best.round ?? 0;
		if (ra !== rb) { if (ra > rb) best = r; continue; }
		if (String(r.id) > String(best.id)) best = r;
	}
	return best;
}

/**
 * One stage's check for one record. `record`/`self` null means the surface did not hand the row over —
 * the reviews cannot be placed, so a tagged stage draws one check and says why. `openFindings` counts
 * each review's `open` findings, keyed by the review's bare id.
 */
export function stageCheck(
	stage: StageCheckSpec,
	tags: unknown,
	record: Record<string, unknown> | null,
	self: string | null,
	reviews: Review[],
	openFindings: Map<string, number>,
): StageCheck {
	const tagged = Array.isArray(tags) && tags.includes(stage.tag);
	if (!tagged) return { stage, state: 'none', review: null, label: '' };
	if (!record || !self) return { stage, state: 'done', review: null, label: `${stage.title} — tagged (reviews are not read here)` };
	const mine = stage.reviews.length ? reviews.filter((r) => stage.reviews.some((m) => reviewMatches(m, r, record, self))) : [];
	const review = latestReview(mine);
	if (!review) return { stage, state: 'done', review: null, label: `${stage.title} — no review yet` };
	const open = openFindings.get(bareRef(review.id)) ?? 0;
	const verdict = str(review.verdict);
	const state: StageState = verdict === 'changes-requested' || verdict === 'reject' || open > 0 ? 'remarks' : verdict === 'approve' ? 'approved' : 'pending';
	const summary = str(review.description) ?? str(review.name) ?? bareRef(review.id);
	const how = verdict ? `${verdict} (round ${review.round ?? 1})` : 'no verdict yet';
	const findings = open > 0 ? `, ${open} open finding${open === 1 ? '' : 's'}` : '';
	return { stage, state, review, label: `${stage.title} — reviewed, ${how}${findings}: ${summary}` };
}

/** The tags that are not a declared stage — drawn as chips after the checks. A look-alike is a chip. */
export function freeTags(tags: unknown, spec: StageChecksSpec): string[] {
	const stages = new Set(spec.stages.map((s) => s.tag));
	return (Array.isArray(tags) ? tags : []).map((t) => (t != null && typeof t === 'object' ? JSON.stringify(t) : String(t))).filter((t) => !stages.has(t));
}
