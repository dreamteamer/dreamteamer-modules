/**
 * Render tier — cr-modules-017 task 15 (rnd/tests/dreamteamer-modules/pane-s2-level-shown-and-lowered): the pane
 * bar. Left, the workspace as a menu of the workspaces `dt web open` registered, a pick handing the pane over; right,
 * the level chip whose menu only LOWERS — the last line sends a person to the chat for a raise. The bar talks to the
 * server's own /_dt/ routes through the browser's fetch (they are not protocol routes), so this tier stubs fetch.
 */
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, unmountAll, type TestNode } from './render';
import PaneBar from '../../src/components/PaneBar.vue';
import { hostInfo, paneHost } from '../../src/lib/host-boot';

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

let hostLevel = 'edit';
beforeEach(() => {
	resetHost();
	calls = [];
	hostLevel = 'edit';
	hostInfo.value = { level: 'edit', chat: true, workspace: { id: 'a1b2c3d4e5f60718', name: 'Northwind' } };
	onHostRequest((method, path) => {
		if (method === 'GET' && path === '/host') return { level: hostLevel, chat: true, workspace: { id: 'a1b2c3d4e5f60718', name: 'Northwind' } };
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

const byClass = (root: TestNode, c: string) => all(root, (n) => hasClass(n, c));
const click = async (n: TestNode) => { (n.props['onClick'] as (e?: unknown) => void)({ stopPropagation() {} }); await flush(); };
const words = (n: TestNode | null) => (n ? text(n).replace(/\s+/g, ' ').trim() : '');

test('the chip reads the level; its menu offers only lower levels and no raise', async () => {
	const root = await render(PaneBar);
	const chip = byClass(root, 'dt-pane-bar__chip')[0];
	assert.equal(words(chip), 'Edit');
	await click(chip);
	const lowers = byClass(root, 'dt-pane-bar__lower');
	assert.deepEqual(lowers.map(words), ['Read']);
	assert.equal(lowers.some((n) => /Admin/.test(words(n))), false, 'no raise item');
	assert.equal(words(byClass(root, 'dt-pane-bar__hint')[0]), 'To raise it, ask in the chat');
});

test('choosing Read posts { level: "read" } to /_dt/level and reloads GET /host', async () => {
	const root = await render(PaneBar);
	await click(byClass(root, 'dt-pane-bar__chip')[0]);
	await click(byClass(root, 'dt-pane-bar__lower')[0]);
	const post = calls.find((c) => c.method === 'POST' && c.url === '/_dt/level');
	assert.deepEqual(post?.body, { level: 'read' });
	assert.equal(post?.credentials, 'same-origin');
	assert.equal(post?.type, 'application/json');
	assert.equal(hostInfo.value?.level, 'read', 'GET /host asked again');
	assert.equal(words(byClass(root, 'dt-pane-bar__chip')[0]), 'Read');
});

test('a raised level draws its notice beside the chip', async () => {
	hostInfo.value = { level: 'admin', chat: true, workspace: { id: 'a1b2c3d4e5f60718', name: 'Northwind' }, raisedAt: new Date().toISOString() };
	const root = await render(PaneBar);
	assert.match(words(byClass(root, 'dt-pane-bar__notice')[0]), /^Admin since \d\d:\d\d — opened from the chat$/);
});

test('the switcher lists the workspaces; choosing another posts /_dt/handoff and goes to its URL', async () => {
	const root = await render(PaneBar);
	const ws = byClass(root, 'dt-pane-bar__ws-button')[0];
	assert.equal(words(ws), 'Northwind');
	await click(ws);
	const items = byClass(root, 'dt-pane-bar__ws-item');
	assert.equal(items.length, 2);
	assert.equal(items[0].props['aria-checked'], 'true', 'the current one is checked');
	assert.match(words(items[1]), /^Harbor starts when opened$/, 'a stopped one is marked');
	await click(items[1]);
	const post = calls.find((c) => c.method === 'POST' && c.url === '/_dt/handoff');
	assert.deepEqual(post?.body, { id: 'ffeeddccbbaa0011' });
	assert.equal(w.location.href, 'http://127.0.0.1:4200/sign-in/abc');
});

test('a refused handoff shows its sentence in the bar', async () => {
	answers['POST /_dt/handoff'] = () => ({ status: 409, body: { error: 'Harbor: its folder is gone' } });
	w.location.href = 'unchanged';
	const root = await render(PaneBar);
	await click(byClass(root, 'dt-pane-bar__ws-button')[0]);
	await click(byClass(root, 'dt-pane-bar__ws-item')[1]);
	assert.equal(words(find(root, (n) => hasClass(n, 'dt-pane-bar__error'))), 'Harbor: its folder is gone');
	assert.equal(w.location.href, 'unchanged');
});

test('a host answering no workspace id (the editor) draws no pane bar: App gates it on paneHost()', async () => {
	hostInfo.value = { level: 'admin', chat: false, workspace: { name: 'x' } };
	assert.equal(paneHost(), false);
	const src = (await import('node:fs')).readFileSync(new URL('../../src/App.vue', import.meta.url).pathname.replace('/.test-build/webview', ''), 'utf8');
	assert.match(src, /<PaneBar v-if="paneHost\(\)" \/>/);
	assert.match(src, /dt:host/, 'App refetches GET /host on dt:host');
});

test('with only the current workspace registered the switcher shows it checked and says no other was opened', async () => {
	answers['GET /_dt/workspaces'] = () => ({ status: 200, body: [{ id: 'a1b2c3d4e5f60718', name: 'Northwind', running: true, current: true }] });
	const root = await render(PaneBar);
	await click(byClass(root, 'dt-pane-bar__ws-button')[0]);
	const items = byClass(root, 'dt-pane-bar__ws-item');
	assert.deepEqual(items.map(words), ['Northwind']);
	assert.equal(items[0].props['aria-checked'], 'true');
	assert.deepEqual(byClass(root, 'dt-pane-bar__hint').map(words), ['No other workspace was opened on this machine']);
});

test('with another workspace in the list there is no such line', async () => {
	const root = await render(PaneBar);
	await click(byClass(root, 'dt-pane-bar__ws-button')[0]);
	assert.equal(byClass(root, 'dt-pane-bar__ws-item').length, 2);
	assert.deepEqual(byClass(root, 'dt-pane-bar__hint').map(words), []);
});
