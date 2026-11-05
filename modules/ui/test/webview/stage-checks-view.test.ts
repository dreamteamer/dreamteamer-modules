/**
 * THE STAGE CHECKS, DRAWN. A tags field whose `viewer` is `stage-checks` draws one slot per declared
 * stage, in declared order: empty when the stage is not tagged, one check (`codicon-check`) when it is,
 * two (`codicon-check-all`) when a review of the stage exists — green (`is-approved`) when it approves
 * with no open finding, orange (`is-remarks`) when it left remarks, neutral while it has no verdict — and
 * the hover (`title`, also the accessible name) carries the review's description. Free tags follow as
 * chips. Rendered, because "the cell draws what the pure function answered" is a rendering: a View that
 * computed the right state and drew the wrong glyph would pass every unit test.
 *
 * And the ROW reaches the View: RenderView hands `record` only to a View that declares it, and the table,
 * the cards and a display template pass it — without the row a stage cannot find its reviews.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { computed, ref, type Ref } from 'vue';
import { onHostRequest, requests, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, unmountAll, type TestNode } from './render';
import { invalidateContract } from '../../webview/src/api/adapter';
import type { FieldRow, ItemRecord } from '../../webview/src/api/types';
import { fieldRow } from '../unit/field-rows';
import { invalidateStageReviews } from '../../webview/src/lib/stage-reviews';
import { readFileSync } from 'node:fs';
import { views } from '../../webview/src/registry/index';
import ViewTags from '../../webview/src/views/ViewTags.vue';
import ViewText from '../../webview/src/views/ViewText.vue';
import ViewStageChecks from '../../webview/src/views/ViewStageChecks.vue';
import RenderView from '../../webview/src/components/render/RenderView.vue';
import DataTable from '../../webview/src/components/DataTable.vue';
import ListCards from '../../webview/src/lists/ListCards.vue';
import DisplayTemplate from '../../webview/src/components/render/DisplayTemplate.vue';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };

// Registered directly, not through `register-defaults` (it reaches ListMap and leaflet's png CSS); the
// last test pins that `register-defaults` registers the same id.
views.register({ id: 'text', name: 'Text', types: [], component: ViewText });
views.register({ id: 'tags', name: 'Tags', types: [], component: ViewTags });
views.register({ id: 'stage-checks', name: 'Stage checks', types: [], component: ViewStageChecks });

const OPTIONS = {
	reviews_from: 'rnd/reviews',
	findings_from: 'rnd/review-findings',
	stages: [
		{ tag: 'designed', title: 'Designed', reviews: [{ kind: ['design'], subject: 'design_docs', since: 'created' }, { kind: ['acceptance'], subject: 'self', before: 'deployed_on' }] },
		{ tag: 'implemented', title: 'Implemented', reviews: [{ kind: ['code', 'security'], subject: 'implementation_plans' }, { kind: ['code', 'security'], subject: 'self' }] },
		{ tag: 'tested', title: 'Tested', reviews: [{ kind: ['test'], subject: 'self' }, { kind: ['test'], subject: 'implementation_plans' }] },
		{ tag: 'deployed', title: 'Deployed', reviews: [{ kind: ['acceptance'], subject: 'self', since: 'deployed_on' }] },
	],
};
const TAGS: FieldRow = fieldRow('tags', { collection: 'rnd/change-requests', many: true, viewer: 'stage-checks', viewer_options: OPTIONS } as Partial<FieldRow>);
const NAME: FieldRow = fieldRow('name', { collection: 'rnd/change-requests' } as Partial<FieldRow>);

// cr-1: designed (approved), implemented (changes requested), tested (no review), not deployed, a free tag
// cr-2: designed (approve with an open finding), implemented (no verdict yet)
const RECORDS: ItemRecord[] = [
	{ id: 'cr-1', name: 'Portal deadline', created: '2026-03-01T09:00:00+02:00', tags: ['designed', 'implemented', 'tested', 'client:northwind'], design_docs: ['/rnd/design-docs/d1'], implementation_plans: ['/rnd/implementation-plans/p1'] },
	{ id: 'cr-2', name: 'Roster export', created: '2026-03-01T09:00:00+02:00', tags: ['designed', 'implemented'], design_docs: ['/rnd/design-docs/d2'], implementation_plans: [] },
];
const REVIEWS = [
	{ id: 'r-d1', name: 'd1 design review', description: 'design holds; two minors accepted', kind: 'design', subject: 'rnd/design-docs/d1', verdict: 'approve', round: 2, created: '2026-03-02T10:00:00+02:00' },
	{ id: 'r-p1', name: 'p1 branch review', description: 'two majors on the cache', kind: 'code', subject: 'rnd/implementation-plans/p1', verdict: 'changes-requested', round: 1, created: '2026-03-05T10:00:00+02:00' },
	{ id: 'r-d2', name: 'd2 design review', description: 'approved with one finding open', kind: 'design', subject: 'rnd/design-docs/d2', verdict: 'approve', round: 1, created: '2026-03-02T10:00:00+02:00' },
	{ id: 'r-cr2', name: 'cr-2 code review', kind: 'code', subject: 'rnd/change-requests/cr-2', created: '2026-03-06T10:00:00+02:00' },
];
const FINDINGS = [{ id: 'r-d2/f', review: 'rnd/reviews/r-d2', status: 'open' }];

type Cond = Record<string, Record<string, unknown>>;
const matches = (rec: Record<string, unknown>, f: Cond) => Object.entries(f).every(([k, op]) => ('_in' in op ? (op['_in'] as unknown[]).includes(rec[k]) : rec[k] === op['_eq']));
function answer(rows: Array<Record<string, unknown>>, path: string) {
	const p = new URLSearchParams(path.slice(path.indexOf('?') + 1));
	const hits = rows.filter((r) => matches(r, JSON.parse(p.get('filter') ?? '{}') as Cond));
	return { records: hits.slice(0, Number(p.get('limit') ?? 25)), total: hits.length };
}
const row = (collection: string) => ({ collection, title: collection, nav: {}, list: { layout: 'table' }, record: { layout: 'page' }, form: { sections: [] }, record_title: '{{ name }}', record_type: collection, runtime: false, internal: false });

beforeEach(() => {
	unmountAll(); // a View still mounted from the last test would re-fetch on the invalidate below
	resetHost();
	invalidateContract();
	invalidateStageReviews();
	onHostRequest((method, path) => {
		if (path === '/presentation') {
			return {
				collections: [row('rnd/change-requests'), row('rnd/reviews'), row('rnd/review-findings')],
				fields: { 'rnd/change-requests': [NAME, TAGS], 'rnd/reviews': [], 'rnd/review-findings': [] },
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

const slots = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-stage-check'));
const glyph = (slot: TestNode) => {
	const icon = find(slot, (n) => hasClass(n, 'codicon'));
	return icon ? String(icon.props['class']).split(/\s+/).find((c) => c.startsWith('codicon-'))!.slice('codicon-'.length) : null;
};
async function settle() { for (let i = 0; i < 6; i++) await flush(); }
const describeSlot = (s: TestNode) => [s.props['data-stage'], s.props['data-state'], glyph(s), hasClass(s, 'is-approved') ? 'green' : hasClass(s, 'is-remarks') ? 'orange' : 'neutral'];

test('one slot per stage in declared order: empty · one check · two green · two orange · two neutral', async () => {
	const one = await render(ViewStageChecks, { value: RECORDS[0]!['tags'], field: TAGS, options: OPTIONS, record: RECORDS[0] });
	await settle();
	assert.deepEqual(slots(one).map(describeSlot), [
		['designed', 'approved', 'check-all', 'green'],
		['implemented', 'remarks', 'check-all', 'orange'],
		['tested', 'done', 'check', 'neutral'],
		['deployed', 'none', null, 'neutral'],
	]);
	const [designed, implemented, tested, deployed] = slots(one);
	assert.equal(designed!.props['title'], 'Designed — reviewed, approve (round 2): design holds; two minors accepted');
	assert.equal(designed!.props['aria-label'], designed!.props['title']);
	assert.equal(designed!.props['role'], 'img');
	assert.equal(implemented!.props['title'], 'Implemented — reviewed, changes-requested (round 1): two majors on the cache');
	assert.equal(tested!.props['title'], 'Tested — no review yet');
	assert.equal(deployed!.props['title'], undefined, 'an unreached stage says nothing');
	assert.deepEqual(all(one, (n) => hasClass(n, 'dt-chip')).map((c) => text(c)), ['client:northwind'], 'free tags follow as chips');

	const two = await render(ViewStageChecks, { value: RECORDS[1]!['tags'], field: TAGS, options: OPTIONS, record: RECORDS[1] });
	await settle();
	assert.deepEqual(slots(two).map(describeSlot).slice(0, 2), [
		['designed', 'remarks', 'check-all', 'orange'],
		['implemented', 'pending', 'check-all', 'neutral'],
	]);
	assert.match(String(slots(two)[0]!.props['title']), /1 open finding: approved with one finding open$/);
});

test('both cells asked in one tick: one reviews request and one findings request', async () => {
	await Promise.all(RECORDS.map((r) => render(ViewStageChecks, { value: r['tags'], field: TAGS, options: OPTIONS, record: r })));
	await settle();
	assert.equal(requests.filter((r) => r.path.startsWith('/collections/rnd%2Freviews/records?')).length, 1);
	assert.equal(requests.filter((r) => r.path.startsWith('/collections/rnd%2Freview-findings/records?')).length, 1);
});

test('without the row: tag-only checks, a hover that says why, and no request', async () => {
	const root = await render(ViewStageChecks, { value: ['designed'], field: TAGS, options: OPTIONS });
	await settle();
	assert.deepEqual(slots(root).map(describeSlot)[0], ['designed', 'done', 'check', 'neutral']);
	assert.equal(slots(root)[0]!.props['title'], 'Designed — tagged (reviews are not read here)');
	assert.equal(requests.filter((r) => r.path.startsWith('/collections/')).length, 0);
});

test('RenderView hands the row to a View that declares it, and to no other', async () => {
	const withRow = await render(RenderView, { field: TAGS, value: RECORDS[0]!['tags'], record: RECORDS[0] });
	await settle();
	assert.equal(slots(withRow)[0]!.props['data-state'], 'approved');
	const plain = await render(RenderView, { field: fieldRow('labels', { many: true }), value: ['a'], record: RECORDS[0] });
	assert.equal(find(plain, (n) => 'record' in n.props), null, 'ViewTags gets no stray record attribute');
});

/** What DataTable and ListCards reach for (the table-columns-tint fixture's shape). */
function fakeState(records: ItemRecord[]) {
	const fields = ref([NAME, TAGS]) as unknown as Ref<FieldRow[]>;
	return {
		collection: 'rnd/change-requests',
		columns: ref([NAME, TAGS]) as unknown as Ref<FieldRow[]>,
		fields: { visibleFields: fields, fields },
		items: { items: ref(records) as Ref<ItemRecord[]>, loading: ref(false), reload: async () => {}, setSort: () => {} },
		listOptions: ref({ table: {}, cards: {} }) as Ref<Record<string, Record<string, unknown>>>,
		imageField: computed(() => null),
		subtitleFields: computed(() => [TAGS]),
		selectedIds: computed(() => [] as string[]),
		allVisibleSelected: computed(() => false),
		hasActiveQuery: computed(() => false),
		sortIndicator: () => null,
		pkOf: (r: ItemRecord) => String(r['id'] ?? ''),
		recordTitleOf: (r: ItemRecord) => String(r['name'] ?? r['id']),
		tintOf: () => undefined,
		isSelected: () => false,
		toggleSelect: () => {},
		toggleSelectAllVisible: () => {},
		openRecord: () => {},
		createRecord: () => {},
	};
}

test('the table draws the checks in the tags column, each row its own', async () => {
	const root = await render(DataTable, { state: fakeState(RECORDS) });
	await settle();
	const rows = all(root, (n) => n.tag === 'tr' && hasClass(n, 'dt-row'));
	assert.deepEqual(rows.map((r) => slots(r).map((s) => s.props['data-state'])), [
		['approved', 'remarks', 'done', 'none'],
		['remarks', 'pending', 'none', 'none'],
	]);
});

test('a card and a display template draw them the same', async () => {
	const cards = await render(ListCards, { state: fakeState(RECORDS) });
	await settle();
	const each = all(cards, (n) => hasClass(n, 'dt-cards-card'));
	assert.deepEqual(each.map((c) => slots(c).map((s) => s.props['data-state'])), [
		['approved', 'remarks', 'done', 'none'],
		['remarks', 'pending', 'none', 'none'],
	]);
	const tpl = await render(DisplayTemplate, { template: '{{ tags }}', record: RECORDS[0], fields: [NAME, TAGS] });
	await settle();
	assert.deepEqual(slots(tpl).map((s) => s.props['data-state']), ['approved', 'remarks', 'done', 'none']);
});

test('register-defaults registers the View under the id a descriptor names', () => {
	const src = readFileSync(new URL('../../webview/src/registry/register-defaults.ts', `file://${process.cwd()}/test/webview/`), 'utf8');
	assert.match(src, /views\.register\(\{ id: 'stage-checks', name: 'Stage checks', component: ViewStageChecks, types: \[\] \}\)/);
});
