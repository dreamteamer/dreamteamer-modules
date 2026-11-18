/**
 * A LIST'S REVIEWS, FETCHED ONCE. Every stage-checks cell asks for the reviews of its row's candidate
 * subjects; the calls one render makes in a tick join ONE request per collection, with `limit=100000`
 * (`ALL` — the adapter slices every list request to 25 rows otherwise), and no request at all for an
 * empty set (an empty `_in` is flattened into no filter, which would read the whole collection). The
 * open findings of the reviews found are one more request, filtered by the review's REFERENCE — a
 * finding's `review` holds `rnd/reviews/<id>`, never the bare id. `dt:invalidate` drops both caches.
 *
 * Over the real adapter and the host stub: the stub answers like the engine — the filter applied, the
 * `limit` honoured.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { onHostRequest, requests, resetHost } from './host-stub';
import { invalidateContract } from '../../src/api/adapter';
import { invalidateStageReviews, openFindingsFor, reviewsFor, stageReviewsRevision } from '../../src/lib/stage-reviews';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };

const row = (collection: string) => ({ collection, title: collection, nav: {}, list: { layout: 'table' }, record: { layout: 'page' }, form: { sections: [] }, record_title: '{{ name }}', record_type: collection, runtime: false, internal: false });

// 30 reviews: more than the adapter's default page, all of them on the three requests' subjects
const REVIEWS = Array.from({ length: 30 }, (_, i) => ({
	id: `2026-03-01--r${String(i).padStart(2, '0')}`,
	name: `review ${i}`,
	kind: 'code',
	subject: `rnd/change-requests/cr-${i % 3}`,
	created: `2026-03-01T${String(10 + (i % 10)).padStart(2, '0')}:00:00+02:00`,
}));
const FINDINGS = [
	{ id: '2026-03-01--r00/a', review: 'rnd/reviews/2026-03-01--r00', status: 'open' },
	{ id: '2026-03-01--r00/b', review: 'rnd/reviews/2026-03-01--r00', status: 'open' },
	{ id: '2026-03-01--r01/a', review: 'rnd/reviews/2026-03-01--r01', status: 'fixed' },
];

type Cond = Record<string, Record<string, unknown>>;
function matches(rec: Record<string, unknown>, filter: Cond): boolean {
	return Object.entries(filter).every(([field, op]) => {
		if ('_in' in op) return (op['_in'] as unknown[]).includes(rec[field]);
		if ('_eq' in op) return rec[field] === op['_eq'];
		throw new Error(`stub: operator ${Object.keys(op)} not modelled`);
	});
}
function answer(all: Array<Record<string, unknown>>, path: string) {
	const params = new URLSearchParams(path.slice(path.indexOf('?') + 1));
	const filter = params.get('filter');
	const limit = Number(params.get('limit') ?? 25);
	const hits = filter ? all.filter((r) => matches(r, JSON.parse(filter) as Cond)) : all;
	return { records: hits.slice(0, limit), total: hits.length };
}

beforeEach(() => {
	resetHost();
	invalidateContract();
	invalidateStageReviews();
	onHostRequest((method, path) => {
		if (path === '/presentation') {
			return {
				collections: [row('rnd/reviews'), row('rnd/review-findings'), row('rnd/change-requests')],
				fields: { 'rnd/reviews': [], 'rnd/review-findings': [], 'rnd/change-requests': [] },
				relations: [
					{ collection: 'rnd/reviews', field: 'subject', related_collection: 'rnd/change-requests', list: false, kind: 'm2o' },
					{ collection: 'rnd/review-findings', field: 'review', related_collection: 'rnd/reviews', list: false, kind: 'm2o' },
				],
			};
		}
		if (path === '/info') return { name: 'scratch' };
		if (path.startsWith('/collections/rnd%2Freviews/records?')) return answer(REVIEWS, path);
		if (path.startsWith('/collections/rnd%2Freview-findings/records?')) return answer(FINDINGS, path);
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

const reviewRequests = () => requests.filter((r) => r.path.startsWith('/collections/rnd%2Freviews/records?'));
const findingRequests = () => requests.filter((r) => r.path.startsWith('/collections/rnd%2Freview-findings/records?'));

test('three rows asking in one tick cost ONE reviews request, limit 100000, and every review comes back', async () => {
	const [a, b, c] = await Promise.all([0, 1, 2].map((i) => reviewsFor('rnd/reviews', [`rnd/change-requests/cr-${i}`])));
	assert.equal(reviewRequests().length, 1);
	assert.match(reviewRequests()[0]!.path, /limit=100000/);
	assert.equal(a!.length + b!.length + c!.length, 30, 'none of the 30 cut at a page of 25');
	assert.ok(a!.every((r) => r.subject === 'rnd/change-requests/cr-0'), 'each row gets its own subjects\' reviews');
	// asked again: served from the cache
	await reviewsFor('rnd/reviews', ['rnd/change-requests/cr-1']);
	assert.equal(reviewRequests().length, 1);
});

test('an empty set issues no request', async () => {
	assert.deepEqual(await reviewsFor('rnd/reviews', []), []);
	assert.deepEqual([...(await openFindingsFor('rnd/review-findings', 'rnd/reviews', []))], []);
	assert.equal(requests.filter((r) => r.path.startsWith('/collections/')).length, 0);
});

test('open findings are filtered by the review REFERENCE and counted per bare review id', async () => {
	const counts = await openFindingsFor('rnd/review-findings', 'rnd/reviews', ['2026-03-01--r00', '2026-03-01--r01', '2026-03-01--r02']);
	assert.equal(findingRequests().length, 1);
	assert.match(decodeURIComponent(findingRequests()[0]!.path), /"rnd\/reviews\/2026-03-01--r00"/);
	assert.match(findingRequests()[0]!.path, /limit=100000/);
	assert.equal(counts.get('2026-03-01--r00'), 2);
	assert.equal(counts.get('2026-03-01--r01') ?? 0, 0, 'a fixed finding is not a remark');
});

test('invalidate drops the caches and bumps the revision: the next call asks the host again', async () => {
	await reviewsFor('rnd/reviews', ['rnd/change-requests/cr-0']);
	const before = stageReviewsRevision.value;
	invalidateStageReviews();
	assert.equal(stageReviewsRevision.value, before + 1);
	await reviewsFor('rnd/reviews', ['rnd/change-requests/cr-0']);
	assert.equal(reviewRequests().length, 2);
});

test('a failed batch rejects every caller of it and is not cached: the next call retries', async () => {
	let fail = true;
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [row('rnd/reviews')], fields: { 'rnd/reviews': [] }, relations: [] };
		if (path === '/info') return { name: 'scratch' };
		if (path.startsWith('/collections/rnd%2Freviews/records?')) {
			if (fail) throw new Error('host down');
			return answer(REVIEWS, path);
		}
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
	const both = await Promise.allSettled([reviewsFor('rnd/reviews', ['rnd/change-requests/cr-0']), reviewsFor('rnd/reviews', ['rnd/change-requests/cr-1'])]);
	assert.deepEqual(both.map((s) => s.status), ['rejected', 'rejected']);
	fail = false;
	assert.equal((await reviewsFor('rnd/reviews', ['rnd/change-requests/cr-0'])).length, 10);
});
