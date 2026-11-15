// The pane routes' validation and state (cr-modules-017 §5), over a stub api: the shapes a view may take, the
// 50-ref bound, namespaced refs, the place a view renders to, a queued command's availability, and expiry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_REFS, QUEUE_TTL_MS, validateSelection, validateQueue, renderPlace, expireQueue, memoryPane } from '../src/pane.js';

const NAMESPACES = ['rnd'];
// the seam the implementation reads refs through — engine().parseRef in a host; a stub here
const parseRef = (ref) => {
	const parts = String(ref).split('/');
	const ns = NAMESPACES.includes(parts[0]) ? 2 : 1;
	if (parts.length <= ns) return null;
	return { collection: parts.slice(0, ns).join('/'), id: parts.slice(ns).join('/') };
};
const records = new Set([
	...Array.from({ length: 60 }, (_, i) => `/collections/tasks/records/t${i}`),
	'/collections/tasks/records/2026/11/nested',
	'/collections/rnd%2Fchange-requests/records/cr-x',
	'/collections/ui-views/records/board',
]);
const calls = [];
const api = {
	descriptors: () => new Map([['tasks', {}], ['rnd/change-requests', {}], ['ui-views', {}]]),
	handle: async (method, path) => {
		calls.push(`${method} ${path}`);
		if (method === 'GET' && records.has(path)) return { status: 200, body: { id: path.split('/records/')[1], fields: {} } };
		const cmd = /^\/commands\/tasks\?ids=(.*)$/.exec(path);
		if (method === 'GET' && cmd) {
			const ids = cmd[1].split(',').map(decodeURIComponent);
			return { status: 200, body: { collection: 'tasks', ids, commands: [
				{ command: 'commands/close-task', name: 'close-task', scope: 'record', invocation: `/close-task ${ids.map((i) => `tasks/${i}`).join(' ')}` },
				{ command: 'commands/never', name: 'never', scope: 'record', invocation: null },
			] } };
		}
		return { status: 404, body: { error: `no such record ${path}` } };
	},
};
const sel = (body) => validateSelection(api, body, { parseRef });
const queue = (body) => validateQueue(api, body, { parseRef });

test('each of the four view shapes is accepted', async () => {
	assert.deepEqual(await sel({ view: { collection: 'tasks' }, refs: [] }), { ok: true, value: { view: { collection: 'tasks' }, refs: [] } });
	assert.equal((await sel({ view: { collection: 'tasks', id: 't1' }, refs: [] })).ok, true);
	assert.equal((await sel({ view: { collection: 'tasks', id: '2026/11/nested' }, refs: [] })).ok, true);
	assert.equal((await sel({ view: { collection: 'rnd/change-requests', id: 'cr-x' }, refs: [] })).ok, true);
	assert.equal((await sel({ view: { uiView: 'board' }, refs: [] })).ok, true);
	assert.deepEqual(await sel({ view: { other: true }, refs: ['tasks/t1'] }), { ok: true, value: { view: { other: true }, refs: ['tasks/t1'] } });
});

test('anything outside the four shapes is refused with the shape sentence', async () => {
	const SHAPE = 'a view is { collection }, { collection, id }, { uiView } or { other: true }';
	for (const view of [{ collection: 'tasks', extra: 1 }, { url: '#/x' }, 'tasks', null, [], { other: 1 }, { other: true, collection: 'tasks' }, { collection: 1 }]) {
		const r = await sel({ view, refs: [] });
		assert.deepEqual(r, { ok: false, error: SHAPE }, JSON.stringify(view));
	}
	assert.equal((await sel({ view: { collection: 'tasks' }, refs: [], extra: 1 })).ok, false);
	assert.equal((await sel({ view: { collection: 'tasks' } })).ok, false);
	assert.equal((await sel(null)).ok, false);
	assert.equal((await sel({ view: { collection: 'nope' }, refs: [] })).error, 'no collection nope');
	assert.equal((await sel({ view: { collection: 'tasks', id: 'gone' }, refs: [] })).error, 'no record tasks/gone');
	assert.equal((await sel({ view: { uiView: 'gone' }, refs: [] })).error, 'no ui-view gone');
});

test('50 refs are accepted, 51 refused; a namespaced ref splits at its prefix; a missing record is named', async () => {
	const fifty = Array.from({ length: MAX_REFS }, (_, i) => `tasks/t${i}`);
	assert.equal(MAX_REFS, 50);
	assert.equal((await sel({ view: { collection: 'tasks' }, refs: fifty })).ok, true);
	assert.deepEqual(await sel({ view: { collection: 'tasks' }, refs: [...fifty, 'tasks/t50'] }), { ok: false, error: 'more than 50 refs' });
	calls.length = 0;
	assert.equal((await sel({ view: { collection: 'tasks' }, refs: ['rnd/change-requests/cr-x'] })).ok, true);
	assert.deepEqual(calls, ['GET /collections/rnd%2Fchange-requests/records/cr-x']);
	assert.deepEqual(await sel({ view: { collection: 'tasks' }, refs: ['rnd/change-requests/cr-y'] }), { ok: false, error: 'no record rnd/change-requests/cr-y' });
	assert.deepEqual(await sel({ view: { collection: 'tasks' }, refs: ['nope/x'] }), { ok: false, error: 'no record nope/x' });
	assert.equal((await sel({ view: { collection: 'tasks' }, refs: [7] })).ok, false);
	assert.equal((await sel({ view: { collection: 'tasks' }, refs: 'tasks/t1' })).ok, false);
});

test('renderPlace names collections, record refs and ui-view ids — a title only when given', () => {
	assert.equal(renderPlace({ collection: 'tasks' }), 'tasks · List');
	assert.equal(renderPlace({ collection: 'rnd/change-requests', id: 'cr-x' }), 'rnd/change-requests/cr-x');
	assert.equal(renderPlace({ uiView: 'board' }), 'board · View');
	assert.equal(renderPlace({ uiView: 'board' }, () => 'The board'), 'The board · View');
	assert.equal(renderPlace({ other: true }), null);
	assert.equal(renderPlace(null), null);
});

test('expireQueue turns a waiting item older than an hour into expired and leaves a delivered one', () => {
	const now = Date.parse('2026-11-14T12:00:00Z');
	const old = new Date(now - QUEUE_TTL_MS - 1).toISOString();
	const fresh = new Date(now - 1000).toISOString();
	const items = [
		{ id: 'a', command: 'c', refs: [], invocation: '/c', state: 'waiting', queuedAt: old },
		{ id: 'b', command: 'c', refs: [], invocation: '/c', state: 'delivered', queuedAt: old, deliveredAt: old },
		{ id: 'c', command: 'c', refs: [], invocation: '/c', state: 'waiting', queuedAt: fresh },
	];
	assert.deepEqual(expireQueue(items, now).map((i) => i.state), ['expired', 'delivered', 'waiting']);
	assert.equal(items[0].state, 'waiting', 'expireQueue does not mutate its input');
	assert.equal(QUEUE_TTL_MS, 3_600_000);
});

test('validateQueue carries the bound row\'s invocation; refuses two collections and an unavailable command', async () => {
	const r = await queue({ command: 'commands/close-task', refs: ['tasks/t1', 'tasks/t2'] });
	assert.deepEqual(r, { ok: true, value: { command: 'commands/close-task', refs: ['tasks/t1', 'tasks/t2'], invocation: '/close-task tasks/t1 tasks/t2' } });
	assert.equal((await queue({ command: 'commands/close-task', refs: ['tasks/t1', 'rnd/change-requests/cr-x'] })).ok, false);
	assert.deepEqual(await queue({ command: 'commands/never', refs: ['tasks/t1'] }), { ok: false, error: 'commands/never is not available for these records' });
	assert.deepEqual(await queue({ command: 'commands/nope', refs: ['tasks/t1'] }), { ok: false, error: 'commands/nope is not available for these records' });
	assert.equal((await queue({ command: 'commands/close-task', refs: [] })).ok, false);
	assert.equal((await queue({ command: 'commands/close-task', refs: ['tasks/t1'], extra: 1 })).ok, false);
	assert.equal((await queue({ refs: ['tasks/t1'] })).ok, false);
});

test('memoryPane: the selection round-trips; the queue is newest first, at most 20, expiry on read', async () => {
	let t = Date.parse('2026-11-14T12:00:00Z');
	const pane = memoryPane({ host: () => ({ level: 'admin', chat: false, workspace: { name: 'w' } }), now: () => t });
	assert.deepEqual(pane.getSelection(), { view: null, refs: [], place: null, at: null });
	pane.putSelection({ view: { collection: 'tasks' }, refs: ['tasks/t1'], place: 'tasks · List', at: 'x' });
	assert.deepEqual(pane.getSelection(), { view: { collection: 'tasks' }, refs: ['tasks/t1'], place: 'tasks · List', at: 'x' });
	const first = pane.addQueue({ command: 'commands/close-task', refs: ['tasks/t1'], invocation: '/close-task tasks/t1' });
	assert.equal(first.state, 'waiting');
	assert.equal(typeof first.id, 'string');
	for (let i = 0; i < 24; i++) { t += 1000; pane.addQueue({ command: 'c', refs: [], invocation: `/c ${i}` }); }
	const items = pane.getQueue(t);
	assert.equal(items.length, 20);
	assert.equal(items[0].invocation, '/c 23');
	assert.equal(pane.getQueue(t + QUEUE_TTL_MS + 1)[0].state, 'expired');
	assert.deepEqual(await pane.host(), { level: 'admin', chat: false, workspace: { name: 'w' } });
});
