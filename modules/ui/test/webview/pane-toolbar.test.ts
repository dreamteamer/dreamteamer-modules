/**
 * Render tier — cr-modules-017 task 15 (rnd/tests/dreamteamer-modules/pane-s2-level-shown-and-lowered), as the
 * 2026-11-14 16:30 revision placed it: no bar above the page; the pane's controls are in the nav's toolbar. The
 * workspace name is the switcher (a menu of the workspaces `dt web open` registered, a pick handing the pane over);
 * the level is an icon at the toolbar's right end, after the arrange lock, whose menu only LOWERS — the last line sends
 * a person to the chat for a raise. Arranging needs Edit. The controls talk to the server's own /_dt/ routes through
 * the browser's fetch (they are not protocol routes), so this tier stubs fetch.
 */
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, unmountAll, type TestNode } from './render';
import AppNav from '../../src/components/AppNav.vue';
import { hostInfo, paneHost } from '../../src/lib/host-boot';
import { paneMenu } from '../../src/lib/pane-api';

const w = ((globalThis as { window?: any }).window ??= { addEventListener() {}, removeEventListener() {} });
w.location = { href: 'http://127.0.0.1:4100/app/#/content/tasks' };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

type Call = { url: string; method: string; body?: unknown; credentials?: string; type?: string };
let calls: Call[] = [];
let answers: Record<string, () => { status: number; body: unknown }> = {};
const fetchStub = async (url: string, init: RequestInit = {}) => {
	const method = init.method ?? 'GET';
	calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined, credentials: init.credentials, type: (init.headers as Record<string, string> | undefined)?.['Content-Type'] });
	const a = answers[`${method} ${url}`]?.() ?? { status: 404, body: { error: `no route ${method} ${url}` } };
	return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } });
};
(globalThis as { fetch?: unknown }).fetch = fetchStub;
w.fetch = fetchStub;

const NAV = [{ kind: 'workspace', key: 'workspace', label: 'northwind-hq', children: [{ kind: 'collection', key: 'c/tasks', label: 'Tasks', target: { name: 'tasks' }, route: '/content/tasks' }] }];
let hostLevel = 'edit';
beforeEach(() => {
	resetHost();
	calls = [];
	hostLevel = 'edit';
	paneMenu.value = null;
	delete w.innerWidth;
	hostInfo.value = { level: 'edit', chat: true, workspace: { id: 'a1b2c3d4e5f60718', name: 'Northwind' } };
	onHostRequest((method, path) => {
		if (method === 'GET' && path === '/host') return { level: hostLevel, chat: true, workspace: { id: 'a1b2c3d4e5f60718', name: 'Northwind' } };
		if (method === 'GET' && path === '/nav') return NAV;
		throw new Error(`unexpected ${method} ${path}`);
	});
	answers = {
		'GET /_dt/workspaces': () => ({ status: 200, body: [
			{ id: 'a1b2c3d4e5f60718', name: 'Northwind', running: true, current: true },
			{ id: 'ffeeddccbbaa0011', name: 'Harbor', running: false, current: false },
		] }),
		'POST /_dt/level': () => { hostLevel = 'read'; return { status: 200, body: { level: 'read' } }; },
		'POST /_dt/handoff': () => ({ status: 200, body: { url: 'http://127.0.0.1:4200/sign-in/abc' } }),
	};
});
afterEach(() => unmountAll());

const router = () => createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
const mount = () => render(AppNav, {}, [router()]);
const byClass = (root: TestNode, c: string) => all(root, (n) => hasClass(n, c));
const click = async (n: TestNode, e: Record<string, unknown> = {}) => { (n.props['onClick'] as (e?: unknown) => void)({ stopPropagation() {}, ...e }); await flush(); };
const words = (n: TestNode | null) => (n ? text(n).replace(/\s+/g, ' ').trim() : '');
const levelIcon = (root: TestNode) => { const b = byClass(root, 'dt-pane-level')[0]; assert.ok(b, 'no level icon in the toolbar'); return b; };
const glyph = (n: TestNode) => String(all(n, (x) => hasClass(x, 'codicon'))[0]?.props['class'] ?? '');
const lockOf = (root: TestNode) => all(root, (n) => n.tag === 'button' && n.props['data-tool'] === 'arrange')[0];

test('the level is an icon with no text at the toolbar\'s right end, after the arrange lock; its menu offers only lower levels', async () => {
	const root = await mount();
	const icon = levelIcon(root);
	assert.equal(words(icon), '', 'the level icon has text');
	assert.equal(icon.props['data-level'], 'edit');
	assert.equal(icon.props['aria-label'], 'Level: Edit');
	assert.equal(icon.props['title'], 'Level: Edit');
	assert.match(glyph(icon), /codicon-edit/);
	const buttons = byClass(root, 'dt-nav-toolbar__buttons')[0].children.filter((c): c is TestNode => typeof c !== 'string' && c.tag === 'button');
	assert.deepEqual(buttons.map((b) => (hasClass(b, 'dt-pane-level') ? 'level' : b.props['data-tool'])), ['arrange', 'level'], 'the level is not right after the lock');
	await click(icon);
	const lowers = byClass(root, 'dt-pane-level__lower');
	assert.deepEqual(lowers.map(words), ['Read']);
	assert.equal(lowers.some((n) => /Admin/.test(words(n))), false, 'no raise item');
	assert.equal(words(byClass(root, 'dt-pane-menu__hint')[0]), 'To raise it, ask in the chat');
});

test('choosing Read posts { level: "read" } to /_dt/level, reloads GET /host, and the icon becomes the eye', async () => {
	const root = await mount();
	await click(levelIcon(root));
	await click(byClass(root, 'dt-pane-level__lower')[0]);
	const post = calls.find((c) => c.method === 'POST' && c.url === '/_dt/level');
	assert.deepEqual(post?.body, { level: 'read' });
	assert.equal(post?.credentials, 'same-origin');
	assert.equal(post?.type, 'application/json');
	assert.equal(hostInfo.value?.level, 'read', 'GET /host asked again');
	assert.equal(levelIcon(root).props['data-level'], 'read');
	assert.equal(levelIcon(root).props['title'], 'Level: Read');
	assert.match(glyph(levelIcon(root)), /codicon-eye\b/);
	assert.equal(byClass(root, 'dt-pane-level__menu').length, 0, 'the menu stayed open');
});

test('a raised level: the shield in the warning colour, its notice in the tooltip and at the top of the menu', async () => {
	hostInfo.value = { level: 'admin', chat: true, workspace: { id: 'a1b2c3d4e5f60718', name: 'Northwind' }, raisedAt: new Date().toISOString() };
	const root = await mount();
	const icon = levelIcon(root);
	assert.equal(icon.props['data-level'], 'admin');
	assert.match(glyph(icon), /codicon-shield/);
	assert.match(String(icon.props['title']), /^Level: Admin — Admin since \d\d:\d\d — opened from the chat$/);
	await click(icon);
	const menu = byClass(root, 'dt-pane-level__menu')[0];
	const first = menu.children.filter((c): c is TestNode => typeof c !== 'string' && c.tag !== '#comment' && c.tag !== '#text')[0];
	assert.ok(hasClass(first, 'dt-pane-menu__notice'), 'the notice is not at the top of the menu');
	assert.match(words(first), /^Admin since \d\d:\d\d — opened from the chat$/);
	assert.deepEqual(byClass(root, 'dt-pane-level__lower').map(words), ['Edit', 'Read']);
	const src = (await import('node:fs')).readFileSync(new URL('../../src/components/PaneLevel.vue', import.meta.url).pathname.replace('/.test-build/webview', ''), 'utf8');
	assert.match(src, /\.dt-pane-level\[data-level='admin'\] \{ color: var\(--dt-warning\); \}/);
});

test('a refused lower shows its sentence inside the level menu', async () => {
	answers['POST /_dt/level'] = () => ({ status: 403, body: { error: 'the page cannot raise the level' } });
	const root = await mount();
	await click(levelIcon(root));
	await click(byClass(root, 'dt-pane-level__lower')[0]);
	const menu = byClass(root, 'dt-pane-level__menu')[0];
	assert.ok(menu, 'the menu closed on a refusal');
	assert.equal(words(find(menu, (n) => hasClass(n, 'dt-pane-menu__error'))), 'the page cannot raise the level');
});

test('the workspace name is the switcher at the toolbar\'s left; choosing another posts /_dt/handoff and goes to its URL', async () => {
	const root = await mount();
	const name = byClass(root, 'dt-nav-toolbar__name')[0];
	const ws = byClass(name, 'dt-pane-switch')[0];
	assert.ok(ws, 'the name is not the switcher');
	assert.equal(words(ws), 'Northwind', 'the switcher names the workspace as its list does (the host\'s name), not by the nav label');
	assert.equal(byClass(root, 'dt-nav-toolbar__label').length, 0, 'the name is drawn twice');
	await click(ws);
	const items = byClass(root, 'dt-pane-switch__item');
	assert.equal(items.length, 2);
	assert.equal(items[0].props['aria-checked'], 'true', 'the current one is checked');
	assert.match(words(items[1]), /^Harbor starts when opened$/, 'a stopped one is marked');
	await click(items[1]);
	const post = calls.find((c) => c.method === 'POST' && c.url === '/_dt/handoff');
	assert.deepEqual(post?.body, { id: 'ffeeddccbbaa0011' });
	assert.equal(w.location.href, 'http://127.0.0.1:4200/sign-in/abc');
});

test('a refused handoff shows its sentence inside the switcher menu', async () => {
	answers['POST /_dt/handoff'] = () => ({ status: 409, body: { error: 'Harbor: its folder is gone' } });
	w.location.href = 'unchanged';
	const root = await mount();
	await click(byClass(root, 'dt-pane-switch')[0]);
	await click(byClass(root, 'dt-pane-switch__item')[1]);
	const menu = byClass(root, 'dt-pane-switch__menu')[0];
	assert.ok(menu, 'the menu closed on a refusal');
	assert.equal(words(find(menu, (n) => hasClass(n, 'dt-pane-menu__error'))), 'Harbor: its folder is gone');
	assert.equal(w.location.href, 'unchanged');
});

test('one menu at a time: opening the level closes the switcher', async () => {
	const root = await mount();
	await click(byClass(root, 'dt-pane-switch')[0]);
	assert.equal(byClass(root, 'dt-pane-switch__menu').length, 1);
	await click(levelIcon(root));
	assert.equal(byClass(root, 'dt-pane-switch__menu').length, 0);
	assert.equal(byClass(root, 'dt-pane-level__menu').length, 1);
});

test('a host answering no workspace id (the editor, a plain dt web): the name is plain text and there is no level', async () => {
	hostInfo.value = { level: 'admin', chat: false, workspace: { name: 'x' } };
	assert.equal(paneHost(), false);
	const root = await mount();
	assert.equal(byClass(root, 'dt-pane-switch').length, 0);
	assert.equal(byClass(root, 'dt-pane-level').length, 0);
	assert.equal(words(byClass(root, 'dt-nav-toolbar__label')[0]), 'northwind-hq');
	assert.equal(lockOf(root).props['disabled'], undefined, 'off a pane host arranging is not gated on a level');
	const src = (await import('node:fs')).readFileSync(new URL('../../src/App.vue', import.meta.url).pathname.replace('/.test-build/webview', ''), 'utf8');
	assert.match(src, /<AppNav v-if="appNav" \/>/);
	assert.doesNotMatch(src, /PaneBar/, 'App still draws a bar above the page');
	assert.match(src, /dt:host/, 'App refetches GET /host on dt:host');
});

test('with only the current workspace registered the switcher shows it checked and says no other was opened', async () => {
	answers['GET /_dt/workspaces'] = () => ({ status: 200, body: [{ id: 'a1b2c3d4e5f60718', name: 'Northwind', running: true, current: true }] });
	const root = await mount();
	await click(byClass(root, 'dt-pane-switch')[0]);
	const items = byClass(root, 'dt-pane-switch__item');
	assert.deepEqual(items.map(words), ['Northwind']);
	assert.equal(items[0].props['aria-checked'], 'true');
	assert.deepEqual(byClass(root, 'dt-pane-menu__hint').map(words), ['No other workspace was opened on this machine']);
});

test('with another workspace in the list there is no such line', async () => {
	const root = await mount();
	await click(byClass(root, 'dt-pane-switch')[0]);
	assert.equal(byClass(root, 'dt-pane-switch__item').length, 2);
	assert.deepEqual(byClass(root, 'dt-pane-menu__hint').map(words), []);
});

test('at 320 px both menus open inside the window: the switcher under the name, the level menu not off the left edge', async () => {
	w.innerWidth = 320;
	const root = await mount();
	// the nav is ~102 px wide at 320: the name starts at 10, the level icon ends at 100
	await click(byClass(root, 'dt-pane-switch')[0], { currentTarget: { getBoundingClientRect: () => ({ left: 10, right: 60, top: 4, bottom: 28 }) } });
	const sw = byClass(root, 'dt-pane-switch__menu')[0].props['style'] as Record<string, string>;
	assert.deepEqual(sw, { left: '10px', top: '30px' });
	await click(levelIcon(root), { currentTarget: { getBoundingClientRect: () => ({ left: 76, right: 100, top: 4, bottom: 28 }) } });
	const lv = byClass(root, 'dt-pane-level__menu')[0].props['style'] as Record<string, string>;
	assert.deepEqual(lv, { left: '4px', top: '30px' }, 'a 220 px menu hung from the right end of a 102 px nav would open off-screen');
	// wide: the level menu's end lines up with the icon's
	paneMenu.value = null;
	await flush();
	w.innerWidth = 1200;
	await click(levelIcon(root), { currentTarget: { getBoundingClientRect: () => ({ left: 232, right: 256, top: 4, bottom: 28 }) } });
	assert.deepEqual(byClass(root, 'dt-pane-level__menu')[0].props['style'], { left: '36px', top: '30px' });
});

test('arranging needs Edit: at Read the lock is disabled saying so; a lower to Read while unlocked locks the nav', async () => {
	const root = await mount();
	await click(lockOf(root));
	assert.equal(lockOf(root).props['aria-pressed'], 'true', 'at Edit the nav unlocks');
	const row = () => all(root, (n) => n.tag === 'li' && n.props['data-key'] === 'c/tasks')[0];
	assert.equal(row().props['draggable'], 'true');
	await click(levelIcon(root));
	await click(byClass(root, 'dt-pane-level__lower')[0]);
	assert.equal(hostInfo.value?.level, 'read');
	assert.equal(lockOf(root).props['aria-pressed'], 'false', 'lowering to Read left the nav unlocked');
	assert.equal(lockOf(root).props['disabled'], true);
	assert.equal(lockOf(root).props['title'], 'Arranging the nav needs Edit');
	assert.equal(row().props['draggable'], undefined);
	await click(lockOf(root));
	assert.equal(lockOf(root).props['aria-pressed'], 'false', 'a Read pane unlocked the nav');
	assert.equal(byClass(root, 'dt-nav-tool').filter((b) => b.props['data-tool'] === 'new-folder').length, 0);
});

test('a page opened at Read starts with the lock disabled', async () => {
	hostInfo.value = { level: 'read', chat: true, workspace: { id: 'a1b2c3d4e5f60718', name: 'Northwind' } };
	const root = await mount();
	assert.equal(lockOf(root).props['disabled'], true);
	assert.equal(lockOf(root).props['title'], 'Arranging the nav needs Edit');
	assert.match(glyph(levelIcon(root)), /codicon-eye\b/);
});
