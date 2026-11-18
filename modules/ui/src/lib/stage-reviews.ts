/**
 * THE REVIEWS A LIST'S STAGE CHECKS READ — fetched once per list, never once per cell.
 *
 * ⚠ It has to live in a plain module (the `lib/record-cache.ts` reason): bindings in `<script setup>` run
 * per instance, and a table of 50 rows must cost one request, not 50.
 *
 * Every call made in one microtask joins ONE request per collection — the union of the subjects asked
 * for, as `filter={"subject":{"_in":[…]}}` — and each caller gets the reviews of ITS subjects. Three rules,
 * each a defect the first draft had:
 *
 *   - `limit=100000` (`ALL`, never -1): the adapter slices every list request to 25 rows when none is
 *     given, so a list of requests with more than 25 reviews silently lost checks.
 *   - an empty set issues NO request: the client flattens `_in: []` into no filter at all, which reads the
 *     whole collection.
 *   - a finding's `review` holds the review's REFERENCE (`rnd/reviews/<id>`), so the findings filter is
 *     built from references; the counts come back keyed by the bare id the review rows carry.
 *
 * A failed batch rejects every caller that joined it and caches nothing, so the next render retries.
 * `invalidateStageReviews()` (App.vue, on every `dt:invalidate`) drops both caches and bumps
 * `stageReviewsRevision`, which the View's fetch depends on — a review written in a terminal recolours
 * its check without waiting for the panel to regain focus.
 */
import { ref } from 'vue';
import { api, buildQuery } from '../api/client';
import { ALL } from './page-size';
import { bareRef, type Review } from './stage-checks';

/** Bumped on every invalidation; a View that reads it re-fetches. */
export const stageReviewsRevision = ref(0);

interface Batch<T> {
	keys: Set<string>;
	waiters: Array<{ keys: string[]; resolve: (v: Map<string, T>) => void; reject: (e: unknown) => void }>;
}

/** One batching cache: `load(keys)` answers a map key → value for the union of the keys asked in a tick. */
function batcher<T>(load: (collection: string, keys: string[], extra: string) => Promise<Map<string, T>>, empty: () => T) {
	const cache = new Map<string, Promise<T>>(); // `${collection}\0${extra}\0${key}`
	const pending = new Map<string, Batch<T>>(); // `${collection}\0${extra}`
	function flush(scope: string, collection: string, extra: string): void {
		const batch = pending.get(scope)!;
		pending.delete(scope);
		load(collection, [...batch.keys], extra).then(
			(found) => { for (const w of batch.waiters) w.resolve(found); },
			(err) => {
				for (const k of batch.keys) cache.delete(`${scope}\0${k}`);
				for (const w of batch.waiters) w.reject(err);
			},
		);
	}
	function get(collection: string, keys: string[], extra = ''): Promise<T[]> {
		const scope = `${collection}\0${extra}`;
		const missing = keys.filter((k) => !cache.has(`${scope}\0${k}`));
		if (missing.length) {
			let batch = pending.get(scope);
			if (!batch) {
				batch = { keys: new Set(), waiters: [] };
				pending.set(scope, batch);
				queueMicrotask(() => flush(scope, collection, extra));
			}
			for (const k of missing) batch.keys.add(k);
			const all = new Promise<Map<string, T>>((resolve, reject) => batch!.waiters.push({ keys: missing, resolve, reject }));
			for (const k of missing) cache.set(`${scope}\0${k}`, all.then((m) => m.get(k) ?? empty()));
		}
		return Promise.all(keys.map((k) => cache.get(`${scope}\0${k}`)!));
	}
	return { get, clear: () => cache.clear() };
}

async function listAll(collection: string, filter: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
	const res = await api.get<Array<Record<string, unknown>>>(`/items/${encodeURIComponent(collection)}${buildQuery({ limit: ALL, filter })}`);
	return Array.isArray(res.data) ? res.data : [];
}

const reviews = batcher<Review[]>(async (collection, subjects) => {
	const out = new Map<string, Review[]>();
	for (const r of await listAll(collection, { subject: { _in: subjects } })) {
		const key = bareRef(r['subject']);
		if (!out.has(key)) out.set(key, []);
		out.get(key)!.push({ ...(r as unknown as Review), id: String(r['id'] ?? ''), subject: key });
	}
	return out;
}, () => []);

const findings = batcher<number>(async (collection, ids, reviewsFrom) => {
	const out = new Map<string, number>();
	const prefix = `${reviewsFrom}/`;
	for (const f of await listAll(collection, { review: { _in: ids.map((id) => prefix + id) }, status: { _eq: 'open' } })) {
		const ref = bareRef(f['review']);
		const id = ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
		out.set(id, (out.get(id) ?? 0) + 1);
	}
	return out;
}, () => 0);

/** The reviews whose `subject` is any of `subjects` (bare references), from `reviewsFrom`. */
export async function reviewsFor(reviewsFrom: string, subjects: string[]): Promise<Review[]> {
	const keys = [...new Set(subjects.map(bareRef).filter(Boolean))];
	if (!keys.length) return [];
	return (await reviews.get(reviewsFrom, keys)).flat();
}

/** How many `open` findings each review has, keyed by the review's bare id (absent = none). */
export async function openFindingsFor(findingsFrom: string, reviewsFrom: string, reviewIds: string[]): Promise<Map<string, number>> {
	const ids = [...new Set(reviewIds.map(String).filter(Boolean))];
	if (!ids.length) return new Map();
	const counts = await findings.get(findingsFrom, ids, reviewsFrom);
	return new Map(ids.map((id, i) => [id, counts[i]!] as [string, number]).filter(([, n]) => n > 0));
}

/** Drop both caches and tell every stage-checks View to fetch again. */
export function invalidateStageReviews(): void {
	reviews.clear();
	findings.clear();
	stageReviewsRevision.value++;
}
