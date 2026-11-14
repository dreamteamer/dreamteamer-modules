/**
 * Render tier — cr-modules-017 task 17 (rnd/tests/dreamteamer-modules/pane-s4-ask-in-chat-from-the-page): beside
 * Copy, Ask in chat queues the picked command for the next prompt of the chat (`POST /queue`), and the section lists
 * the queue's items for this collection — Waiting, then Delivered <time> once a hook took it, Expired an hour on.
 * Offered only when GET /host says a hook ran here in the last 24 hours (`chat: true`). Synthetic names only.
 */
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { onHostRequest, requests, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, unmountAll, type TestNode } from './render';
import { invalidateContract } from '../../src/api/adapter';
import CommandsSection from '../../src/components/sidebar/CommandsSection.vue';
import { hostInfo } from '../../src/lib/host-boot';

const win = new EventTarget() as EventTarget & Record<string, unknown>;
(globalThis as { window?: unknown }).window = win;
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

const ROW = { binding: 'command-bindings/close', command: 'commands/close-task', name: 'close-task', description: 'close it', 'argument-hint': null, scope: 'record', states: { a: 'available', b: 'available' }, eligible: ['a', 'b'], done: [], invocation: '/close-task tasks/a tasks/b' };
let queue: any[] = [];
let refuse: string | null = null;

beforeEach(() => {
	resetHost();
	invalidateContract();
	queue = [];
	refuse = null;
	hostInfo.value = { level: 'edit', chat: true, workspace: { id: 'a1b2c3d4e5f60718', name: 'Northwind' } };
	onHostRequest((method, path, body) => {
		if (path === '/info') return { name: 'northwind', modules: [] };
		if (method === 'GET' && path.startsWith('/commands/tasks')) return { commands: [ROW] };
		if (method === 'POST' && path === '/queue') {
			if (refuse) { const e = new Error(refuse) as Error & { status: number }; e.status = 400; throw e; }
			const b = body as { command: string; refs: string[] };
			const item = { id: `i${queue.length + 1}`, command: b.command, refs: b.refs, invocation: ROW.invocation, state: 'waiting', queuedAt: new Date().toISOString() };
			queue.unshift(item);
			return { item };
		}
		if (method === 'GET' && path === '/queue') return { items: queue.map((i) => ({ ...i })) }; // a fresh answer, as JSON is
		throw new Error(`unexpected ${method} ${path}`);
	});
});
afterEach(() => unmountAll());

const click = async (n: TestNode) => { (n.props['onClick'] as (e?: unknown) => void)(); for (let i = 0; i < 3; i++) await flush(); };
const askButton = (root: TestNode) => find(root, (n) => n.tag === 'button' && hasClass(n, 'dt-cmds__ask'));
const items = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-cmds__queue-state')).map((n) => text(n).trim());

async function picked(): Promise<TestNode> {
	const root = await render(CommandsSection, { collection: 'tasks', ids: ['a', 'b'] });
	await click(find(root, (n) => n.tag === 'button' && hasClass(n, 'dt-cmds__row'))!);
	return root;
}

test('with chat: true and a picked runnable row, Ask in chat draws; a click queues the command and its eligible refs', async () => {
	const root = await picked();
	const ask = askButton(root);
	assert.ok(ask, 'Ask in chat beside Copy');
	assert.equal(text(ask!).trim(), 'Ask in chat');
	await click(ask!);
	const post = requests.find((r) => r.method === 'POST' && r.path === '/queue');
	assert.deepEqual(post?.body, { command: 'commands/close-task', refs: ['tasks/a', 'tasks/b'] });
	assert.deepEqual(items(root), ['Waiting']);
});

test('a dt:queue refetches the list: Delivered <time>, then Expired', async () => {
	const root = await picked();
	await click(askButton(root)!);
	queue[0] = { ...queue[0], state: 'delivered', deliveredAt: new Date().toISOString() };
	win.dispatchEvent(new MessageEvent('message', { data: { type: 'dt:queue' } }));
	for (let i = 0; i < 3; i++) await flush();
	assert.match(items(root)[0], /^Delivered \d\d:\d\d$/);
	queue[0] = { ...queue[0], state: 'expired' };
	win.dispatchEvent(new MessageEvent('message', { data: { type: 'dt:queue' } }));
	for (let i = 0; i < 3; i++) await flush();
	assert.deepEqual(items(root), ['Expired']);
});

test('with chat: false (the editor, or no hook in 24 hours) there is no Ask in chat', async () => {
	hostInfo.value = { level: 'edit', chat: false, workspace: { id: 'a1b2c3d4e5f60718', name: 'Northwind' } };
	const root = await picked();
	assert.equal(askButton(root), null);
	hostInfo.value = null;
	await flush();
	assert.equal(askButton(root), null, 'the editor: no host info at all');
});

test('a refusal shows the host\'s sentence', async () => {
	refuse = 'commands/close-task is not available for these records';
	const root = await picked();
	await click(askButton(root)!);
	assert.equal(text(find(root, (n) => hasClass(n, 'dt-cmds__error'))!).trim(), 'commands/close-task is not available for these records');
});
