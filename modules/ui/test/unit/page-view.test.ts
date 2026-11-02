// Tier 1 — what a PAGE view draws (cr: nested ui-views). A page ui-view nests other ui-views by
// reference (`display.list.options.views`); each child keeps its own collection, filter and layout.
// The engine passes the list through unchanged — `display` is a free map and layouts are the
// surface's — so everything that can be wrong with a child (a reference to nothing, a cycle, a shape
// that is not a reference) is refused HERE, at render, in that child's panel, by its id.
//
// Synthetic views only: a Northwind support desk with tickets and a page over them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countLink, gridColumns, modulePageView, pageOrigin, pagePanels, panelLink, scopedFilter, type PanelPlan } from '../../src/lib/page-view';
import type { UiViewRecord } from '../../src/ui-views';

const page = (id: string, options: Record<string, unknown>, route = `/${id}`): UiViewRecord => ({
	id,
	route,
	scope: 'page',
	display: { list: { layout: 'page', options } },
	compiled: { display: { list: { layout: 'page', options } } },
});
const counts = (id: string, collection = 'tickets'): UiViewRecord => ({
	id,
	route: `/${collection}/by-status`,
	scope: 'collection',
	collection: `collections/${collection}`,
	display: { list: { layout: 'counts', options: { group_by: 'status' } } },
});
const activity = (id: string, module = 'helpdesk'): UiViewRecord => ({
	id,
	route: `/modules/${module}/activity`,
	scope: 'page',
	display: { list: { layout: 'activity', options: { module } } },
});
const record = (id: string): UiViewRecord => ({ id, route: '/tickets/one', scope: 'record', collection: 'collections/tickets' });

const kinds = (plans: PanelPlan[]) => plans.map((p) => [p.kind, p.ref]);

test('a child is named by ui-views/<id>, by its bare id, or by its route — each resolves to the same view', () => {
	const child = counts('tickets-by-status');
	const views = [child, page('desk', { views: ['ui-views/tickets-by-status', 'tickets-by-status', '/tickets/by-status'] })];
	const plans = pagePanels(views[1]!, views);
	assert.deepEqual(kinds(plans), [['view', 'ui-views/tickets-by-status'], ['view', 'tickets-by-status'], ['view', '/tickets/by-status']]);
	assert.ok(plans.every((p) => p.kind === 'view' && p.view.id === 'tickets-by-status'));
});

test('each child draws by its own kind: a collection view, a nested page, an activity feed', () => {
	const views = [counts('tickets-by-status'), activity('desk-activity'), page('desk-counts', { views: ['ui-views/tickets-by-status'] }), page('desk', { views: ['ui-views/desk-activity', 'ui-views/desk-counts'] })];
	const plans = pagePanels(views[3]!, views);
	assert.deepEqual(kinds(plans), [['activity', 'ui-views/desk-activity'], ['page', 'ui-views/desk-counts']]);
	assert.equal(plans[0]!.kind === 'activity' && plans[0]!.module, 'helpdesk', 'the module the feed is for');
});

test('a reference to no view is refused in its panel, by the reference', () => {
	const views = [page('desk', { views: ['ui-views/nowhere'] })];
	const [plan] = pagePanels(views[0]!, views);
	assert.equal(plan?.kind, 'refused');
	assert.match(plan!.kind === 'refused' ? plan!.reason : '', /ui-view 'nowhere' does not exist/);
});

test('a page that names itself, or a cycle through another page, is refused naming the chain', () => {
	const self = page('desk', { views: ['ui-views/desk'] });
	const [own] = pagePanels(self, [self]);
	assert.equal(own?.kind, 'refused');
	assert.match(own!.kind === 'refused' ? own!.reason : '', /desk → desk/);

	// a → b → a: drawing a, b is a nested page; drawing b INSIDE a, its child a is the cycle
	const a = page('a', { views: ['ui-views/b'] });
	const b = page('b', { views: ['ui-views/a', 'ui-views/tickets-by-status'] });
	const views = [a, b, counts('tickets-by-status')];
	assert.deepEqual(kinds(pagePanels(a, views)), [['page', 'ui-views/b']]);
	const inner = pagePanels(b, views, ['a']);
	assert.equal(inner[0]?.kind, 'refused');
	assert.match(inner[0]!.kind === 'refused' ? inner[0]!.reason : '', /a → b → a/);
	assert.equal(inner[1]?.kind, 'view', 'the cycle refuses ITS panel, not its siblings');
});

test('what is not a list of references is refused, never dropped silently', () => {
	assert.deepEqual(pagePanels(page('desk', {}), []), [], 'no views: an empty page, not an error');
	const notList = pagePanels(page('desk', { views: 'ui-views/tickets-by-status' }), []);
	assert.equal(notList.length, 1);
	assert.match(notList[0]!.kind === 'refused' ? notList[0]!.reason : '', /options\.views is a list/);
	const [num] = pagePanels(page('desk', { views: [7] }), []);
	assert.match(num!.kind === 'refused' ? num!.reason : '', /entry 1 is not a ui-view reference/);
});

test('a record view has no record on a page, and a page of an app layout cannot be drawn in a panel', () => {
	const app: UiViewRecord = { id: 'portal', route: '/portal', scope: 'page', display: { list: { layout: 'northwind-portal' } } };
	const views = [record('one-ticket'), app, page('desk', { views: ['ui-views/one-ticket', 'ui-views/portal'] })];
	const [rec, pg] = pagePanels(views[2]!, views);
	assert.match(rec!.kind === 'refused' ? rec!.reason : '', /record view/);
	assert.match(pg!.kind === 'refused' ? pg!.reason : '', /northwind-portal/);
});

test('the grid is one column unless the page asks for two', () => {
	assert.equal(gridColumns(page('p', {})), 1);
	assert.equal(gridColumns(page('p', { grid_columns: 2 })), 2);
	assert.equal(gridColumns(page('p', { grid_columns: '2' })), 2, 'a quoted number from the CLI');
	assert.equal(gridColumns(page('p', { grid_columns: 5 })), 1, 'one or two, nothing else');
});

test('a module\'s page is the PAGE view whose options.module names it — the lowest id when two do', () => {
	const views = [activity('helpdesk-activity'), page('z-desk', { module: 'helpdesk' }), page('a-desk', { module: 'helpdesk' }), page('other', { module: 'billing' })];
	assert.equal(modulePageView(views, 'helpdesk')?.id, 'a-desk');
	assert.equal(modulePageView(views, 'billing')?.id, 'other');
	assert.equal(modulePageView(views, 'nobody'), undefined, 'none — the module page falls back to Activity alone');
	assert.equal(modulePageView([activity('helpdesk-activity')], 'helpdesk'), undefined, 'an activity view is not a page');
});

test('a layer scope narrows a child\'s own filter by $source, and leaves an unscoped one alone', () => {
	assert.equal(scopedFilter(undefined, undefined), undefined);
	assert.deepEqual(scopedFilter({ tags: { _eq: 'urgent' } }, undefined), { tags: { _eq: 'urgent' } });
	assert.deepEqual(scopedFilter(undefined, 'project-a'), { $source: { _eq: 'project-a' } });
	assert.deepEqual(scopedFilter({ tags: { _eq: 'urgent' } }, 'project-a'), { _and: [{ tags: { _eq: 'urgent' } }, { $source: { _eq: 'project-a' } }] });
});

test('a panel links to its full view, carrying the scope: a filter rule for a list, ?source= for a page', () => {
	const rule = (url: string) => JSON.parse(new URLSearchParams(url.split('?')[1]).get('filter')!);
	assert.equal(panelLink(counts('t'), undefined), '/tickets/by-status');
	assert.deepEqual(rule(panelLink(counts('t'), 'project-a')), { logic: '_and', rules: [{ field: '$source', operator: '_eq', value: 'project-a' }] });
	assert.equal(panelLink(activity('a'), 'project-a'), '/modules/helpdesk/activity?source=project-a');
});

test('a count links to the RECORDS behind it: the collection\'s list, the view\'s filter, the value, the scope', () => {
	const rule = (url: string) => JSON.parse(new URLSearchParams(url.split('?')[1]).get('filter')!);
	const open = countLink(counts('t'), 'status', 'open', undefined);
	assert.ok(open.startsWith('/content/tickets?filter='), `not the counts view again: ${open}`);
	assert.deepEqual(rule(open), { logic: '_and', rules: [{ field: 'status', operator: '_eq', value: 'open' }] });
	assert.deepEqual(rule(countLink(counts('t'), 'status', null, 'project-a')).rules, [
		{ field: 'status', operator: '_null', value: '' },
		{ field: '$source', operator: '_eq', value: 'project-a' },
	]);
	const urgent = { ...counts('u'), filter: { tags: { _eq: 'urgent' } } };
	assert.deepEqual(rule(countLink(urgent, 'status', 'open', undefined)).rules, [
		{ field: 'tags', operator: '_eq', value: 'urgent' },
		{ field: 'status', operator: '_eq', value: 'open' },
	], 'the view\'s own filter is carried, first');
	assert.deepEqual(rule(countLink(urgent, undefined, null, undefined)).rules, [{ field: 'tags', operator: '_eq', value: 'urgent' }], 'the total: the view\'s rows');
	// review 2026-10-31: an _or the flat builder cannot join used to fall back to the counts view's own
	// route — the click redrew the counts. Now the count is unlinked, never the counts again.
	const either = { ...counts('e'), filter: { _or: [{ status: { _eq: 'open' } }, { status: { _eq: 'confirmed' } }] } };
	assert.equal(countLink(either, 'status', 'open', undefined), null, 'an any-of filter: unlinked');
	assert.equal(countLink(either, undefined, null, 'project-a'), null, 'and its total');
	const nested = { ...counts('n'), filter: { _and: [{ _or: [{ status: { _eq: 'open' } }, { tags: { _eq: 'urgent' } }] }, { tags: { _eq: 'vip' } }] } };
	assert.equal(countLink(nested, 'status', 'open', undefined), null, 'a nested group: unlinked');
});

test('a module\'s page: the workspace\'s own page view wins over a package\'s, whatever its id — and says which it is', () => {
	const shipped = { ...page('modules-rnd', { module: 'rnd' }), $module: 'rnd', '$source-kind': 'module' };
	const own = { ...page('rnd-dashboard', { module: 'rnd' }), $module: 'default', '$source-kind': 'own' };
	const layer = { ...page('a-layer-page', { module: 'rnd' }), $module: 'project-a', '$source-kind': 'layer' };
	assert.equal(modulePageView([shipped, own, layer], 'rnd')?.id, 'rnd-dashboard', 'own beats layer beats package, before the id');
	assert.equal(modulePageView([shipped, layer], 'rnd')?.id, 'a-layer-page');
	assert.equal(modulePageView([shipped], 'rnd')?.id, 'modules-rnd');
	assert.equal(pageOrigin(own), 'ui-view rnd-dashboard · from default');
	assert.equal(pageOrigin(page('p', {})), 'ui-view p', 'a view with no module stamp: the id alone');
});

test('the counts layout is registered as a summary, with the row-band options only — group_by is its field', async () => {
	await import('../../src/registry/register-defaults');
	const { lists } = await import('../../src/registry/index');
	const counts = lists.get('counts');
	assert.ok(counts, 'registered');
	assert.equal(counts!.summarizes, true, 'no pager under a number');
	assert.deepEqual((counts!.options ?? []).map((o) => o.field), ['group_by', 'show_ungrouped_rows', 'show_empty_rows']);
});
