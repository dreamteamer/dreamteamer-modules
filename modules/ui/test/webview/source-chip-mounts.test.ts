/**
 * EVERY MOUNT READS ITS OWN URL (cr-vscode-004 lines 1 and 2; test stage h8, issue "a collection whose
 * first mount in a session was narrowed by a layer's nav row keeps that source on every later fresh
 * mount"). A layer's nav row opens the list with `?filter=` naming `$source is <layer>`; that filter was
 * remembered as the session's "unsaved tweak" (scratch) and laid over every LATER mount's URL, so
 * layer B's row drew layer A's chip, the plain row drew it too, and the URL was rewritten to it.
 *
 * The real BrowseView over the host stub, mounted afresh each time in ONE session (the scratch map is
 * module-level, as in the running app). Both orders the test stage asked for. Synthetic names only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, resetHost } from './host-stub';
import { find, flush, hasClass, render, text, type TestNode } from './render';
import { invalidateContract } from '../../webview/src/api/adapter';
import { refreshCollections } from '../../webview/src/composables/collections';
import { lists } from '../../webview/src/registry/index';
import { fieldRow } from '../unit/field-rows';
import BrowseView from '../../webview/src/components/BrowseView.vue';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };
lists.register({ id: 'table', name: 'Table', component: { render: () => null } });

const SOURCES = [
	{ name: 'my-hq', kind: 'own', repo: '.', path: 'data/tasks', installed: true, count: 2, via: 'own', access: 'write' },
	{ name: 'project-a', kind: 'layer', repo: 'git_modules/project-a', path: 'git_modules/project-a/data/tasks', installed: true, count: 1, via: 'layer', access: 'write' },
	{ name: 'project-b', kind: 'layer', repo: 'git_modules/project-b', path: 'git_modules/project-b/data/tasks', installed: true, count: 3, via: 'layer', access: 'edit' },
];

async function mount(collection: string, url: string) {
	resetHost();
	invalidateContract();
	const ROW = { collection, title: collection, nav: {}, list: { layout: 'table' }, record: { layout: 'page' }, form: { sections: [] }, record_title: '{{ name }}', record_type: collection, runtime: false, internal: false, sources: SOURCES };
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [ROW], fields: { [collection]: [fieldRow('name', { collection })] }, relations: [] };
		if (path === '/info') return { name: 'my-hq', modules: [] };
		if (method === 'GET' && path.startsWith(`/collections/${collection}/records`)) return { records: [], total: 0, sources: SOURCES };
		if (path.startsWith('/commit')) return [];
		return {};
	});
	await refreshCollections();
	const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await router.push(url);
	await router.isReady();
	const root = await render(BrowseView, { collection }, [router]);
	for (let i = 0; i < 10; i++) await flush();
	return { root, router };
}
// a layer's nav row's exact filter (`src/nav.ts` layerRoute); each test uses its own collection, so the
// session state one test leaves cannot reach another
const layerRow = (c: string, layer: string) => `/content/${c}?filter=${encodeURIComponent(JSON.stringify({ logic: '_and', rules: [{ field: '$source', operator: '_eq', value: layer }] }))}`;
const chip = (root: TestNode) => {
	const n = find(root, (x) => hasClass(x, 'dt-chip--source'));
	return n ? text(n).replace(/\s+/g, ' ').trim() : null;
};
const picker = (root: TestNode) => text(find(root, (n) => hasClass(n, 'dt-source-picker__trigger'))!).replace(/\s+/g, ' ').trim();
const urlSources = (router: { currentRoute: { value: { query: Record<string, unknown> } } }) => {
	const raw = router.currentRoute.value.query['filter'];
	return typeof raw === 'string' ? (JSON.parse(raw).rules ?? []).filter((r: { field: string }) => r.field === '$source').map((r: { value: unknown }) => r.value) : [];
};

test('layer A\'s row, then layer B\'s row, then the plain row — each mount reads its own URL (h8)', async () => {
	const a = await mount('tasks', layerRow('tasks', 'project-a'));
	assert.equal(chip(a.root), 'Source is project-a');
	const b = await mount('tasks', layerRow('tasks', 'project-b'));
	assert.equal(chip(b.root), 'Source is project-b', 'layer B\'s row opens with B\'s chip');
	assert.match(picker(b.root), /project-b/, 'and the picker agrees');
	assert.deepEqual(urlSources(b.router), ['project-b'], 'and the URL is not rewritten to A');
	const plain = await mount('tasks', '/content/tasks');
	assert.equal(chip(plain.root), null, 'the plain row opens with no source chip');
	assert.equal(picker(plain.root), 'All sources');
	assert.deepEqual(urlSources(plain.router), []);
});

test('the plain row, then layer A\'s row, then the plain row again', async () => {
	const first = await mount('notes', '/content/notes');
	assert.equal(chip(first.root), null);
	const a = await mount('notes', layerRow('notes', 'project-a'));
	assert.equal(chip(a.root), 'Source is project-a');
	const again = await mount('notes', '/content/notes');
	assert.equal(chip(again.root), null, 'a layer row visited in between leaves nothing behind');
});

test('a source picked BY HAND is not carried to the next mount either — the nav row\'s URL says what it shows', async () => {
	const first = await mount('leads', '/content/leads');
	(find(first.root, (n) => hasClass(n, 'dt-source-picker__trigger'))!.props['onClick'] as () => void)();
	for (let i = 0; i < 5; i++) await flush();
	(find(first.root, (n) => hasClass(n, 'dt-source-picker__row') && n.props['data-source'] === 'project-b')!.props['onClick'] as () => void)();
	for (let i = 0; i < 5; i++) await flush();
	assert.equal(chip(first.root), 'Source is project-b');
	const b = await mount('leads', layerRow('leads', 'project-a'));
	assert.equal(chip(b.root), 'Source is project-a');
});
