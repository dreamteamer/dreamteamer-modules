// held-out cr-vscode-019-h3
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, type TestNode } from './render';
import { invalidateContract } from '../../src/api/adapter';
import { invalidateRelations } from '../../src/composables/fields';
import { fieldRow, injected } from '../unit/field-rows';
import { uiViews, type UiViewRecord } from '../../src/ui-views';
import UiPageView from '../../src/pages/UiPageView.vue';
import DataTable from '../../src/components/DataTable.vue';
import { lists, views as cellViews } from '../../src/registry/index';

lists.register({ id: 'table', name: 'Table', component: DataTable, fillsHeight: true });
cellViews.register({ id: 'text', name: 'Text', types: [], component: { props: ['value', 'field', 'options'], render(this: { value: unknown }) { return String(this.value ?? '—'); } } });
// The host's reading of a row's context (dreamteamer-vscode src/session-bind.ts `refsOf`, pinned there by
// session-bind.test.ts and held-out h4/h5), mirrored: this tier proves the CONTEXT each nested list writes.
const refsOf = (arg: unknown, activeRoute: string | undefined): string[] => {
	const row = arg as { dtCollection?: string; dtId?: string; dtIds?: string[]; dtSchemaKind?: string } | undefined;
	if (row && typeof row === 'object' && !row.dtSchemaKind && row.dtCollection) {
		const ids = row.dtIds?.length ? row.dtIds : row.dtId ? [row.dtId] : [];
		return ids.map((id) => `${row.dtCollection}/${id}`);
	}
	if (row && typeof row === 'object' && row.dtSchemaKind) return [];
	const m = /^\/content\/(.+)\/([^/?#]+)(?:[?#].*)?$/.exec(activeRoute ?? '');
	return m ? [`${m[1]}/${decodeURIComponent(m[2]!)}`] : [];
};

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

const col = (c: string, title: string) => ({ collection: c, title, nav: {}, list: { layout: 'table', columns: ['name'] }, record: { layout: 'page' }, form: { sections: [] }, record_title: '{{ name }}', record_type: c, runtime: false, internal: false });
const PRESENTATION = {
	collections: [col('tickets', 'Tickets'), col('widgets', 'Widgets')],
	fields: { tickets: [injected.id(), fieldRow('name', { collection: 'tickets' })], widgets: [injected.id(), fieldRow('name', { collection: 'widgets' })] },
	relations: [],
};
const ROWS: Record<string, Array<Record<string, unknown>>> = {
	tickets: [{ id: 't1', name: 'Printer jam' }, { id: 't2', name: 'VPN drops' }],
	widgets: [{ id: 'w1', name: 'Gear' }, { id: 'w2', name: 'Lever' }],
};
const views: UiViewRecord[] = [
	{ id: 'tickets-table', title: 'Tickets', route: '/tickets/table', scope: 'collection', collection: 'collections/tickets', display: { list: { layout: 'table' } } } as UiViewRecord,
	{ id: 'widgets-table', title: 'Widgets', route: '/widgets/table', scope: 'collection', collection: 'collections/widgets', display: { list: { layout: 'table' } } } as UiViewRecord,
	{ id: 'both', title: 'Both', route: '/both', scope: 'page', display: { list: { layout: 'page', options: { views: ['ui-views/tickets-table', 'ui-views/widgets-table'] } } } } as UiViewRecord,
];

test('a selection across two nested lists binds each record under its own collection', async () => {
	resetHost();
	invalidateContract();
	invalidateRelations();
	uiViews.value = views;
	onHostRequest((method, path) => {
		if (path === '/presentation') return PRESENTATION;
		if (path === '/info') return { name: 'scratch', user: 'someone' };
		const m = /^\/collections\/(tickets|widgets)\/records/.exec(path);
		if (method === 'GET' && m) return { records: ROWS[m[1]!], total: 2 };
		if (method === 'GET' && path.startsWith('/notes/')) return { notes: [] };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/both');
	await r.isReady();
	const root = await render(UiPageView, { viewId: 'both', nested: false }, [r]);
	for (let i = 0; i < 6; i++) await flush();
	const rows = () => all(root, (n) => n.tag === 'tr' && hasClass(n, 'dt-row'));
	const ctx = (n: TestNode) => JSON.parse(String(n.props['data-vscode-context']));
	assert.equal(rows().length, 4, 'two rows in each list');
	const check = async (id: string) => {
		const row = rows().find((n) => ctx(n).dtId === id)!;
		const box = find(row, (n) => n.tag === 'input' && hasClass(n, 'dt-checkbox'))!;
		(box.props['onChange'] as () => void)();
		await flush(); await flush();
	};
	await check('t1');
	await check('w1');
	const exists = new Set(['tickets/t1', 'tickets/t2', 'widgets/w1', 'widgets/w2']);
	for (const id of ['t1', 'w1']) {
		const c = ctx(rows().find((n) => ctx(n).dtId === id)!);
		const refs = refsOf(c, undefined);
		console.log(`h3 right-click ${id}: context ${JSON.stringify(c)} → refs ${JSON.stringify(refs)}`);
		assert.ok(refs.length > 0);
		for (const ref of refs) assert.ok(exists.has(ref), `${ref} names an existing record of its own collection`);
		assert.ok(refs.every((x) => x.startsWith(`${c.dtCollection}/`)));
	}
});
