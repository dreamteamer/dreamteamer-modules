/**
 * A relation field on a record page RENDERS the target collection's view — the thing tier 1 cannot
 * see, and the thing the operator actually asked for.
 *
 * Tier 1 (`test/unit/relation-embedded-view.test.ts`) pins the rule; a rule that computes a perfect
 * plan and draws a comma-separated list of links anyway would pass every one of those tests. So this
 * one mounts the REAL RECORD PAGE (`ItemProperties`) over the real adapter and asserts:
 *
 *   1. a real `<table>` with the VIEW's columns and one row per related record;
 *   2. the request the host actually saw — scoped by `{id:{_in:[…]}}`, sorted the view's way;
 *   3. that everything else keeps exactly the links it has always had — and, since a live defect
 *      already came out of this, that the full-width GEOMETRY follows the embed rather than the
 *      mere candidacy.
 *
 * ⚠ `ItemProperties` and not `RelationField`, deliberately. The first cut decided "can this embed?"
 * on the row and "did it?" in the component, and for a target collection with no view those differ:
 * the dev host showed a `teams` row stacked to full width around a plain list of links.
 *
 * Every fixture is invented here: two made-up collections (`widgets` holding `parts`) and made-up
 * view records. Nothing is copied or adapted from any workspace.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { createRouter, createMemoryHistory } from 'vue-router';
import { h, ref } from 'vue';
import { onHostRequest, requests, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, type TestNode } from './render';
import { buildQuery } from '../../src/api/client';
import { invalidateContract } from '../../src/api/adapter';
import { invalidateRelations } from '../../src/composables/fields';
import type { FieldRow } from '../../src/api/types';
import { fieldRow, mirrorRow, referenceRow } from '../unit/field-rows';
import { lists, views } from '../../src/registry/index';
import { uiViews, type UiViewRecord } from '../../src/ui-views';
import DataTable from '../../src/components/DataTable.vue';
import ItemProperties from '../../src/components/ItemProperties.vue';

// The built-in `table` List, through the real registry — the point of this tier is that the REAL
// table renders, with the real column resolution, not a stand-in.
lists.register({ id: 'table', name: 'Table', component: DataTable });
views.register({
	id: 'text',
	name: 'Text',
	types: [],
	component: { props: ['value'], render(this: { value: unknown }) { return String(this.value ?? ''); } },
});
// The links a relation row falls back to — `ViewRelation` in production, a marker here so the
// fallback is assertable by class rather than by guessing at its markup.
views.register({
	id: 'relation',
	name: 'Relation',
	types: [],
	component: {
		props: ['value'],
		render(this: { value: unknown }) {
			return h('span', { class: 'dt-links' }, (Array.isArray(this.value) ? this.value : [this.value]).join(', '));
		},
	},
});

// DataTable listens for window focus and BrowseView listens on `document` for the click-outside that
// closes its filter popover; this tier has no DOM. Listener sinks are enough — nothing here fires an
// event, and the popover is not what is under test.
(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

// ---- synthetic workspace -----------------------------------------------------------------------

/** A field row of the display contract, as `presentation.js#fieldRow` emits it. */
const field = (name: string): FieldRow => fieldRow(name, { collection: 'parts' });

const PARTS_FIELDS = [field('code'), field('name'), field('kind'), field('weight')];

/** Three parts in the collection; the widget names two of them, out of id order. */
const PARTS = [
	{ id: 'p-00', code: 'P-00', name: 'Bracket', kind: 'metal', weight: '2' },
	{ id: 'p-01', code: 'P-01', name: 'Grommet', kind: 'rubber', weight: '1' },
	{ id: 'p-02', code: 'P-02', name: 'Flange', kind: 'metal', weight: '5' },
];

/** A collection row of the display contract (descriptor v2, §4.3). */
const collectionRow = (collection: string, title: string, columns?: string[], sort?: string) => ({
	collection,
	title,
	nav: {},
	list: { layout: 'table', ...(columns ? { columns } : {}), ...(sort ? { sort } : {}) },
	record: { layout: 'page' },
	form: { sections: [] },
	record_title: '{{ name }}',
	record_type: collection,
	runtime: false,
	internal: false,
});

const PRESENTATION = {
	// The parts collection's OWN display is its default view (descriptor v2): what a relation to it
	// draws when no named view is asked for.
	collections: [collectionRow('parts', 'Parts', ['code', 'name', 'kind'], 'code'), collectionRow('widgets', 'Widgets')],
	fields: { parts: PARTS_FIELDS, widgets: [] },
	relations: [
		{ collection: 'widgets', field: 'parts', related_collection: 'parts', list: true, mirror: true as const },
		{ collection: 'widgets', field: 'lead_part', related_collection: 'parts', list: false },
	],
};

/** The generated mirror — a LIST relation, which is the case the ask was about. */
const partsRelation: FieldRow = { ...mirrorRow('parts', 'widget'), collection: 'widgets' };

/** A SINGLE reference — a link, never a table. */
const leadPartRelation: FieldRow = referenceRow('lead_part', false, { collection: 'widgets' });

/** The host, answering the way the engine does — including APPLYING the `_in` scope. */
function stubHost(): void {
	onHostRequest((method, path) => {
		if (path === '/presentation') return PRESENTATION;
		if (path === '/info') return { name: 'scratch', user: 'someone' };
		if (path.startsWith('/collections/parts/records?')) {
			const params = new URLSearchParams(path.slice(path.indexOf('?') + 1));
			let rows = [...PARTS];
			const raw = params.get('filter');
			if (raw) {
				const wanted = new Set((JSON.parse(raw) as { id: { _in: string[] } }).id._in);
				rows = rows.filter((r) => wanted.has(r.id));
			}
			const sort = params.get('sort') ?? '';
			if (sort) rows.sort((a, b) => String(a[sort as 'code'] ?? '').localeCompare(String(b[sort as 'code'] ?? '')));
			return { records: rows, total: rows.length };
		}
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
}

beforeEach(() => {
	resetHost();
	// Both caches are module-level and would otherwise carry one test's workspace into the next.
	invalidateContract();
	invalidateRelations();
	uiViews.value = [];
	stubHost();
});

function router() {
	return createRouter({
		history: createMemoryHistory(),
		routes: [{ path: '/:path(.*)*', component: { render: () => null } }],
	});
}

/** Mount the real record page over a synthetic widget. */
async function draw(opts: { value?: unknown; fields?: FieldRow[]; options?: Record<string, unknown> } = {}): Promise<TestNode> {
	const record = {
		id: 'w-01',
		parts: opts.value === undefined ? ['/parts/p-02', '/parts/p-00'] : opts.value,
		lead_part: '/parts/p-00',
	};
	const item = { record: ref(record), edits: ref({}), setField() {} };
	const r = router();
	await r.push('/content/widgets/w-01');
	await r.isReady();
	const root = await render(
		{
			render: () =>
				h(ItemProperties, {
					fields: opts.fields ?? [partsRelation],
					item,
					readonly: true,
					relationTargets: new Map([
						['parts', 'parts'],
						['lead_part', 'parts'],
					]),
					options: opts.options,
				}),
		},
		{},
		[r],
	);
	// The browse boots through three real round-trips before it settles — an unparameterized first
	// read, one once the base filter lands, one more once the view's columns and sort resolve — and
	// each hop costs several ticks through the client, the adapter and the transport stub. Under-
	// flushing here reads the "Loading…" row as the component's answer.
	for (let i = 0; i < 30; i++) await flush();
	return root;
}

const headerLabels = (root: TestNode) =>
	all(root, (n) => n.tag === 'th' && !hasClass(n, 'dt-table__checkbox-col')).map((n) => text(n).trim());
const bodyRows = (root: TestNode) => all(root, (n) => n.tag === 'tr' && n.parent?.tag === 'tbody');
const linkRows = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-links')).map((n) => text(n));
/** Rows the page stacked to full width — geometry that must follow the embed, never the candidacy. */
const stackedRows = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-prop--stacked'));
const recordsRequests = () => requests.filter((r) => r.path.startsWith('/collections/parts/records?'));

// ---- 1. it draws the view, not the links --------------------------------------------------------

test('a list relation draws the TARGET COLLECTION’S TABLE — its columns, its sort, its rows', async () => {
	const root = await draw();

	assert.ok(find(root, (n) => n.tag === 'table'), 'a real table, not a row of links');
	assert.deepEqual(linkRows(root), [], 'and no links fallback beside it');
	assert.deepEqual(headerLabels(root), ['Code', 'Name', 'Kind'], "the collection's own display.list columns, in its order — not the heuristic");

	const rows = bodyRows(root);
	assert.equal(rows.length, 2, 'exactly the two related parts, out of three in the collection');
	assert.match(text(rows[0]!), /Bracket/, "sorted the collection's way (`sort: code`), not in the relation's own order");
	assert.match(text(rows[1]!), /Flange/);
	assert.doesNotMatch(text(root), /Grommet/, 'the unrelated record never appears');
});

test('the embedded browse is a VALUE, not a page: no header, no filter chip, but its pager stays', async () => {
	const root = await draw();
	assert.equal(find(root, (n) => hasClass(n, 'dt-page-header')), null, 'a second page title inside a property row');
	assert.equal(find(root, (n) => hasClass(n, 'dt-chip')), null, 'the relation scope is the row’s SUBJECT, not an editable rule');
	assert.ok(find(root, (n) => hasClass(n, 'dt-browse-footer')), 'paging is one of the "all settings" that had to come along');
	assert.match(text(find(root, (n) => hasClass(n, 'dt-browse-count'))!), /1–2 of 2/);
});

// ---- 2. the request the host actually saw -------------------------------------------------------

test('the scope reaches the host as `{id:{_in:[…]}}`, with the collection’s sort', async () => {
	await draw();

	const last = recordsRequests().at(-1);
	assert.ok(last, 'the embedded view queried the target collection');
	const params = new URLSearchParams(last.path.slice(last.path.indexOf('?') + 1));
	// The relation arrives UNEXPANDED (bare `<collection>/<id>` strings), so re-querying the
	// collection scoped is the ONLY way to draw it — there is no resolved record set to render.
	assert.deepEqual(JSON.parse(params.get('filter') ?? 'null'), { id: { _in: ['p-02', 'p-00'] } });
	assert.equal(params.get('sort'), 'code');
});

test('AN EMPTY `_in` VANISHES FROM THE QUERY STRING — which is why an empty relation never embeds', async () => {
	// The claim the guard rests on, RUN rather than asserted in prose: `buildQuery` flattens a filter
	// by iterating its arrays, so an empty one emits NO params, the adapter then sees no filter at
	// all, and the browse would render every record in the target collection under a field that names
	// none of them.
	assert.equal(buildQuery({ filter: { id: { _in: [] } } }), '', 'no filter param survives');
	assert.notEqual(buildQuery({ filter: { id: { _in: ['p-00'] } } }), '');

	const root = await draw({ value: [] });
	assert.equal(find(root, (n) => n.tag === 'table'), null, 'no table');
	assert.equal(recordsRequests().length, 0, 'and no unscoped query was ever issued');
});

// ---- 3. what falls back to links ----------------------------------------------------------------

test('a workspace with no named view still embeds — every collection has its own display', async () => {
	const root = await draw();
	assert.ok(find(root, (n) => n.tag === 'table'));
	assert.deepEqual(linkRows(root), []);
});

test('⚠ A ROW THAT FELL BACK TO LINKS DOES NOT GET THE TABLE’S GEOMETRY', async () => {
	// The live defect this file exists to keep out: `teams` on a real record page was stacked to full
	// width — label on its own line, value below — around a plain list of links, because the row
	// asked "could this embed?" while the component asked "did it?".
	assert.equal(stackedRows(await draw({ options: { relation_views: { parts: false } } })).length, 0, 'opted out, so nothing stacks');
	assert.equal(stackedRows(await draw()).length, 1, 'and the row that DID embed does stack');
});

test('a SINGLE reference keeps its link even though the target has a display', async () => {
	const root = await draw({ fields: [leadPartRelation] });
	assert.deepEqual(linkRows(root), ['/parts/p-00']);
	assert.equal(find(root, (n) => n.tag === 'table'), null, 'a table drawn for one record is worse than the link');
	assert.equal(stackedRows(root).length, 0);
});

test('both kinds on one page: the list embeds, the single one does not', async () => {
	const root = await draw({ fields: [partsRelation, leadPartRelation] });
	assert.deepEqual(headerLabels(root), ['Code', 'Name', 'Kind']);
	assert.deepEqual(linkRows(root), ['/parts/p-00'], 'exactly one row still draws links');
	assert.equal(stackedRows(root).length, 1);
});

// ---- 4. the per-field override ------------------------------------------------------------------

test('`relation_views.<field>: false` opts one field back out', async () => {
	const root = await draw({ options: { relation_views: { parts: false } } });
	assert.deepEqual(linkRows(root), ['/parts/p-02, /parts/p-00']);
	assert.equal(find(root, (n) => n.tag === 'table'), null);
	assert.equal(stackedRows(root).length, 0);
});

test('a named override draws that view instead — different columns, same scope', async () => {
	const heavy: UiViewRecord = {
		id: 'parts-heavy',
		route: '/parts/heavy',
		scope: 'collection',
		collection: 'collections/parts',
		display: { list: { columns: ['name', 'weight'], sort: 'name' } },
		compiled: { display: { list: { layout: 'table', columns: ['name', 'weight'], sort: 'name' } } },
	};
	uiViews.value = [heavy];
	const root = await draw({ options: { relation_views: { parts: 'parts-heavy' } } });
	assert.deepEqual(headerLabels(root), ['Name', 'Weight']);
	assert.equal(bodyRows(root).length, 2, 'still scoped to the relation, not the collection');
});
