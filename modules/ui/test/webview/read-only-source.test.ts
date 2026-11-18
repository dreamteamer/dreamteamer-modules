/**
 * A READ-ONLY SOURCE'S RECORD IS READ-ONLY ON ITS PAGE, AND SAYS WHY (cr-vscode-004, line 4). A record
 * whose root takes no write from this workspace — `access: read`, an installed package — opens with no
 * Edit and no Delete, and its source line carries the lock and the host's reason. The same page for a
 * record of a writable root keeps both. The real ContentDetail over the host stub; synthetic names.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, type TestNode } from './render';
import { invalidateContract } from '../../src/api/adapter';
import { refreshCollections } from '../../src/composables/collections';
import { edits, views } from '../../src/registry/index';
import { fieldRow } from '../unit/field-rows';
import ContentDetail from '../../src/pages/ContentDetail.vue';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {}, confirm: () => true };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as Record<string, unknown>)['Element'] ??= class {};
(globalThis as Record<string, unknown>)['HTMLElement'] ??= class {};
for (const r of [edits, views]) r.register({ id: 'properties', name: 'Properties', scope: 'record', types: [], component: { render: () => null } } as never);

const NOTE = 'tasks-kit is an installed package — nothing is written to it from this workspace; change it in the package\'s own repo';
const SOURCES = [
	{ name: 'my-hq', kind: 'own', repo: '.', path: 'data/tasks', installed: true, count: 1, via: 'own', access: 'write' },
	{ name: 'tasks-kit', kind: 'module', repo: '.', path: 'node_modules/@scope/tasks-kit', installed: true, count: 1, via: 'package', access: 'read', note: NOTE },
];
const ROW = { collection: 'tasks', title: 'Tasks', nav: {}, list: { layout: 'table' }, record: { layout: 'page' }, form: { sections: [] }, record_title: '{{ name }}', record_type: 'task', runtime: false, internal: false, sources: SOURCES };
const RECORDS: Record<string, { name: string; source: string; kind: string }> = {
	shipped: { name: 'Shipped with the package', source: 'tasks-kit', kind: 'module' },
	mine: { name: 'Write the brief', source: 'my-hq', kind: 'own' },
};

async function page(id: string): Promise<TestNode> {
	resetHost();
	invalidateContract();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [ROW], fields: { tasks: [fieldRow('name', { collection: 'tasks' })] }, relations: [] };
		if (path === '/info') return { name: 'my-hq', modules: [] };
		const hit = Object.entries(RECORDS).find(([rid]) => path.startsWith(`/collections/tasks/records/${rid}`));
		if (method === 'GET' && hit) return { id: hit[0], fields: { name: hit[1].name, $source: hit[1].source, '$source-kind': hit[1].kind }, path: `data/tasks/${hit[0]}.task.md` };
		if (path.startsWith('/commit')) return [];
		return {};
	});
	await refreshCollections();
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push(`/content/tasks/${id}`);
	await r.isReady();
	const root = await render(ContentDetail, { collection: 'tasks', id, create: false }, [r]);
	for (let i = 0; i < 10; i++) await flush();
	return root;
}
const buttonTitles = (root: TestNode) => all(root, (n) => n.tag === 'button').map((b) => b.props['title']);

test('a record of a read-only root: no Edit, no Delete — and the source line carries the lock and the reason', async () => {
	const root = await page('shipped');
	assert.ok(!buttonTitles(root).includes('Edit'), `no Edit pencil: ${JSON.stringify(buttonTitles(root))}`);
	assert.ok(!buttonTitles(root).includes('More actions'), 'no ⋯ menu, which holds Delete');
	const line = find(root, (n) => hasClass(n, 'dt-page-commit__origin'))!;
	assert.ok(line, 'the source line');
	assert.match(String(find(line, (n) => hasClass(n, 'dt-source-mark__access'))!.props['class']), /codicon-lock/);
	assert.equal(text(find(line, (n) => n.props['data-read-only'] !== undefined)!).trim(), `read-only — ${NOTE}`);
});

test('a record of a writable root keeps Edit and the ⋯ menu', async () => {
	const root = await page('mine');
	assert.ok(buttonTitles(root).includes('Edit'));
	assert.ok(buttonTitles(root).includes('More actions'));
	assert.equal(find(root, (n) => n.props['data-read-only'] !== undefined), null);
});
