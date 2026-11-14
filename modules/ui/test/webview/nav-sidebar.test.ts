/**
 * Render tier — THE BROWSER'S NAV (cr-modules-005): NavSidebar draws the host's `GET /nav` rows — protocol 0.2's
 * `folder` and `namespace` nodes, each carrying its `target` (cr-dt-008) — routes on a click and opens a folder
 * (no scope toggle: 0.24.26 retired it); App draws it only when the host says it has
 * no native tree (`__DT_HOST__.nav === 'app'`) — inside VS Code it is never drawn.
 */
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, requests, resetHost } from './host-stub';
import { all, flush, render, text, unmountAll, type TestNode } from './render';
import NavSidebar from '../../src/components/NavSidebar.vue';

const MODEL = [{
	kind: 'workspace', key: 'workspace', label: 'northwind-hq', icon: 'root-folder', route: '/settings/schema/activity',
	children: [
		{ kind: 'collection', key: 'c/projects', label: 'Projects', icon: 'briefcase', description: '3', route: '/content/projects', target: { name: 'projects' } },
		{ kind: 'namespace', key: 'n/ns%3Alab', label: 'Lab', icon: 'folder-compact', target: { name: 'lab' }, children: [{ kind: 'collection', key: 'c/lab/samples', label: 'Samples', description: '1', route: '/content/lab%2Fsamples', target: { name: 'lab/samples' } }] },
	],
}];

const w = ((globalThis as { window?: any }).window ??= { addEventListener() {}, removeEventListener() {} });
beforeEach(() => {
	resetHost();
	onHostRequest((method, path, body) => {
		if (method === 'GET' && path === '/nav') return MODEL;
		throw new Error(`unexpected ${method} ${path}`);
	});
});
afterEach(() => unmountAll());

const rows = (root: TestNode) => all(root, (n) => n.tag === 'li');
const labelOf = (row: TestNode) => text(all(row, (n) => n.props['class'] === 'dt-nav-label')[0]);
const clickLabel = (row: TestNode) => (all(row, (n) => n.props['class'] === 'dt-nav-label')[0].props['onClick'] as () => void)();

test('draws the host nav, opens a folder and routes a row', async () => {
	const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	const root = await render(NavSidebar, {}, [router]);
	assert.ok(requests.some((r) => r.method === 'GET' && r.path === '/nav'), 'never asked the host for the nav');
	let list = rows(root);
	assert.deepEqual(list.map(labelOf), ['northwind-hq', 'Projects', 'Lab'], 'the workspace row is open, its folder closed');
	(all(list[2], (n) => n.props['class'] === 'dt-nav-twisty')[0].props['onClick'] as (e: unknown) => void)({ stopPropagation() {} });
	await flush();
	list = rows(root);
	assert.ok(list.some((r) => labelOf(r).includes('Samples')), 'opening Lab did not draw Samples');
	clickLabel(list.find((r) => labelOf(r).includes('Projects'))!);
	await flush();
	assert.equal(router.currentRoute.value.fullPath, '/content/projects');
	assert.equal(all(root, (n) => n.tag === 'button').length, 0, 'no scope toggle — the editor has none');
	assert.equal(all(root, (n) => n.props['class'] === 'dt-nav-namespace' || String(n.props['class'] ?? '').includes('dt-nav-namespace')).length, 1, 'the namespace node draws as a namespace row');
});

test('App draws NavSidebar only when the host declares an app nav', async () => {
	const src = (await import('node:fs')).readFileSync(new URL('../../src/App.vue', import.meta.url).pathname.replace('/.test-build/webview', ''), 'utf8');
	assert.match(src, /<NavSidebar v-if="appNav" \/>/);
	assert.match(src, /__DT_HOST__\?\.nav === 'app'/);
	assert.equal(w.__DT_HOST__, undefined, 'no host capability is set in this tier, as inside VS Code');
});
