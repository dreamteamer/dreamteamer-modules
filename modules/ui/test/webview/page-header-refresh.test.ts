/**
 * The app tab's own top bar draws refresh RIGHT OF SEARCH — PageHeader row 1, whose search sits at
 * the right end on every list page (operator ask 2026-07-29) — and at that bar's right end on a record
 * page, which has no search. Its click runs the ONE refresh command over the host's prefix-gated
 * `dt:command` channel, so both buttons share one behaviour; the webview never refreshes itself here.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { notifications } from './host-stub';
import { find, flush, hasClass, render, unmountAll, type TestNode } from './render';
import PageHeader from '../../webview/src/components/PageHeader.vue';

async function router() {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/content/gadgets');
	await r.isReady();
	return r;
}

const PROPS = { icon: 'tasklist', title: 'Gadgets' };
/** The element children of a node, skipping text and comment nodes Vue leaves around a v-if. */
const elements = (n: TestNode) => n.children.filter((c): c is TestNode => typeof c !== 'string' && !c.tag.startsWith('#'));

beforeEach(() => {
	unmountAll();
	notifications.length = 0;
});

test('on a list page, row 1 ends with [search, refresh]', async () => {
	const WithSearch = defineComponent({
		render: () => h(PageHeader, PROPS, { search: () => h('span', { class: 'probe-search' }) }),
	});
	const root = await render(WithSearch, {}, [await router()]);
	await flush();
	const nav = find(root, (n) => hasClass(n, 'dt-page-nav'))!;
	const end = find(nav, (n) => hasClass(n, 'dt-page-nav__end'));
	assert.ok(end, 'row 1 has a right-aligned end group');
	assert.equal(elements(nav).at(-1), end, 'the end group is the last thing in row 1');
	const kids = elements(end!);
	assert.equal(kids.length, 2, 'search, then refresh');
	assert.ok(hasClass(kids[0]!, 'dt-page-nav__search') && find(kids[0]!, (n) => hasClass(n, 'probe-search')), 'search first');
	assert.ok(hasClass(kids[1]!, 'dt-page-nav__refresh'), 'refresh immediately right of it');
	assert.equal(kids[1]!.props['title'], 'Refresh');
});

test('on a record page (no search), refresh is still in the right-aligned end group', async () => {
	const root = await render(PageHeader, PROPS, [await router()]);
	await flush();
	const end = find(root, (n) => hasClass(n, 'dt-page-nav__end'));
	assert.ok(end, 'the end group draws without a search');
	const kids = elements(end!);
	assert.equal(kids.length, 1);
	assert.ok(hasClass(kids[0]!, 'dt-page-nav__refresh'));
});

test('a click runs dreamteamer.refresh on the host, once', async () => {
	const root = await render(PageHeader, PROPS, [await router()]);
	await flush();
	const button = find(root, (n) => hasClass(n, 'dt-page-nav__refresh'))!;
	(button.props['onClick'] as () => void)();
	assert.deepEqual(notifications, [{ type: 'dt:command', payload: { command: 'dreamteamer.refresh' } }]);
});
