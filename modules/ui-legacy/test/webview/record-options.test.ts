/**
 * A COLLECTION's `display.record.options` reaches its record page — the render tier.
 *
 * Engine 0.33.0 carries the collection's record options on its display-contract row
 * (`record.options`). Until then the per-field `relation_views` override could only be authored on a
 * `scope: record` view. This mounts the record page's real renderer (`ItemProperties`) with the
 * options the page resolves through `useRecordDisplay` — over the real adapter, the real collections
 * overview and the real ui-view store — and asserts what DRAWS:
 *
 *   1. `relation_views.parts: parts-heavy` on the COLLECTION draws that view's columns;
 *   2. a `scope: record` view's own `relation_views.parts: false` wins over the collection's;
 *   3. a collection whose record block carries no options draws the target's own display.
 *
 * `ContentDetail` is the production caller and cannot mount here (reka-ui); it asks the same
 * composable. Every fixture is invented: `widgets` holding `parts`, and made-up views.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { createRouter, createMemoryHistory } from 'vue-router';
import { defineComponent, h, ref } from 'vue';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, type TestNode } from './render';
import { invalidateContract } from '../../src/api/adapter';
import { invalidateRelations } from '../../src/composables/fields';
import { refreshCollections } from '../../src/composables/collections';
import { useRecordDisplay } from '../../src/composables/record-display';
import type { FieldRow } from '../../src/api/types';
import { fieldRow, mirrorRow } from '../unit/field-rows';
import { lists, views } from '../../src/registry/index';
import { uiViews, type UiViewRecord } from '../../src/ui-views';
import DataTable from '../../src/components/DataTable.vue';
import ItemProperties from '../../src/components/ItemProperties.vue';

lists.register({ id: 'table', name: 'Table', component: DataTable });
views.register({
	id: 'text',
	name: 'Text',
	types: [],
	component: { props: ['value'], render(this: { value: unknown }) { return String(this.value ?? ''); } },
});
// The links a relation row falls back to — a marker, so the fallback is assertable by class.
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

// DataTable and BrowseView listen on window/document; this tier has no DOM.
(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

// ---- synthetic workspace -----------------------------------------------------------------------

const PARTS_FIELDS: FieldRow[] = ['code', 'name', 'kind', 'weight'].map((n) => fieldRow(n, { collection: 'parts' }));
const PARTS = [
	{ id: 'p-00', code: 'P-00', name: 'Bracket', kind: 'metal', weight: '2' },
	{ id: 'p-01', code: 'P-01', name: 'Grommet', kind: 'rubber', weight: '1' },
	{ id: 'p-02', code: 'P-02', name: 'Flange', kind: 'metal', weight: '5' },
];

const row = (collection: string, title: string, list: Record<string, unknown>, record: Record<string, unknown>) => ({
	collection,
	title,
	nav: {},
	list: { layout: 'table', ...list },
	record: { layout: 'page', ...record },
	form: { sections: [] },
	record_title: '{{ name }}',
	record_type: collection,
	runtime: false,
	internal: false,
});

/** The widgets row's `record` block, per test — what the engine projects from `display.record`. */
let widgetsRecord: Record<string, unknown> = {};

const HEAVY: UiViewRecord = {
	id: 'parts-heavy',
	route: '/parts/heavy',
	scope: 'collection',
	collection: 'collections/parts',
	display: { list: { columns: ['name', 'weight'], sort: 'name' } },
	compiled: { display: { list: { layout: 'table', columns: ['name', 'weight'], sort: 'name' } } },
};
const SHEET: UiViewRecord = {
	id: 'widget-sheet',
	route: '/widgets/sheet',
	scope: 'record',
	collection: 'collections/widgets',
	display: { record: { options: { relation_views: { parts: false } } } },
	compiled: { display: { record: { layout: 'page', options: { relation_views: { parts: false } } } } },
};

beforeEach(async () => {
	resetHost();
	invalidateContract();
	invalidateRelations();
	uiViews.value = [HEAVY, SHEET];
	onHostRequest((method, path) => {
		if (path === '/presentation') {
			return {
				collections: [row('parts', 'Parts', { columns: ['code', 'name', 'kind'], sort: 'code' }, {}), row('widgets', 'Widgets', {}, widgetsRecord)],
				fields: { parts: PARTS_FIELDS, widgets: [] },
				relations: [{ collection: 'widgets', field: 'parts', related_collection: 'parts', list: true, mirror: true as const }],
			};
		}
		if (path === '/info') return { name: 'scratch', user: 'someone' };
		if (path.startsWith('/collections/parts/records?')) {
			const params = new URLSearchParams(path.slice(path.indexOf('?') + 1));
			const wanted = new Set((JSON.parse(params.get('filter') ?? '{"id":{"_in":[]}}') as { id: { _in: string[] } }).id._in);
			return { records: PARTS.filter((r) => wanted.has(r.id)), total: wanted.size };
		}
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

/** The record page's renderer, handed the options the page resolves — what ContentDetail does. */
async function draw(record: Record<string, unknown>, viewId?: string): Promise<TestNode> {
	widgetsRecord = record;
	// the collections overview is a module-level cache: re-read it off this test's payload
	await refreshCollections();
	const item = { record: ref({ id: 'w-01', parts: ['/parts/p-02', '/parts/p-00'] }), edits: ref({}), setField() {} };
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/content/widgets/w-01');
	await r.isReady();
	const Page = defineComponent({
		setup() {
			const display = useRecordDisplay(() => 'widgets', () => viewId);
			return () =>
				h(ItemProperties, {
					fields: [{ ...mirrorRow('parts', 'widget'), collection: 'widgets' }],
					item,
					readonly: true,
					relationTargets: new Map([['parts', 'parts']]),
					options: display.value.options ?? {},
				});
		},
	});
	const root = await render(Page, {}, [r]);
	for (let i = 0; i < 30; i++) await flush();
	return root;
}

const headerLabels = (root: TestNode) =>
	all(root, (n) => n.tag === 'th' && !hasClass(n, 'dt-table__checkbox-col')).map((n) => text(n).trim());
const linkRows = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-links')).map((n) => text(n));

test('a COLLECTION\'s `display.record.options.relation_views` names the view the relation draws', async () => {
	const root = await draw({ options: { relation_views: { parts: 'parts-heavy' } } });
	assert.deepEqual(headerLabels(root), ['Name', 'Weight'], 'the named view\'s columns, not the target\'s own');
	assert.deepEqual(linkRows(root), []);
});

test('a `scope: record` view\'s own options win over the collection\'s', async () => {
	const root = await draw({ options: { relation_views: { parts: 'parts-heavy' } } }, 'widget-sheet');
	assert.equal(find(root, (n) => n.tag === 'table'), null, 'the view opted the field back out');
	assert.deepEqual(linkRows(root), ['/parts/p-02, /parts/p-00']);
});

test('with no record options the relation draws the target collection\'s own display', async () => {
	const root = await draw({});
	assert.deepEqual(headerLabels(root), ['Code', 'Name', 'Kind']);
});
