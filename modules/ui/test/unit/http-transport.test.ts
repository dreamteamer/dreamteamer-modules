/**
 * Tier 1 — the HTTP transport (`src/transport/http.ts`) over a stand-in window: requests on the
 * browser's own fetch (never the patched one — that loops), errors as HostError, the hash as the route,
 * and server-sent events delivered as window messages.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { httpTransport } from '../../src/transport/http';
import { HostError } from '../../src/transport/types';

const calls: Array<{ url: string; init: RequestInit }> = [];
const replaced: string[] = [];
const opened: string[] = [];
let source: { onmessage?: (e: { data: string }) => void; onopen?: () => void } = {};

const win = new EventTarget() as EventTarget & Record<string, unknown>;
win.fetch = async (url: string, init: RequestInit) => {
	calls.push({ url, init });
	if (url === '/api/missing') return new Response(JSON.stringify({ error: 'no such record' }), { status: 404 });
	return new Response(JSON.stringify({ ok: url }), { status: 200 });
};
win.open = (url: string) => void opened.push(url);
win.__DT_FILES__ = 'http://127.0.0.1:9/key';
Object.assign(globalThis, {
	window: win,
	location: { hash: '#/collections/tasks' },
	history: { replaceState: (_s: unknown, _t: string, url: string) => void replaced.push(url) },
	EventSource: class {
		constructor(url: string) {
			assert.equal(url, '/api/events');
			source = this as typeof source;
		}
	},
});

const messages: unknown[] = [];
win.addEventListener('message', (e) => messages.push((e as MessageEvent).data));
const transport = httpTransport();
// what mount does next: patch fetch so module bundles reach the host — the transport must not call this
win.fetch = () => {
	throw new Error('the transport called the patched fetch');
};

test('a request goes to /api on the fetch taken when the transport was made, with a JSON body', async () => {
	assert.deepEqual(await transport.request('POST', '/collections/tasks/records', { name: 'Brief Dana' }), { ok: '/api/collections/tasks/records' });
	const last = calls.at(-1)!;
	assert.equal(last.init.method, 'POST');
	assert.equal(last.init.credentials, 'same-origin');
	assert.equal(last.init.body, '{"name":"Brief Dana"}');
});

test('a refusal is a HostError with the status and the server\'s words', async () => {
	await assert.rejects(transport.request('GET', '/missing'), (e: unknown) => e instanceof HostError && e.status === 404 && e.message === 'no such record');
});

test('the hash is the route: mounted answers with it, a route change writes it, a hashchange navigates', () => {
	messages.length = 0;
	transport.notify('dt:mounted');
	transport.notify('dt:route', { route: '/collections/notes' });
	win.dispatchEvent(new Event('hashchange'));
	assert.deepEqual(messages, [{ type: 'dt:navigate', route: '/collections/tasks' }, { type: 'dt:navigate', route: '/collections/tasks' }]);
	assert.deepEqual(replaced, ['#/collections/notes']);
});

test('a file opens on the files origin, a route in a new tab', () => {
	transport.notify('dt:open-file', { path: 'data/notes/a b.md' });
	transport.notify('dt:open', { route: '/collections/tasks' });
	assert.deepEqual(opened, ['http://127.0.0.1:9/key/w/data/notes/a%20b.md?frame=1', '#/collections/tasks']);
});

test('a server-sent event arrives as a window message', () => {
	messages.length = 0;
	source.onmessage?.({ data: '{"type":"dt:invalidate","scope":"data"}' });
	source.onmessage?.({ data: 'not json' });
	assert.deepEqual(messages, [{ type: 'dt:invalidate', scope: 'data' }]);
});

test('a reconnected event stream refetches: what changed while it was down is never missed', () => {
	messages.length = 0;
	source.onopen?.();
	assert.deepEqual(messages, [], 'the first open is not a change');
	source.onopen?.();
	assert.deepEqual(messages, [{ type: 'dt:invalidate', scope: 'schema' }]);
});
