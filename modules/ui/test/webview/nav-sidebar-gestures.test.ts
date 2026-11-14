/**
 * Render tier — THE NAV IS ARRANGED BY HAND (cr-dt-008, task 13; rnd/tests dreamteamer-modules/nav-sidebar-gestures).
 * In a host with no native tree (dt web), NavSidebar turns each gesture — a drop, a row menu entry — into ONE
 * NavOp sent as `PATCH /nav`, built from the nodes' own `target`s (a key is never decoded), then redraws from
 * `GET /nav`. A refusal shows the host's sentence; a drop onto a layer sends nothing; the workspace node's
 * `notice` (the migration, an unreadable nav.yaml) draws above the tree.
 */
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { HostError, onHostRequest, requests, resetHost } from './host-stub';
import { all, flush, render, text, unmountAll, type TestNode } from './render';
import NavSidebar from '../../src/components/NavSidebar.vue';

const col = (name: string, label: string) => ({ kind: 'collection', key: `c/${name}`, label, target: { name }, route: `/content/${encodeURIComponent(name)}` });
const MODEL = () => [{
	kind: 'workspace', key: 'workspace', label: 'northwind-hq', icon: 'root-folder', route: '/settings/schema/activity', notice: 'nav.yaml written from your nav settings — they are no longer read',
	children: [
		col('tasks', 'Tasks'),
		col('contacts', 'Contacts'),
		{ ...col('companies', 'Companies'), children: [{ kind: 'view', key: 'v/companies-map', label: 'Map', route: '/companies-map' }] },
		{ kind: 'namespace', key: 'n/ns%3Arnd', label: 'R&D', target: { name: 'rnd' }, children: [
			col('rnd/issues', 'Issues'),
			{ kind: 'folder', key: 'f/ns%3Arnd/Product', label: 'Product', target: { folder: ['ns:rnd', 'Product'] }, children: [col('rnd/user-stories', 'User stories')] },
		] },
		{ kind: 'layers', key: 'layers/Layers', label: 'Layers', icon: 'layers', children: [
			{ kind: 'layer', key: 'l/northwind-archive', label: 'northwind-archive', children: [{ kind: 'layer-collection', key: 'l/northwind-archive/c/projects', label: 'Projects', description: '1' }] },
		] },
	],
}];

let patchAnswer: (body: unknown) => unknown = () => ({ doc: { tree: [], hidden: [] } });
const w = ((globalThis as { window?: any }).window ??= { addEventListener() {}, removeEventListener() {} });
beforeEach(() => {
	resetHost();
	patchAnswer = () => ({ doc: { tree: [], hidden: [] } });
	onHostRequest((method, path, body) => {
		if (method === 'GET' && path === '/nav') return MODEL();
		if (method === 'PATCH' && path === '/nav') return patchAnswer(body);
		throw new Error(`unexpected ${method} ${path}`);
	});
});
afterEach(() => unmountAll());

const router = () => createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
const rowOf = (root: TestNode, key: string) => {
	const r = all(root, (n) => n.tag === 'li' && n.props['data-key'] === key)[0];
	assert.ok(r, `no row ${key}`);
	return r;
};
const open = async (root: TestNode, key: string) => {
	(all(rowOf(root, key), (n) => n.props['class'] === 'dt-nav-twisty')[0].props['onClick'] as (e: unknown) => void)({ stopPropagation() {} });
	await flush();
};
/** A drag of `from` dropped on `to`: dragstart on the one, dragover and drop on the other, the pointer at `y` of a 20px row. */
async function drop(root: TestNode, from: string, to: string, y = 18) {
	const store = new Map<string, string>();
	const dataTransfer = { setData: (t: string, v: string) => store.set(t, v), getData: (t: string) => store.get(t) ?? '', effectAllowed: '', dropEffect: '' };
	const at = { clientY: y, currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 20, bottom: 20, left: 0, right: 200, width: 200 }) } };
	const ev = () => ({ ...at, dataTransfer, preventDefault() {}, stopPropagation() {} });
	(rowOf(root, from).props['onDragstart'] as (e: unknown) => void)(ev());
	await flush();
	const target = rowOf(root, to);
	(target.props['onDragover'] as ((e: unknown) => void) | undefined)?.(ev());
	await flush();
	(rowOf(root, to).props['onDrop'] as ((e: unknown) => void) | undefined)?.(ev());
	await flush();
}
const patches = () => requests.filter((r) => r.method === 'PATCH' && r.path === '/nav').map((r) => r.body);
async function menu(root: TestNode, key: string) {
	(rowOf(root, key).props['onContextmenu'] as (e: unknown) => void)({ clientX: 40, clientY: 60, preventDefault() {}, stopPropagation() {} });
	await flush();
	const m = all(root, (n) => n.props['class'] === 'dt-nav-menu')[0];
	assert.ok(m, `no menu for ${key}`);
	return m;
}
async function pick(root: TestNode, id: string) {
	const item = all(root, (n) => n.tag === 'button' && n.props['data-id'] === id)[0];
	assert.ok(item, `no menu item ${id}: ${all(root, (n) => n.tag === 'button').map((b) => b.props['data-id']).join(', ')}`);
	assert.notEqual(item.props['disabled'], true, `${id} is disabled`);
	(item.props['onClick'] as (e?: unknown) => void)({ stopPropagation() {} });
	await flush();
}

test('every row with a target is draggable; a layer row is not', async () => {
	const root = await render(NavSidebar, {}, [router()]);
	await open(root, 'layers/Layers');
	assert.equal(rowOf(root, 'c/tasks').props['draggable'], 'true');
	assert.equal(rowOf(root, 'n/ns%3Arnd').props['draggable'], 'true');
	assert.notEqual(rowOf(root, 'layers/Layers').props['draggable'], 'true');
	assert.notEqual(rowOf(root, 'l/northwind-archive').props['draggable'], 'true');
});

test('a drop of contacts after tasks sends one move with the two targets, then redraws', async () => {
	const root = await render(NavSidebar, {}, [router()]);
	const gets = () => requests.filter((r) => r.method === 'GET').length;
	const before = gets();
	await drop(root, 'c/contacts', 'c/tasks');
	assert.deepEqual(patches(), [{ op: 'move', target: { name: 'contacts' }, after: { name: 'tasks' } }]);
	assert.equal(gets(), before + 1, 'the nav was not reloaded after the write');
});

test('a drop on the middle of a namespace row moves into it; on a folder inside it, into that folder by its path', async () => {
	const root = await render(NavSidebar, {}, [router()]);
	await drop(root, 'c/tasks', 'n/ns%3Arnd', 10);
	await open(root, 'n/ns%3Arnd');
	await drop(root, 'c/contacts', 'f/ns%3Arnd/Product', 10);
	assert.deepEqual(patches(), [
		{ op: 'move', target: { name: 'tasks' }, into: { name: 'rnd' } },
		{ op: 'move', target: { name: 'contacts' }, into: { folder: ['ns:rnd', 'Product'] } },
	]);
});

test('the drop line is drawn on the row under the pointer: after on its lower edge, into on a folder middle', async () => {
	const root = await render(NavSidebar, {}, [router()]);
	const store = new Map<string, string>();
	const ev = (y: number) => ({ clientY: y, currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 20 }) }, dataTransfer: { setData: (t: string, v: string) => store.set(t, v), getData: (t: string) => store.get(t) ?? '' }, preventDefault() {}, stopPropagation() {} });
	(rowOf(root, 'c/contacts').props['onDragstart'] as (e: unknown) => void)(ev(10));
	(rowOf(root, 'c/tasks').props['onDragover'] as (e: unknown) => void)(ev(18));
	await flush();
	assert.match(String(rowOf(root, 'c/tasks').props['class']), /dt-nav-drop-after/);
	(rowOf(root, 'n/ns%3Arnd').props['onDragover'] as (e: unknown) => void)(ev(10));
	await flush();
	assert.match(String(rowOf(root, 'n/ns%3Arnd').props['class']), /dt-nav-drop-into/);
	assert.doesNotMatch(String(rowOf(root, 'c/tasks').props['class']), /dt-nav-drop/);
});

test('a drop on a layer row or the layers folder sends nothing', async () => {
	const root = await render(NavSidebar, {}, [router()]);
	await open(root, 'layers/Layers');
	await drop(root, 'c/tasks', 'layers/Layers', 10);
	await drop(root, 'c/tasks', 'l/northwind-archive', 18);
	assert.deepEqual(patches(), []);
});

test('a drop on a view row is a drop after its collection', async () => {
	const root = await render(NavSidebar, {}, [router()]);
	await open(root, 'c/companies');
	await drop(root, 'c/tasks', 'v/companies-map');
	assert.deepEqual(patches(), [{ op: 'move', target: { name: 'tasks' }, after: { name: 'companies' } }]);
});

test('the row menu: New folder, Hide, Move up on the second row, Move down, Move to bottom', async () => {
	const root = await render(NavSidebar, {}, [router()]);
	await menu(root, 'n/ns%3Arnd');
	await pick(root, 'new-folder');
	const input = all(root, (n) => n.tag === 'input' && n.props['class'] === 'dt-nav-menu-input')[0];
	assert.ok(input, 'New folder asks for a label');
	(input.props['onInput'] as (e: unknown) => void)({ target: { value: 'Plans' } });
	await flush();
	await pick(root, 'ok');
	await menu(root, 'c/contacts');
	await pick(root, 'hide');
	await menu(root, 'c/contacts');
	await pick(root, 'move-up');
	await menu(root, 'c/contacts');
	await pick(root, 'move-down');
	await menu(root, 'c/companies');
	await pick(root, 'move-up');
	await menu(root, 'c/tasks');
	await pick(root, 'move-bottom');
	assert.deepEqual(patches(), [
		{ op: 'new-folder', label: 'Plans', into: { name: 'rnd' } },
		{ op: 'hide', target: { name: 'contacts' } },
		{ op: 'move', target: { name: 'contacts' }, position: 'top' },
		{ op: 'move', target: { name: 'contacts' }, after: { name: 'companies' } },
		{ op: 'move', target: { name: 'companies' }, after: { name: 'tasks' } },
		{ op: 'move', target: { name: 'tasks' }, position: 'bottom' },
	]);
});

test('inside a folder, Move up on its second row moves to the top of that folder; Rename and Dissolve name the folder path', async () => {
	const root = await render(NavSidebar, {}, [router()]);
	await open(root, 'n/ns%3Arnd');
	await menu(root, 'f/ns%3Arnd/Product');
	await pick(root, 'move-up');
	await menu(root, 'f/ns%3Arnd/Product');
	await pick(root, 'rename');
	const input = all(root, (n) => n.tag === 'input' && n.props['class'] === 'dt-nav-menu-input')[0];
	(input.props['onInput'] as (e: unknown) => void)({ target: { value: 'Product/UX' } });
	await pick(root, 'ok');
	await menu(root, 'f/ns%3Arnd/Product');
	await pick(root, 'dissolve');
	assert.deepEqual(patches(), [
		{ op: 'move', target: { folder: ['ns:rnd', 'Product'] }, into: { name: 'rnd' }, position: 'top' },
		{ op: 'rename', target: { folder: ['ns:rnd', 'Product'] }, label: 'Product/UX' },
		{ op: 'dissolve', target: { folder: ['ns:rnd', 'Product'] } },
	]);
});

test('the root menu: Show hidden… sends show for the name given', async () => {
	const root = await render(NavSidebar, {}, [router()]);
	await menu(root, 'workspace');
	await pick(root, 'show-hidden');
	const input = all(root, (n) => n.tag === 'input' && n.props['class'] === 'dt-nav-menu-input')[0];
	(input.props['onInput'] as (e: unknown) => void)({ target: { value: 'contacts' } });
	await pick(root, 'ok');
	assert.deepEqual(patches(), [{ op: 'show', target: { name: 'contacts' } }]);
});

test('a refused op shows the host sentence', async () => {
	patchAnswer = () => { throw new HostError('no folder ["Plans"] in nav.yaml — "Plans" is not there', 400); };
	const root = await render(NavSidebar, {}, [router()]);
	await drop(root, 'c/contacts', 'c/tasks');
	const err = all(root, (n) => n.props['class'] === 'dt-nav-error')[0];
	assert.ok(err, 'no error drawn');
	assert.match(text(err), /no folder \["Plans"\] in nav\.yaml/);
});

test('the notice draws once, above the tree, and can be dismissed', async () => {
	const root = await render(NavSidebar, {}, [router()]);
	const notices = all(root, (n) => n.props['class'] === 'dt-nav-notice');
	assert.equal(notices.length, 1);
	assert.match(text(notices[0]), /nav\.yaml written from your nav settings/);
	const nav = all(root, (n) => n.tag === 'nav')[0];
	const kids = nav.children.filter((c): c is TestNode => typeof c !== 'string');
	assert.ok(kids.indexOf(notices[0]) < kids.findIndex((c) => c.tag === 'ul'), 'the notice is not above the tree');
	(all(notices[0], (n) => n.tag === 'button')[0].props['onClick'] as () => void)();
	await flush();
	assert.equal(all(root, (n) => n.props['class'] === 'dt-nav-notice').length, 0);
	void w;
});
