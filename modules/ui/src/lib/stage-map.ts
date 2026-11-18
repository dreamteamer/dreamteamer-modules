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
	if (at < 0) return 'not-started';
	// a review is open only when work before it is DONE; an available binding after only
	// not-applicable ones is the stage's work (deploy waiting on /rnd:release — cr-vscode-015)
	return entries.slice(0, at).some((e) => e.state === 'done') ? 'review' : 'ready';
}

/**
 * The current stage (cr-vscode-015): the stage holding the FIRST available binding in declared order —
 * the one `dt next` names. With nothing available anywhere: the stage after the last passed one, or −1
 * when the last passed stage is the last stage, or nothing passed. rnd's gates skip on real records
 * (a review never recorded), so "the first stage not passed" is NOT this reading.
 */
export function currentStage(gates: GateEntry[][]): number {
	const at = gates.findIndex((entries) => entries.some((e) => e.state === 'available'));
	if (at >= 0) return at;
	let last = -1;
	gates.forEach((entries, i) => { if (stageState(entries) === 'passed') last = i; });
	return last >= 0 && last < gates.length - 1 ? last + 1 : -1;
}

export type StageMark = 'passed' | 'current' | 'skipped' | 'ahead';

/** How a stage is drawn: its own gate passed wins; the current one; one before it (or any, when none is
 *  current) that did not pass was passed over; the rest are not reached yet. */
export function stageMark(i: number, current: number, state: StageState): StageMark {
	if (state === 'passed') return 'passed';
	if (i === current) return 'current';
	if (current < 0 || i < current) return 'skipped';
	return 'ahead';
}

/** The card's left offset inside the map: under its chip, clamped so the card never leaves the map. */
export function cardLeft(chipLeft: number, cardWidth: number, mapWidth: number): number {
	return Math.max(0, Math.min(chipLeft, mapWidth - cardWidth));
}

/**
 * Which stage's card is open (cr-vscode-015, design D9 + round 3): the most recent intent decides.
 * `kbd` is the stage whose item holds KEYBOARD focus (a :focus-visible focus); only that holds a card
 * against the pointer, and only while focus is inside the card. The 200 ms grace timer is the caller's.
 */
export interface CardState { open: number | null; hovered: number | null; kbd: number | null; dismissed: number | null }
export type CardEvent =
	| { type: 'enter'; i: number; cardHasFocus: boolean }
	| { type: 'leave'; i: number }
	| { type: 'grace'; cardHasFocus: boolean }
	| { type: 'focus'; i: number; keyboard: boolean; inCard: boolean }
	| { type: 'blur'; i: number }
	| { type: 'escape'; i: number };
export const CARD_CLOSED: CardState = Object.freeze({ open: null, hovered: null, kbd: null, dismissed: null });

export function cardState(s: CardState, e: CardEvent): CardState {
	const held = (cardHasFocus: boolean) => cardHasFocus && s.kbd !== null && s.kbd === s.open;
	switch (e.type) {
		case 'enter':
			return { ...s, hovered: e.i, dismissed: null, open: held(e.cardHasFocus) ? s.open : e.i };
		case 'leave':
			return { ...s, hovered: s.hovered === e.i ? null : s.hovered };
		case 'grace':
			return held(e.cardHasFocus) ? s : { ...s, open: s.kbd };
		case 'focus':
			if (s.dismissed === e.i) return s;
			if (e.keyboard) return { ...s, kbd: e.i, open: e.i };
			return s.kbd === e.i ? { ...s, kbd: null } : s;
		case 'blur':
			return {
				...s,
				kbd: s.kbd === e.i ? null : s.kbd,
				dismissed: s.dismissed === e.i ? null : s.dismissed,
				open: s.open === e.i && s.hovered !== e.i ? null : s.open,
			};
		case 'escape':
			return { ...s, open: null, kbd: null, dismissed: e.i };
	}
}

export const STAGE_STATE_LABEL: Record<StageState, string> = {
	passed: 'passed',
	review: 'awaiting review',
	ready: 'ready',
	'not-started': 'not started',
};
