/**
 * A PAGE VIEW RENDERS ITS CHILDREN — the render tier's half of nested ui-views (tier 1,
 * `test/unit/page-view.test.ts`, pins the resolution). Mounted over the real adapter, the real embedded
 * browse and the real `counts` and activity components, against a host stub that answers the way the
 * extension host does (it APPLIES the filter it is sent):
 *
 *   1. `counts` draws one number per value of `group_by`, equal to the rows of that value, each a link
 *      to the view's list filtered to it, and no pager under it;
 *   2. a two-column page — the activity feed beside a nested page of counts — draws two grid columns,
 *      the feed's entries and the counts; a reference to no view and a cycle each draw a refusal in
 *      their own panel, by id, and the siblings still draw;
 *   3. a layer scope reaches EVERY request: the counts' filter carries `$source is <layer>`, the feed
 *      asks `/activity?…&source=<layer>`, and the links out carry the scope;
 *   4. the module page draws the module's page view when one names it, and the Activity alone when
 *      none does.
 *
 * Every fixture is invented here: a Northwind support desk with tickets, and a layer `project-a`.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, requests, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, type TestNode } from './render';
import { invalidateContract } from '../../src/api/adapter';
import { invalidateRelations } from '../../src/composables/fields';
import { enumRow, fieldRow, injected } from '../unit/field-rows';
import { lists } from '../../src/registry/index';
import { uiViews, type UiViewRecord } from '../../src/ui-views';
import ListCounts from '../../src/lists/ListCounts.vue';
import UiPageView from '../../src/pages/UiPageView.vue';
import ModulePage from '../../src/pages/ModulePage.vue';

// The registration the app makes (register-defaults.ts) — repeated, because that module mounts every
// built-in component and this tier has no DOM for some of them. Tier 1 pins the real registration.
lists.register({ id: 'counts', name: 'Counts', component: ListCounts, summarizes: true });

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

// ---- synthetic workspace -----------------------------------------------------------------------

const OWN = 'northwind-desk';
const LAYER = 'project-a';

const TICKETS = [
	{ id: 't1', name: 'Printer jam', status: 'open', $source: OWN },
	{ id: 't2', name: 'VPN drops', status: 'open', $source: OWN },
	{ id: 't3', name: 'New laptop', status: 'waiting', $source: OWN },
	{ id: 't4', name: 'Password reset', status: 'closed', $source: OWN },
	{ id: 't5', name: 'Badge reader', status: 'closed', $source: OWN },
	{ id: 't6', name: 'Harbor Mutual login', status: 'open', $source: LAYER },
	{ id: 't7', name: 'Sam Diaz monitor', status: 'closed', $source: LAYER },
];

const collectionRow = {
	collection: 'tickets',
	title: 'Tickets',
	nav: {},
	list: { layout: 'table', columns: ['name', 'status'] },
	record: { layout: 'page' },
	form: { sections: [] },
	record_title: '{{ name }}',
	record_type: 'tickets',
	runtime: false,
	internal: false,
};
const PRESENTATION = {
	collections: [collectionRow],
	fields: {
		tickets: [
			injected.id(),
			fieldRow('name', { collection: 'tickets' }),
			enumRow('status', [{ value: 'open', label: 'Open', color: 'charts.blue' }, { value: 'waiting', label: 'Waiting' }, { value: 'closed', label: 'Closed' }], { collection: 'tickets' }),
		],
	},
	relations: [],
};

/** The engine's filter, as much of it as this fixture sends: `_and`, and `_eq` on a scalar. */
function matches(row: Record<string, unknown>, filter: unknown): boolean {
	if (!filter || typeof filter !== 'object') return true;
	return Object.entries(filter as Record<string, unknown>).every(([k, cond]) => {
		if (k === '_and') return (cond as unknown[]).every((c) => matches(row, c));
		const c = cond as Record<string, unknown>;
		if ('_eq' in c) return row[k] === c['_eq'];
		throw new Error(`the stub does not speak ${JSON.stringify(cond)}`);
	});
}

const ENTRY = { sha: 'abc1234def', repo: '.', source: OWN, author: 'Dana Oren', date: '2026-10-03T10:00:00+00:00', subject: 'tickets: triage the morning queue', records: [], files: 1 };

function stubHost(): void {
	onHostRequest((method, path) => {
		if (path === '/presentation') return PRESENTATION;
		if (path === '/info') return { name: 'scratch', user: 'someone' };
		if (method === 'GET' && path.startsWith('/collections/tickets/records')) {
			const params = new URLSearchParams(path.split('?')[1] ?? '');
			const raw = params.get('filter');
			const rows = TICKETS.filter((r) => matches(r, raw ? JSON.parse(raw) : undefined));
			return { records: rows, total: rows.length };
		}
		if (method === 'GET' && path.startsWith('/collections/modules/records')) {
			return { records: [{ id: 'helpdesk', name: '@acme/helpdesk', title: 'Help desk' }], total: 1 };
		}
		if (method === 'GET' && path.startsWith('/activity')) {
			return { module: 'helpdesk', scopes: [{ repo: '.', paths: ['data/tickets'] }], entries: [ENTRY], offset: 0, hasMore: false };
		}
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
}

// ---- the views -------------------------------------------------------------------------------

const countsView: UiViewRecord = {
	id: 'tickets-by-status',
	title: 'Tickets by status',
	route: '/tickets/by-status',
	scope: 'collection',
	collection: 'collections/tickets',
	display: { list: { layout: 'counts', options: { group_by: 'status' } } },
};
const activityView: UiViewRecord = {
	id: 'helpdesk-activity',
	title: 'Activity',
	route: '/modules/helpdesk/activity',
	scope: 'page',
	display: { list: { layout: 'activity', options: { module: 'helpdesk' } } },
};
const column: UiViewRecord = {
	id: 'helpdesk-counts',
	route: '/modules/helpdesk/counts',
	scope: 'page',
	display: { list: { layout: 'page', options: { views: ['ui-views/tickets-by-status', 'ui-views/nowhere', 'ui-views/helpdesk'] } } },
};
const deskPage: UiViewRecord = {
	id: 'helpdesk',
	title: 'Help desk',
	route: '/modules/helpdesk',
	scope: 'page',
	display: { list: { layout: 'page', options: { module: 'helpdesk', grid_columns: 2, views: ['ui-views/helpdesk-activity', 'ui-views/helpdesk-counts'] } } },
};

async function router() {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/settings/schema/activity');
	await r.isReady();
	return r;
}

async function settle(): Promise<void> {
	for (let i = 0; i < 6; i++) await flush();
}

beforeEach(() => {
	resetHost();
	invalidateContract();
	invalidateRelations();
	uiViews.value = [countsView, activityView, column, deskPage];
	stubHost();
});

const countsOf = (root: TestNode) =>
	Object.fromEntries(all(root, (n) => hasClass(n, 'dt-counts__item')).map((n) => [String(n.props['data-value']), text(find(n, (m) => hasClass(m, 'dt-counts__num'))!).trim()]));
const linkOf = (n: TestNode) => String(find(n, (m) => m.tag === 'a')?.props['href'] ?? n.props['href'] ?? '');
const filterOf = (href: string) => JSON.parse(new URLSearchParams(href.split('?')[1]).get('filter')!);
const recordRequests = () => requests.filter((r) => r.path.startsWith('/collections/tickets/records'));

test('counts: one number per status, equal to its rows, each a link to the view filtered to it — and no pager', async () => {
	const root = await render(UiPageView, { viewId: 'helpdesk-counts', nested: false }, [await router()]);
	await settle();
	assert.deepEqual(countsOf(root), { open: '3', waiting: '1', closed: '3' }, 'every row of the collection, banded by status in the enum\'s order');
	const total = find(root, (n) => hasClass(n, 'dt-counts__total'))!;
	assert.match(text(total), /7\s*total/);
	const open = find(root, (n) => hasClass(n, 'dt-counts__item') && n.props['data-value'] === 'open')!;
	const href = linkOf(open);
	assert.ok(href.startsWith('/content/tickets?filter='), `the records behind the number, not the counts again: ${href}`);
	assert.deepEqual(filterOf(href).rules, [{ field: 'status', operator: '_eq', value: 'open' }]);
	assert.equal(find(root, (n) => hasClass(n, 'dt-browse-footer')), null, 'a summary has no page to turn');
	// the browse's first, unparameterised reload is superseded by its sequence guard (composables/items.ts);
	// the LAST request is the one whose answer is drawn
	assert.match(recordRequests().at(-1)!.path, /limit=100000/, 'a grouped list asks for every row');
});

test('a two-column page: the activity beside a nested page of counts; a missing child and a cycle refused in their panels, by id', async () => {
	const root = await render(UiPageView, { viewId: 'helpdesk' }, [await router()]);
	await settle();
	const grid = find(root, (n) => hasClass(n, 'dt-page-view__grid') && n.props['data-columns'] === 2)!;
	assert.ok(grid, 'the outer grid has two columns');
	assert.equal(grid.children.filter((c) => typeof c !== 'string' && (hasClass(c, 'dt-panel') || hasClass(c, 'dt-page-view__cell'))).length, 2, 'two cells: the activity panel and the nested page');

	const activityPanel = find(root, (n) => hasClass(n, 'dt-panel') && n.props['data-kind'] === 'activity')!;
	assert.match(text(activityPanel), /Activity/);
	assert.match(text(activityPanel), /tickets: triage the morning queue/, 'the module page\'s own feed, in the panel');
	assert.match(String(requests.find((r) => r.path.startsWith('/activity'))?.path), /module=helpdesk/);

	assert.deepEqual(countsOf(root), { open: '3', waiting: '1', closed: '3' });
	const refused = all(root, (n) => hasClass(n, 'dt-panel') && n.props['data-kind'] === 'refused');
	assert.deepEqual(refused.map((n) => String(n.props['data-ref'])), ['ui-views/nowhere', 'ui-views/helpdesk']);
	assert.match(text(refused[0]!), /ui-view 'nowhere' does not exist/);
	assert.match(text(refused[1]!), /helpdesk → helpdesk-counts → helpdesk/, 'the cycle, named by its chain');
	assert.match(text(root), /Help desk/, 'the page\'s own title heads it');
});

test('a layer scope reaches every request and every link: $source on the counts, source= on the feed', async () => {
	const root = await render(UiPageView, { viewId: 'helpdesk', source: LAYER }, [await router()]);
	await settle();
	assert.deepEqual(countsOf(root), { open: '1', closed: '1' }, 'only the layer\'s tickets — and a value it has none of draws no number');
	// the request whose answer is drawn (the browse's first, unparameterised reload is superseded)
	const drawn = recordRequests().at(-1)!;
	assert.deepEqual(JSON.parse(new URLSearchParams(drawn.path.split('?')[1]).get('filter')!), { $source: { _eq: LAYER } }, drawn.path);
	assert.match(String(requests.find((r) => r.path.startsWith('/activity'))?.path), /source=project-a/);
	const open = find(root, (n) => hasClass(n, 'dt-counts__item') && n.props['data-value'] === 'open')!;
	assert.deepEqual(filterOf(linkOf(open)).rules, [
		{ field: 'status', operator: '_eq', value: 'open' },
		{ field: '$source', operator: '_eq', value: LAYER },
	]);
	const title = find(root, (n) => hasClass(n, 'dt-panel__title') && text(n).includes('Tickets by status'))!;
	assert.deepEqual(filterOf(linkOf(title)).rules, [{ field: '$source', operator: '_eq', value: LAYER }], 'the panel title opens the full list, still scoped');
	assert.match(text(root), /Records from/);
});

test('the module page draws the module\'s page view when one names it, and the Activity alone when none does', async () => {
	const withPage = await render(ModulePage, { module: 'helpdesk', moduleTitle: 'Help desk' }, [await router()]);
	await settle();
	assert.ok(find(withPage, (n) => hasClass(n, 'dt-page-view__grid')), 'the page view');
	assert.deepEqual(countsOf(withPage), { open: '3', waiting: '1', closed: '3' });

	resetHost();
	stubHost();
	const without = await render(ModulePage, { module: 'billing', moduleTitle: 'Billing' }, [await router()]);
	await settle();
	assert.equal(find(without, (n) => hasClass(n, 'dt-page-view__grid')), null, 'no page view names billing');
	assert.ok(find(without, (n) => hasClass(n, 'dt-activity__title')), 'the Activity page, with its own heading');
	assert.match(String(requests.find((r) => r.path.startsWith('/activity'))?.path), /module=billing/);
});

// ---- review round 1 ---------------------------------------------------------------------------

test('a workspace page for a package module beats the shipped one, whatever its id, and names itself', async () => {
	const shipped: UiViewRecord = { ...deskPage, $module: 'helpdesk', '$source-kind': 'module' };
	const own: UiViewRecord = { ...deskPage, id: 'zz-desk', title: 'Our desk', route: '/our/desk', $module: 'default', '$source-kind': 'own', display: { list: { layout: 'page', options: { module: 'helpdesk', views: ['ui-views/tickets-by-status'] } } } };
	uiViews.value = [countsView, activityView, column, shipped, own];
	const root = await render(ModulePage, { module: 'helpdesk', moduleTitle: 'Help desk' }, [await router()]);
	await settle();
	assert.match(text(root), /Our desk/, 'the workspace\'s page is drawn, though "zz-desk" sorts after "helpdesk"');
	assert.equal(text(find(root, (n) => hasClass(n, 'dt-page-view__origin'))!).trim(), 'ui-view zz-desk · from default', 'and says which view it is');
});

test('a counts view whose filter is an any-of leaves its numbers UNLINKED and says why — never a link that redraws the counts', async () => {
	const either: UiViewRecord = { ...countsView, id: 'open-or-waiting', route: '/tickets/open-or-waiting', filter: { _or: [{ status: { _eq: 'open' } }, { status: { _eq: 'waiting' } }] } };
	uiViews.value = [either, { ...column, id: 'only', display: { list: { layout: 'page', options: { views: ['ui-views/open-or-waiting'] } } } }];
	onHostRequest((method, path) => {
		if (path === '/presentation') return PRESENTATION;
		if (path === '/info') return { name: 'scratch', user: 'someone' };
		if (path.startsWith('/collections/tickets/records')) {
			const rows = TICKETS.filter((r) => r.status === 'open' || r.status === 'waiting');
			return { records: rows, total: rows.length };
		}
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
	const root = await render(UiPageView, { viewId: 'only' }, [await router()]);
	await settle();
	assert.deepEqual(countsOf(root), { open: '3', waiting: '1' });
	const open = find(root, (n) => hasClass(n, 'dt-counts__item') && n.props['data-value'] === 'open')!;
	assert.equal(open.tag, 'span', 'not a link');
	assert.equal(find(open, (m) => m.tag === 'a'), null);
	assert.match(String(open.props['title']), /cannot be carried to the list/);
	assert.equal(find(root, (n) => hasClass(n, 'dt-counts__total'))!.tag, 'span', 'nor the total');
});

test('an activity view opened on its own route heads with the MODULE\'s title, not the view\'s', async () => {
	const root = await render(UiPageView, { viewId: 'helpdesk-activity' }, [await router()]);
	await settle();
	assert.match(text(find(root, (n) => hasClass(n, 'dt-activity__lead'))!), /Commits to Help desk, newest first/);
});
