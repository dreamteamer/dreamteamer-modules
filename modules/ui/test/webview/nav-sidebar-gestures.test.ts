/**
 * Render tier — THE NAV IS ARRANGED BY HAND (cr-dt-008, task 13; rnd/tests dreamteamer-modules/nav-sidebar-gestures).
 * In a host with no native tree (dt web), NavSidebar turns each gesture — a drop, a row menu entry — into ONE
 * NavOp sent as `PATCH /nav`, built from the nodes' own `target`s (a key is never decoded), then redraws from
 * `GET /nav`. A refusal shows the host's sentence; a drop onto a layer sends nothing; the workspace node's
 * `notice` (the migration, an unreadable nav.yaml) draws above the tree.
 *
 * The 2026-11-14 16:30 revision: every gesture needs the nav UNLOCKED (the arrange lock in its toolbar starts locked),
 * the workspace node is the toolbar's name rather than a row, and the empty area under the last row is the bottom of
 * the top level.
 */
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { HostError, onHostRequest, requests, resetHost } from './host-stub';
import { all, flush, focused, hasClass, render, text, unmountAll, type TestNode } from './render';
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
	(rowOf(root, from).props['onDragstart'] as ((e: unknown) => void) | undefined)?.(ev());
	await flush();
	const target = rowOf(root, to);
	(target.props['onDragover'] as ((e: unknown) => void) | undefined)?.(ev());
	await flush();
	(rowOf(root, to).props['onDrop'] as ((e: unknown) => void) | undefined)?.(ev());
	await flush();
}
/** The toolbar's arrange toggle, and a click on it. */
const lockOf = (root: TestNode) => {
	const b = all(root, (n) => n.tag === 'button' && n.props['data-tool'] === 'arrange')[0];
	assert.ok(b, 'no arrange toggle in the toolbar');
	return b;
};
async function toggleLock(root: TestNode) {
	(lockOf(root).props['onClick'] as (e?: unknown) => void)({ stopPropagation() {} });
	await flush();
}
/** The nav, rendered and unlocked — what every arranging gesture needs. */
async function unlocked() {
	const root = await render(NavSidebar, {}, [router()]);
	await toggleLock(root);
	assert.equal(lockOf(root).props['aria-pressed'], 'true');
	return root;
}
const tool = (root: TestNode, id: string) => all(root, (n) => n.tag === 'button' && n.props['data-tool'] === id)[0];
const patches = () => requests.filter((r) => r.method === 'PATCH' && r.path === '/nav').map((r) => r.body);
async function menu(root: TestNode, key: string) {
	(rowOf(root, key).props['onContextmenu'] as (e: unknown) => void)({ clientX: 40, clientY: 60, preventDefault() {}, stopPropagation() {} });
	await flush();
	const m = all(root, (n) => String(n.props['class'] ?? '').split(' ').includes('dt-nav-menu'))[0];
	assert.ok(m, `no menu for ${key}`);
	return m;
}
async function clickTool(root: TestNode, id: string) {
	const b = tool(root, id);
	assert.ok(b, `no toolbar button ${id}`);
	(b.props['onClick'] as (e?: unknown) => void)({ stopPropagation() {}, currentTarget: null });
	await flush();
}
async function pick(root: TestNode, id: string) {
	const item = all(root, (n) => n.tag === 'button' && n.props['data-id'] === id)[0];
	assert.ok(item, `no menu item ${id}: ${all(root, (n) => n.tag === 'button').map((b) => b.props['data-id']).join(', ')}`);
	assert.notEqual(item.props['disabled'], true, `${id} is disabled`);
	(item.props['onClick'] as (e?: unknown) => void)({ stopPropagation() {} });
	await flush();
}

test('every row with a target is draggable; a layer row is not', async () => {
	const root = await unlocked();
	await open(root, 'layers/Layers');
	assert.equal(rowOf(root, 'c/tasks').props['draggable'], 'true');
	assert.equal(rowOf(root, 'n/ns%3Arnd').props['draggable'], 'true');
	assert.notEqual(rowOf(root, 'layers/Layers').props['draggable'], 'true');
	assert.notEqual(rowOf(root, 'l/northwind-archive').props['draggable'], 'true');
});

test('a drop of contacts after tasks sends one move with the two targets, then redraws', async () => {
	const root = await unlocked();
	const gets = () => requests.filter((r) => r.method === 'GET').length;
	const before = gets();
	await drop(root, 'c/contacts', 'c/tasks');
	assert.deepEqual(patches(), [{ op: 'move', target: { name: 'contacts' }, after: { name: 'tasks' } }]);
	assert.equal(gets(), before + 1, 'the nav was not reloaded after the write');
});

test('a drop on the middle of a namespace row moves into it; on a folder inside it, into that folder by its path', async () => {
	const root = await unlocked();
	await drop(root, 'c/tasks', 'n/ns%3Arnd', 10);
	await open(root, 'n/ns%3Arnd');
	await drop(root, 'c/contacts', 'f/ns%3Arnd/Product', 10);
	assert.deepEqual(patches(), [
		{ op: 'move', target: { name: 'tasks' }, into: { name: 'rnd' } },
		{ op: 'move', target: { name: 'contacts' }, into: { folder: ['ns:rnd', 'Product'] } },
	]);
});

test('the drop line is drawn on the row under the pointer: after on its lower edge, into on a folder middle', async () => {
	const root = await unlocked();
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

test('a drop on the upper part of a row lands before it: the top of its level on a first row, else after the row above', async () => {
	const root = await unlocked();
	await drop(root, 'c/contacts', 'c/tasks', 2);
	await drop(root, 'c/tasks', 'c/companies', 2);
	await open(root, 'n/ns%3Arnd');
	await drop(root, 'c/tasks', 'c/rnd/issues', 2);
	await drop(root, 'c/tasks', 'f/ns%3Arnd/Product', 2);
	await drop(root, 'c/tasks', 'n/ns%3Arnd', 2);
	assert.deepEqual(patches(), [
		{ op: 'move', target: { name: 'contacts' }, position: 'top' },
		{ op: 'move', target: { name: 'tasks' }, after: { name: 'contacts' } },
		{ op: 'move', target: { name: 'tasks' }, into: { name: 'rnd' }, position: 'top' },
		{ op: 'move', target: { name: 'tasks' }, after: { name: 'rnd/issues' } },
		{ op: 'move', target: { name: 'tasks' }, after: { name: 'companies' } },
	]);
});

test('a drop before the row just below the dragged one sends nothing — the row is already there', async () => {
	const root = await unlocked();
	await drop(root, 'c/tasks', 'c/contacts', 2);
	assert.deepEqual(patches(), []);
});

test('the drop line is drawn above the row on its upper part, and a folder keeps into on its middle', async () => {
	const root = await unlocked();
	const store = new Map<string, string>();
	const ev = (y: number) => ({ clientY: y, currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 20 }) }, dataTransfer: { setData: (t: string, v: string) => store.set(t, v), getData: (t: string) => store.get(t) ?? '' }, preventDefault() {}, stopPropagation() {} });
	(rowOf(root, 'c/contacts').props['onDragstart'] as (e: unknown) => void)(ev(10));
	(rowOf(root, 'c/tasks').props['onDragover'] as (e: unknown) => void)(ev(2));
	await flush();
	assert.match(String(rowOf(root, 'c/tasks').props['class']), /dt-nav-drop-before/);
	(rowOf(root, 'n/ns%3Arnd').props['onDragover'] as (e: unknown) => void)(ev(3));
	await flush();
	assert.match(String(rowOf(root, 'n/ns%3Arnd').props['class']), /dt-nav-drop-before/);
	(rowOf(root, 'n/ns%3Arnd').props['onDragover'] as (e: unknown) => void)(ev(10));
	await flush();
	assert.match(String(rowOf(root, 'n/ns%3Arnd').props['class']), /dt-nav-drop-into/);
});

test('inside a folder: before its first row is the top of that folder; a folder dragged before its own child is sent and refused by the host', async () => {
	const root = await unlocked();
	await open(root, 'n/ns%3Arnd');
	await open(root, 'f/ns%3Arnd/Product');
	await drop(root, 'c/tasks', 'c/rnd/user-stories', 2);
	await drop(root, 'f/ns%3Arnd/Product', 'c/rnd/user-stories', 2);
	assert.deepEqual(patches(), [
		{ op: 'move', target: { name: 'tasks' }, into: { folder: ['ns:rnd', 'Product'] }, position: 'top' },
		{ op: 'move', target: { folder: ['ns:rnd', 'Product'] }, into: { folder: ['ns:rnd', 'Product'] }, position: 'top' },
	]);
});

test('the lower edge of an open folder is the top inside it; of a closed one, after it', async () => {
	const root = await unlocked();
	await drop(root, 'c/tasks', 'n/ns%3Arnd', 18);
	await open(root, 'n/ns%3Arnd');
	await drop(root, 'c/tasks', 'n/ns%3Arnd', 18);
	assert.deepEqual(patches(), [
		{ op: 'move', target: { name: 'tasks' }, after: { name: 'rnd' } },
		{ op: 'move', target: { name: 'tasks' }, into: { name: 'rnd' }, position: 'top' },
	]);
});

test('the line is drawn where the drop lands: over a view row, after its collection', async () => {
	const root = await unlocked();
	await open(root, 'c/companies');
	const store = new Map<string, string>();
	const ev = (y: number) => ({ clientY: y, currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 20 }) }, dataTransfer: { setData: (t: string, v: string) => store.set(t, v), getData: (t: string) => store.get(t) ?? '' }, preventDefault() {}, stopPropagation() {} });
	(rowOf(root, 'c/tasks').props['onDragstart'] as (e: unknown) => void)(ev(10));
	(rowOf(root, 'v/companies-map').props['onDragover'] as (e: unknown) => void)(ev(2));
	await flush();
	assert.match(String(rowOf(root, 'c/companies').props['class']), /dt-nav-drop-after/);
	assert.doesNotMatch(String(rowOf(root, 'v/companies-map').props['class']), /dt-nav-drop/);
});

test('a drop on the upper part of a view row is still a drop after its collection', async () => {
	const root = await unlocked();
	await open(root, 'c/companies');
	await drop(root, 'c/tasks', 'v/companies-map', 2);
	assert.deepEqual(patches(), [{ op: 'move', target: { name: 'tasks' }, after: { name: 'companies' } }]);
});

test('a drop on a layer row or the layers folder sends nothing', async () => {
	const root = await unlocked();
	await open(root, 'layers/Layers');
	await drop(root, 'c/tasks', 'layers/Layers', 10);
	await drop(root, 'c/tasks', 'l/northwind-archive', 18);
	assert.deepEqual(patches(), []);
});

test('a drop on a view row is a drop after its collection', async () => {
	const root = await unlocked();
	await open(root, 'c/companies');
	await drop(root, 'c/tasks', 'v/companies-map');
	assert.deepEqual(patches(), [{ op: 'move', target: { name: 'tasks' }, after: { name: 'companies' } }]);
});

test('the row menu: New folder, Hide, Move up on the second row, Move down, Move to bottom', async () => {
	const root = await unlocked();
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
	const root = await unlocked();
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

test('the toolbar: Show hidden… sends show for the name given', async () => {
	const root = await unlocked();
	await clickTool(root, 'show-hidden');
	const input = all(root, (n) => n.tag === 'input' && n.props['class'] === 'dt-nav-menu-input')[0];
	(input.props['onInput'] as (e: unknown) => void)({ target: { value: 'contacts' } });
	await pick(root, 'ok');
	assert.deepEqual(patches(), [{ op: 'show', target: { name: 'contacts' } }]);
});

test('Show hidden… offers the names the last write hid: hidden rows and a namespace hidden in place', async () => {
	patchAnswer = () => ({ doc: { tree: ['tasks', { namespace: 'rnd', hidden: true, items: ['rnd/issues'] }], hidden: ['contacts'] } });
	const root = await unlocked();
	await menu(root, 'n/ns%3Arnd');
	await pick(root, 'hide');
	assert.deepEqual(patches(), [{ op: 'hide', target: { name: 'rnd' } }]);
	await clickTool(root, 'show-hidden');
	const offered = all(root, (n) => n.tag === 'option').map((n) => n.props['value']);
	assert.deepEqual(offered, ['contacts', 'rnd']);
});

test('a refused op shows the host sentence', async () => {
	patchAnswer = () => { throw new HostError('no folder ["Plans"] in nav.yaml — "Plans" is not there', 400); };
	const root = await unlocked();
	await drop(root, 'c/contacts', 'c/tasks');
	const err = all(root, (n) => n.props['class'] === 'dt-nav-error')[0];
	assert.ok(err, 'no error drawn');
	assert.match(text(err), /no folder \["Plans"\] in nav\.yaml/);
});

test('the notice draws once, above the tree, and can be dismissed', async () => {
	const root = await unlocked();
	const notices = all(root, (n) => n.props['class'] === 'dt-nav-notice');
	assert.equal(notices.length, 1);
	assert.match(text(notices[0]), /nav\.yaml written from your nav settings/);
	const nav = all(root, (n) => n.tag === 'nav')[0];
	const kids = nav.children.filter((c): c is TestNode => typeof c !== 'string');
	const toolbar = kids.findIndex((c) => hasClass(c, 'dt-nav-toolbar'));
	assert.ok(toolbar >= 0 && toolbar < kids.indexOf(notices[0]), 'the notice is not under the toolbar');
	assert.ok(kids.indexOf(notices[0]) < kids.findIndex((c) => hasClass(c, 'dt-nav-rows')), 'the notice is not above the rows');
	(all(notices[0], (n) => n.tag === 'button')[0].props['onClick'] as () => void)();
	await flush();
	assert.equal(all(root, (n) => n.props['class'] === 'dt-nav-notice').length, 0);
	void w;
});

// ---- the 2026-11-14 16:30 revision: the toolbar, no root row, the arrange lock -------------------------------------

test('locked (the default): no row is draggable, a right click opens no menu, and nothing is a drop', async () => {
	const root = await render(NavSidebar, {}, [router()]);
	assert.equal(lockOf(root).props['aria-pressed'], 'false', 'the nav starts locked');
	assert.match(String(lockOf(root).props['title']), /locked — click to arrange/);
	assert.ok(!hasClass(all(root, (n) => n.tag === 'nav')[0], 'dt-nav--arranging'));
	for (const key of ['c/tasks', 'c/contacts', 'n/ns%3Arnd', 'layers/Layers']) {
		const row = rowOf(root, key);
		assert.equal(row.props['draggable'], undefined, `${key} is draggable while locked`);
		for (const h of ['onDragstart', 'onDragover', 'onDrop', 'onContextmenu']) assert.equal(row.props[h], undefined, `${key} has ${h} while locked`);
	}
	const tail = all(root, (n) => hasClass(n, 'dt-nav-tail'))[0];
	assert.ok(tail, 'no empty area under the rows');
	assert.equal(tail.props['onDragover'], undefined, 'the empty area takes a drop while locked');
	assert.equal(tail.props['onDrop'], undefined);
	await drop(root, 'c/contacts', 'c/tasks');
	assert.deepEqual(patches(), [], 'a locked nav sent a write');
	assert.equal(all(root, (n) => String(n.props['class'] ?? '').split(' ').includes('dt-nav-menu')).length, 0);
	assert.equal(tool(root, 'new-folder'), undefined, 'New folder shows while locked');
	assert.equal(tool(root, 'show-hidden'), undefined, 'Show hidden shows while locked');
});

test('the toggle unlocks and relocks; aria-pressed and the tooltip follow, and relocking takes the gestures away', async () => {
	const root = await render(NavSidebar, {}, [router()]);
	await toggleLock(root);
	assert.equal(lockOf(root).props['aria-pressed'], 'true');
	assert.match(String(lockOf(root).props['title']), /click to lock it/);
	assert.ok(hasClass(all(root, (n) => n.tag === 'nav')[0], 'dt-nav--arranging'));
	assert.equal(rowOf(root, 'c/tasks').props['draggable'], 'true');
	assert.ok(tool(root, 'new-folder') && tool(root, 'show-hidden'), 'the arranging buttons are missing');
	const kids = all(root, (n) => hasClass(n, 'dt-nav-toolbar__buttons'))[0].children.filter((c): c is TestNode => typeof c !== 'string' && c.tag === 'button');
	assert.deepEqual(kids.map((b) => b.props['data-tool']), ['new-folder', 'show-hidden', 'arrange'], 'the buttons sit left of the toggle');
	await menu(root, 'c/tasks');
	await toggleLock(root);
	assert.equal(lockOf(root).props['aria-pressed'], 'false');
	assert.equal(rowOf(root, 'c/tasks').props['draggable'], undefined);
	assert.equal(all(root, (n) => String(n.props['class'] ?? '').split(' ').includes('dt-nav-menu')).length, 0, 'locking left a row menu open');
	assert.equal(tool(root, 'new-folder'), undefined);
});

test('no root row: the workspace is the toolbar name, its children are the top level at depth 0', async () => {
	const root = await render(NavSidebar, {}, [router()]);
	assert.equal(all(root, (n) => n.tag === 'li' && n.props['data-key'] === 'workspace').length, 0, 'the workspace is drawn as a row');
	const name = all(root, (n) => hasClass(n, 'dt-nav-toolbar__label'))[0];
	assert.equal(text(name), 'northwind-hq');
	assert.equal(name.props['title'], 'northwind-hq — Workspace settings', 'the whole name is the tooltip, and what a click does');
	assert.equal(all(root, (n) => n.tag === 'li' && text(n).includes('northwind-hq')).length, 0, 'the name is drawn twice');
	for (const key of ['c/tasks', 'c/contacts', 'c/companies', 'n/ns%3Arnd', 'layers/Layers']) {
		assert.deepEqual(rowOf(root, key).props['style'], { paddingLeft: '8px' }, `${key} is not at depth 0`);
	}
	await open(root, 'n/ns%3Arnd');
	assert.deepEqual(rowOf(root, 'c/rnd/issues').props['style'], { paddingLeft: '20px' });
});

test('the empty area under the last row is the bottom of the top level: its line on hover, position bottom on a drop', async () => {
	const root = await unlocked();
	const tail = () => all(root, (n) => hasClass(n, 'dt-nav-tail'))[0];
	const store = new Map<string, string>();
	const ev = () => ({ dataTransfer: { setData: (t: string, v: string) => store.set(t, v), getData: (t: string) => store.get(t) ?? '' }, preventDefault() {}, stopPropagation() {} });
	await open(root, 'n/ns%3Arnd');
	(rowOf(root, 'c/rnd/issues').props['onDragstart'] as (e: unknown) => void)(ev());
	(tail().props['onDragover'] as (e: unknown) => void)(ev());
	await flush();
	// position bottom lands after the last ARRANGED row (R&D), so the line is above the Layers folder drawn below it
	assert.match(String(rowOf(root, 'layers/Layers').props['class']), /dt-nav-drop-before/, 'the line is not above Layers');
	assert.ok(!hasClass(tail(), 'dt-nav-drop-tail'), 'the line is drawn under Layers, where the drop does not land');
	(tail().props['onDrop'] as (e: unknown) => void)(ev());
	await flush();
	assert.doesNotMatch(String(rowOf(root, 'layers/Layers').props['class']), /dt-nav-drop/, 'the line outlived the drop');
	// the last arranged top-level row is already at the bottom: nothing to send
	store.clear();
	(rowOf(root, 'n/ns%3Arnd').props['onDragstart'] as (e: unknown) => void)(ev());
	(tail().props['onDrop'] as (e: unknown) => void)(ev());
	await flush();
	assert.deepEqual(patches(), [{ op: 'move', target: { name: 'rnd/issues' }, position: 'bottom' }]);
});

test('New folder and Show hidden… in the toolbar go straight to their ask and send the top-level op', async () => {
	const root = await unlocked();
	await clickTool(root, 'new-folder');
	const m = all(root, (n) => String(n.props['class'] ?? '').split(' ').includes('dt-nav-menu'))[0];
	assert.ok(m, 'New folder opened no menu');
	assert.equal(all(m, (n) => n.props['role'] === 'menuitem').length, 0, 'it shows a list before the ask');
	const input = all(root, (n) => n.tag === 'input' && n.props['class'] === 'dt-nav-menu-input')[0];
	assert.ok(input, 'New folder asks for a label');
	(input.props['onInput'] as (e: unknown) => void)({ target: { value: 'Clients' } });
	await flush();
	await pick(root, 'ok');
	await clickTool(root, 'show-hidden');
	(all(root, (n) => n.tag === 'input' && n.props['class'] === 'dt-nav-menu-input')[0].props['onInput'] as (e: unknown) => void)({ target: { value: 'rnd' } });
	await flush();
	await pick(root, 'ok');
	assert.deepEqual(patches(), [
		{ op: 'new-folder', label: 'Clients' },
		{ op: 'show', target: { name: 'rnd' } },
	]);
});

test('the cursor: the arrow on every row, the grab hand only on a draggable one (and rows drag only unlocked)', async () => {
	const src = (await import('node:fs')).readFileSync(new URL('../../src/components/NavSidebar.vue', import.meta.url).pathname.replace('/.test-build/webview', ''), 'utf8');
	const style = src.slice(src.indexOf('<style'));
	assert.match(style, /:deep\(\.dt-nav-row\) \{[^}]*cursor: default/);
	assert.match(style, /:deep\(\.dt-nav-row\[draggable='true'\]\) \{ cursor: grab; \}/);
	assert.doesNotMatch(style, /cursor: pointer/, 'a hand cursor is left in the nav');
	assert.equal((style.match(/cursor: grab/g) ?? []).length, 1, 'grab is drawn on something other than a draggable row');
	const root = await unlocked();
	await open(root, 'layers/Layers');
	assert.equal(rowOf(root, 'c/tasks').props['draggable'], 'true');
	assert.equal(rowOf(root, 'layers/Layers').props['draggable'], undefined, 'a layer row would draw the grab hand');
});

test('arrangeBlocked disables the toggle with its reason, and locks a nav that was unlocked', async () => {
	const { defineComponent, h, ref } = await import('vue');
	const reason = ref<string | null>(null);
	const Host = defineComponent({ setup: () => () => h(NavSidebar, { arrangeBlocked: reason.value }) });
	const root = await render(Host, {}, [router()]);
	await toggleLock(root);
	assert.equal(lockOf(root).props['aria-pressed'], 'true');
	reason.value = 'Arranging the nav needs Edit';
	await flush();
	assert.equal(lockOf(root).props['aria-pressed'], 'false', 'blocking did not lock the nav');
	assert.equal(lockOf(root).props['disabled'], true);
	assert.equal(lockOf(root).props['title'], 'Arranging the nav needs Edit');
	assert.equal(rowOf(root, 'c/tasks').props['draggable'], undefined);
	await toggleLock(root);
	assert.equal(lockOf(root).props['aria-pressed'], 'false', 'a blocked toggle unlocked');
	reason.value = null;
	await flush();
	assert.equal(lockOf(root).props['disabled'], undefined);
});

// ---- the review of 838fe13 ------------------------------------------------------------------------------------------

test('the toolbar name opens the workspace settings — the root row\'s click, kept', async () => {
	const r = router();
	const root = await render(NavSidebar, {}, [r]);
	const name = all(root, (n) => hasClass(n, 'dt-nav-toolbar__settings'))[0];
	assert.equal(name?.tag, 'button', 'the name is not a button');
	(name.props['onClick'] as (e?: unknown) => void)({ stopPropagation() {} });
	await flush();
	assert.equal(r.currentRoute.value.fullPath, '/settings/schema/activity');
});

test('New folder and Show hidden… focus their text field on open, and Escape closes the menu', async () => {
	const root = await unlocked();
	for (const id of ['new-folder', 'show-hidden']) {
		focused.length = 0;
		await clickTool(root, id);
		const input = all(root, (n) => n.tag === 'input' && n.props['class'] === 'dt-nav-menu-input')[0];
		assert.ok(input, `${id} opened no text field`);
		assert.ok(focused.includes(input), `${id}: the text field is not focused`);
		// the field has two keydown listeners (Enter submits, Escape closes): a real key event reaches both
		for (const on of ([] as unknown[]).concat(input.props['onKeydown'])) (on as (e: unknown) => void)({ key: 'Escape', stopPropagation() {}, preventDefault() {} });
		await flush();
		assert.equal(all(root, (n) => String(n.props['class'] ?? '').split(' ').includes('dt-nav-menu')).length, 0, `${id}: Escape left the menu open`);
	}
	// an entry with an ask chosen from a row menu focuses its field too
	focused.length = 0;
	await menu(root, 'n/ns%3Arnd');
	await pick(root, 'new-folder');
	const input = all(root, (n) => n.tag === 'input' && n.props['class'] === 'dt-nav-menu-input')[0];
	assert.ok(focused.includes(input), 'a row menu ask is not focused');
	assert.deepEqual(patches(), []);
});

test('the toolbar sits outside the rows, and the rows container is the scroller: 32 px, the name gives way, the buttons wrap', async () => {
	const root = await render(NavSidebar, {}, [router()]);
	const nav = all(root, (n) => n.tag === 'nav')[0];
	const kids = nav.children.filter((c): c is TestNode => typeof c !== 'string');
	const toolbar = kids.find((c) => hasClass(c, 'dt-nav-toolbar'));
	const rows = kids.find((c) => hasClass(c, 'dt-nav-rows'));
	assert.ok(toolbar && rows, 'the toolbar and the rows are not both children of the nav');
	assert.ok(kids.indexOf(toolbar) < kids.indexOf(rows), 'the toolbar is not above the rows');
	assert.equal(all(rows, (n) => hasClass(n, 'dt-nav-toolbar')).length, 0, 'the toolbar scrolls with the rows');
	assert.equal(all(rows, (n) => n.tag === 'ul' && n.props['role'] === 'tree').length, 1, 'the tree is not inside the rows container');
	assert.equal(typeof rows.props['onScroll'], 'function', 'the rows container does not report its scroll (the toolbar shadow)');
	const src = (await import('node:fs')).readFileSync(new URL('../../src/components/NavSidebar.vue', import.meta.url).pathname.replace('/.test-build/webview', ''), 'utf8');
	const rule = (sel: string) => { const m = new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(src); assert.ok(m, `no rule ${sel}`); return m[1]; };
	assert.match(rule('.dt-nav'), /display: flex; flex-direction: column;/);
	assert.match(rule('.dt-nav'), /overflow: hidden;/, 'the nav itself scrolls');
	assert.match(rule('.dt-nav-rows'), /overflow-y: auto;/, 'the rows do not scroll');
	assert.match(rule('.dt-nav-rows'), /min-height: 0;/);
	assert.match(rule('.dt-nav-toolbar'), /flex: none;/, 'the toolbar shrinks');
	assert.match(rule('.dt-nav-toolbar'), /min-height: 32px;/, 'the toolbar is not the page header\'s 32 px');
	assert.match(rule('.dt-nav-toolbar--scrolled'), /box-shadow/);
	assert.match(rule('.dt-nav-toolbar__name'), /flex: 1 1 0; min-width: 0;/, 'the name does not give way first');
	assert.match(rule('.dt-nav-toolbar__buttons'), /flex: 0 1 auto; min-width: 0; display: flex; flex-wrap: wrap;/, 'the buttons do not wrap');
	const header = (await import('node:fs')).readFileSync(new URL('../../src/components/PageHeader.vue', import.meta.url).pathname.replace('/.test-build/webview', ''), 'utf8');
	assert.match(header, /\.dt-page-nav \{[^}]*height: 32px;/, 'the page header\'s first row is no longer 32 px — the toolbar no longer matches it');
});
