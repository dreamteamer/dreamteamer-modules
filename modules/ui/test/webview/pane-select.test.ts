/**
 * Render tier — cr-modules-017 task 16 (rnd/tests/dreamteamer-modules/pane-s3-ticked-rows-and-pushed-place, the page
 * half): the page reports its place and its ticked rows with one `PUT /selection` after a short debounce, at every
 * level — Read included; and a `dt:select` the chat pushed ticks those rows, clears them with [], and moves to the
 * refs' collection first. A real BrowseView over a real useBrowseState; the host is the stub. Synthetic names only.
 */
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { onHostRequest, requests, resetHost } from './host-stub';
import { find, flush, hasClass, render, text, unmountAll } from './render';
import { invalidateContract } from '../../src/api/adapter';
import { refreshCollections } from '../../src/composables/collections';
import { lists } from '../../src/registry/index';
import { fieldRow } from '../unit/field-rows';
import BrowseView from '../../src/components/BrowseView.vue';
import { hostInfo } from '../../src/lib/host-boot';
import { pageSelection, pushedSelection } from '../../src/lib/pane-place';
import { receiveSelect, startPaneReport } from '../../src/composables/pane-report';
import type { useBrowseState } from '../../src/composables/browse-state';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

let listState: ReturnType<typeof useBrowseState> | null = null;
lists.register({ id: 'table', name: 'Table', component: { props: ['state', 'collection', 'query', 'options'], setup(p: any) { listState = p.state; return () => null; } } as any });

const COLLECTIONS = ['tasks', 'notes'];
const ROW = (collection: string) => ({ collection, title: collection, nav: {}, list: { layout: 'table' }, record: { layout: 'page' }, form: { sections: [] }, record_title: '{{ name }}', record_type: collection, runtime: false, internal: false, sources: [] });
const RECORDS = { tasks: ['call-the-bank', 'brief-dana', 'file-taxes'], notes: ['n1'] } as Record<string, string[]>;

let selectionStatus = 200;
beforeEach(async () => {
	resetHost();
	invalidateContract();
	selectionStatus = 200;
	pageSelection.value = null;
	pushedSelection.value = null;
	listState = null;
	hostInfo.value = { level: 'read', chat: false, workspace: { id: 'a1b2c3d4e5f60718', name: 'Northwind' } };
	onHostRequest((method, path, body) => {
		if (path === '/presentation') return { collections: COLLECTIONS.map(ROW), fields: Object.fromEntries(COLLECTIONS.map((c) => [c, [fieldRow('name', { collection: c })]])), relations: [] };
		if (path === '/info') return { name: 'northwind', modules: [] };
		if (method === 'PUT' && path === '/selection') {
			if (selectionStatus !== 200) { const e = new Error('no record tasks/gone') as Error & { status: number }; e.status = selectionStatus; throw e; }
			return { ...(body as object), place: 'x', at: 'now' };
		}
		for (const c of COLLECTIONS) if (method === 'GET' && path.startsWith(`/collections/${c}/records`)) return { records: RECORDS[c].map((id) => ({ id, name: id })), total: RECORDS[c].length, sources: [] };
		if (path.startsWith('/commit')) return [];
		return {};
	});
	await refreshCollections();
});
let stop: (() => void) | null = null;
afterEach(() => { stop?.(); stop = null; unmountAll(); });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const puts = () => requests.filter((r) => r.method === 'PUT' && r.path === '/selection');

async function page(collection: string): Promise<{ router: Router; root: Awaited<ReturnType<typeof render>> }> {
	const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/content/:path(.*)', name: 'content', component: { render: () => null } }, { path: '/:p(.*)*', component: { render: () => null } }] });
	await router.push(`/content/${collection}`);
	await router.isReady();
	const root = await render(BrowseView, { collection }, [router]);
	for (let i = 0; i < 8; i++) await flush();
	stop = startPaneReport({ route: router.currentRoute, collections: () => COLLECTIONS, debounceMs: 20 });
	return { router, root };
}

test('ticking two rows sends ONE PUT /selection with both refs after the debounce — at Read', async () => {
	await page('tasks');
	await wait(40);
	requests.length = 0;
	listState!.toggleSelect('call-the-bank');
	listState!.toggleSelect('brief-dana');
	await flush();
	assert.equal(puts().length, 0, 'nothing before the debounce');
	await wait(50);
	assert.equal(puts().length, 1);
	assert.deepEqual(puts()[0].body, { view: { collection: 'tasks' }, refs: ['tasks/call-the-bank', 'tasks/brief-dana'] });
});

test('a navigation to a record reports { collection, id }', async () => {
	const { router } = await page('tasks');
	await wait(40);
	requests.length = 0;
	await router.push('/content/tasks/brief-dana');
	await wait(50);
	assert.deepEqual(puts().at(-1)?.body, { view: { collection: 'tasks', id: 'brief-dana' }, refs: [] }, 'the browse is gone: no rows ticked');
});

test('a dt:select with two refs ticks those rows; [] clears them', async () => {
	const { router, root } = await page('tasks');
	receiveSelect(['tasks/call-the-bank', 'tasks/file-taxes'], { router, collections: () => COLLECTIONS });
	for (let i = 0; i < 4; i++) await flush();
	assert.deepEqual([...listState!.selectedIds.value].sort(), ['call-the-bank', 'file-taxes']);
	assert.equal(text(find(root, (n) => hasClass(n, 'dt-browse-selection-count'))!), '2 selected');
	receiveSelect([], { router, collections: () => COLLECTIONS });
	await flush();
	assert.equal(listState!.selectedIds.value.size, 0);
});

test('a dt:select for another collection navigates there first', async () => {
	const { router } = await page('tasks');
	receiveSelect(['notes/n1'], { router, collections: () => COLLECTIONS });
	await flush();
	assert.equal(router.currentRoute.value.fullPath, '/content/notes');
	assert.deepEqual(pushedSelection.value?.refs, ['notes/n1'], 'held for the notes list to apply when it mounts');
});

test('a 400 from PUT /selection is dropped silently', async () => {
	selectionStatus = 400;
	await page('tasks');
	listState!.toggleSelect('call-the-bank');
	await wait(50);
	assert.ok(puts().length >= 1, 'it was sent');
});
