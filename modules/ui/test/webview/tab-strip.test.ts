/**
 * Render tier — the browser host's tab strip across a reload: "Reloading dt web restores the open tabs and the
 * selected one." The strip is mounted, used, unmounted (the page goes away) and mounted again over the same storage —
 * once at the page's own address (its hash names a page), once at a transit route (a fresh `dt web open`).
 */
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { all, flush, hasClass, render, text, unmountAll, type TestNode } from './render';
import TabStrip from '../../src/components/TabStrip.vue';
import { TAB_CAP, seedTitle, tabs, titleTab } from '../../src/lib/tabs';

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, String(v)),
	removeItem: (k: string) => void store.delete(k),
};
beforeEach(() => { store.clear(); tabs.value = []; });
afterEach(() => unmountAll());

const router = () => createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { render: () => null } }] });
async function mountAt(r: Router, at: string): Promise<TestNode> {
	await r.push(at);
	await r.isReady();
	const root = await render(TabStrip, {}, [r]);
	await flush();
	return root;
}
const labels = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-tab__label')).map((n) => text(n));
const selected = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-tab') && hasClass(n, 'is-active')).map((n) => text(n).trim());

test('a reload at the page\'s own address restores every tab, in order, with its title, and selects that page', async () => {
	let r = router();
	let root = await mountAt(r, '/content/tasks');
	seedTitle('/content/contacts/sam-diaz', 'Sam Diaz');
	await r.push('/content/contacts/sam-diaz');
	await r.push('/content/meetings');
	titleTab('/content/meetings', 'Meetings');
	titleTab('/content/tasks', 'Tasks');
	await r.push('/content/contacts/sam-diaz');
	await flush();
	assert.deepEqual(labels(root), ['Tasks', 'Sam Diaz', 'Meetings']);
	unmountAll();
	tabs.value = []; // the page went away: nothing in memory survives a reload
	r = router();
	root = await mountAt(r, '/content/contacts/sam-diaz');
	assert.deepEqual(labels(root), ['Tasks', 'Sam Diaz', 'Meetings'], 'the tabs did not come back');
	assert.deepEqual(selected(root), ['Sam Diaz'], 'the selected tab did not come back');
	assert.equal(r.currentRoute.value.fullPath, '/content/contacts/sam-diaz');
});

test('a reload that opens on a transit route goes to the tab that was selected, and opens no tab for the first collection', async () => {
	let r = router();
	await mountAt(r, '/content/tasks');
	await r.push('/content/meetings?sort=-starts');
	await r.push('/content/tasks');
	await r.push('/content/meetings?sort=-starts');
	await flush();
	unmountAll();
	tabs.value = [];
	r = router();
	const root = await mountAt(r, '/content/');
	await flush();
	assert.equal(r.currentRoute.value.fullPath, '/content/meetings?sort=-starts', 'the selected tab (with its query) was not restored');
	assert.equal(labels(root).length, 2, 'a transit route opened a tab of its own');
	assert.deepEqual(selected(root).length, 1);
});

test('the strip never holds more than the cap: the least recently used tab goes', async () => {
	const r = router();
	const root = await mountAt(r, '/content/c0');
	for (let i = 1; i <= TAB_CAP; i++) await r.push(`/content/c${i}`);
	await flush();
	assert.equal(all(root, (n) => hasClass(n, 'dt-tab')).length, TAB_CAP);
	assert.ok(!labels(root).includes('c0'), 'the oldest tab stayed');
	assert.ok(labels(root).includes(`c${TAB_CAP}`), 'the newest tab is missing');
});
