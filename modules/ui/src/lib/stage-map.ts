/**
 * THE STAGE MAP — a record's lifecycle drawn as stages, declared by its COLLECTION, not known here.
 *
 * A collection declares `display.record.options.stages` (a list, in order) and `stage_reviews` (the
 * field holding the record's reviews). Each stage names:
 *
 *   fields   this record's fields that hold the stage's records — drawn EMPTY when they are, because
 *            "no plan yet" is a stage that has not happened, not a stage that does not exist;
 *   reviews  which of the record's reviews belong to the stage — matchers ORed, each matcher's keys
 *            ANDed: `kind` (any of), `subject` (a field of this record whose references hold the
 *            review's subject, or `self`), `before` / `since` (a datetime field of this record,
 *            against the review's `created`);
 *   gate     the command bindings whose states ARE the stage's gate, the work first and its reviews
 *            after — read off the engine's `commandsFor` answer, never re-derived from field values.
 *
 * Pure, so every reading — what a malformed declaration draws, which review lands in which stage,
 * what the gate says — is a unit test. `components/StageMap.vue` only fetches and draws.
 */
import type { CommandRow } from './command-rows';

export interface StageMatcher {
	kind?: string[];
	subject?: string;
	before?: string;
	since?: string;
}

export interface StageSpec {
	title: string;
	fields: string[];
	reviews: StageMatcher[];
	gate: string[];
}

/** A stage's gate, summed up: every binding done, a review waiting, the work ready, or nothing yet. */
export type StageState = 'passed' | 'review' | 'ready' | 'not-started';

export interface GateEntry {
	binding: string;
	name: string;
	state: 'available' | 'done' | 'not-applicable';
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/**
 * The declared stages, or null when the record display declares none. A stage with no title is
 * dropped rather than drawn untitled; every other key degrades to empty — a half-written declaration
 * draws what it can say, and never throws on the record page.
 */
export function stageSpecs(options: Record<string, unknown> | undefined): StageSpec[] | null {
	const raw = options?.['stages'];
	if (!Array.isArray(raw)) return null;
	const out: StageSpec[] = [];
	for (const s of raw) {
		if (!s || typeof s !== 'object') continue;
		const o = s as Record<string, unknown>;
		const title = str(o['title']);
		if (!title) continue;
		const reviews = (Array.isArray(o['reviews']) ? o['reviews'] : [])
			.filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
			.map((m) => {
				const out: StageMatcher = {};
				if (Array.isArray(m['kind'])) out.kind = strings(m['kind']);
				for (const k of ['subject', 'before', 'since'] as const) if (str(m[k])) out[k] = str(m[k]);
				return out;
			});
		out.push({ title, fields: strings(o['fields']), reviews, gate: strings(o['gate']) });
	}
	return out.length ? out : null;
}

/** The field the declaration names as holding the record's reviews (`stage_reviews`), or null. */
export function stageReviewsField(options: Record<string, unknown> | undefined): string | null {
	return str(options?.['stage_reviews']) ?? null;
}

/** A reference in either spelling — the engine's `c/id` or the app's `/c/id` — as the engine's. */
export const bareRef = (v: unknown): string => (typeof v === 'string' ? v.replace(/^\//, '') : '');
const refsOf = (v: unknown): string[] => (Array.isArray(v) ? v : v == null ? [] : [v]).map(bareRef).filter(Boolean);

/** Whether a value is empty the way a stage reads it: absent, blank, or an empty list. */
export function isEmptyValue(v: unknown): boolean {
	return v == null || v === '' || (Array.isArray(v) && v.length === 0);
}

const instant = (v: unknown): number | null => {
	if (typeof v !== 'string' || !v) return null;
	const t = Date.parse(v);
	return Number.isNaN(t) ? null : t;
};

/** Does one review satisfy one matcher, for the record `self` (its `<collection>/<id>`)? */
export function reviewMatches(m: StageMatcher, review: Record<string, unknown>, record: Record<string, unknown>, self: string): boolean {
	if (m.kind && !m.kind.includes(String(review['kind'] ?? ''))) return false;
	if (m.subject) {
		const subject = bareRef(review['subject']);
		const allowed = m.subject === 'self' ? [bareRef(self)] : refsOf(record[m.subject]);
		if (!subject || !allowed.includes(subject)) return false;
	}
	const created = instant(review['created']);
	if (m.since) {
		const at = instant(record[m.since]);
		// nothing to be "since" yet: the stage it marks has not happened, so no review belongs to it
		if (at === null || created === null || created < at) return false;
	}
	if (m.before) {
		const at = instant(record[m.before]);
		if (at !== null && (created === null || created >= at)) return false;
	}
	return true;
}

/** The reviews that belong to a stage, in the order given. A stage with no matchers claims none. */
export function stageReviews(spec: StageSpec, reviews: Record<string, unknown>[], record: Record<string, unknown>, self: string): Record<string, unknown>[] {
	if (!spec.reviews.length) return [];
	return reviews.filter((r) => spec.reviews.some((m) => reviewMatches(m, r, record, self)));
}

/** The stage's gate bindings with their state for this record — a binding the engine did not answer
 *  for is `not-applicable` (a declaration naming a binding this workspace did not compile). */
export function gateEntries(spec: StageSpec, rows: CommandRow[], id: string): GateEntry[] {
	return spec.gate.map((binding) => {
		const row = rows.find((r) => r.binding.replace(/^command-bindings\//, '') === binding);
		const raw = row?.states?.[id];
		const state = raw === 'available' || raw === 'done' ? raw : 'not-applicable';
		return { binding, name: row?.name ?? binding, state };
	});
}

/**
 * The stage's state from its gate. Passed when EVERY binding is done; otherwise the first available
 * binding decides — the work (position 0) reads `ready`, a review after it reads `review`; with nothing
 * available the stage has not started. A stage with no gate has no state to report: not started.
 */
export function stageState(entries: GateEntry[]): StageState {
	if (entries.length && entries.every((e) => e.state === 'done')) return 'passed';
	const at = entries.findIndex((e) => e.state === 'available');
	if (at === 0) return 'ready';
	if (at > 0) return 'review';
	return 'not-started';
}

export const STAGE_STATE_LABEL: Record<StageState, string> = {
	passed: 'passed',
	review: 'awaiting review',
	ready: 'ready',
	'not-started': 'not started',
};
