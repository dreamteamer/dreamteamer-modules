/**
 * Tier 1 — cr-modules-017, the h8 amendment of heldout-m017-m-page-reconnect-and-narrow-bar: after a server restart
 * the page shows the signed-out sentence ON ITS OWN, without a click. Sessions live in the server's memory only, so a
 * restarted server answers the event stream 401 and the browser gives the stream up for good — no event comes again
 * and nothing else asks. The transport notices the stream drop, asks GET /host again, and on a 401 — or on no answer
 * at all, past a few tries (the server, and every session with it, is gone) — sets `signedOut`, which App draws.
 * A stream dropped while the session still holds is opened again when the browser gave it up.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { httpTransport } from '../../src/transport/http';
import { signedOut } from '../../src/lib/host-boot';

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;
class FakeSource {
	static all: FakeSource[] = [];
	readyState = CONNECTING;
	closed = false;
	onopen?: () => unknown;
	onmessage?: (e: { data: string }) => void;
	onerror?: () => unknown;
	constructor(readonly url: string) { FakeSource.all.push(this); }
	close() { this.closed = true; this.readyState = CLOSED; }
}
/** How GET /api/host answers next: a status, or 'down' (the fetch rejects: nothing listens). */
let host: Array<number | 'down'> = [];
let asked = 0;
const win = new EventTarget() as EventTarget & Record<string, unknown>;
win.fetch = async (url: string) => {
	if (url !== '/api/host') return new Response('{}', { status: 200 });
	asked++;
	const next = host.length > 1 ? host.shift()! : host[0];
	if (next === 'down') throw new TypeError('Failed to fetch');
	return new Response(next === 200 ? JSON.stringify({ level: 'edit', chat: false, workspace: { id: 'w1', name: 'N' } }) : JSON.stringify({ error: 'sign in: ask the chat to show the pane (dt web open)' }), { status: next });
};
Object.assign(globalThis, { window: win, location: { hash: '' }, history: { replaceState() {} }, EventSource: FakeSource });

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const latest = () => FakeSource.all.at(-1)!;
/** A page whose stream opened once, as a signed-in page's does. */
async function page() {
	httpTransport({ recheckMs: 5 });
	const s = latest();
	s.readyState = OPEN;
	await s.onopen?.();
	return s;
}
beforeEach(() => { signedOut.value = false; host = [200]; asked = 0; FakeSource.all = []; });

test('a restart: the stream drops, the server is away a moment, then answers 401 — the page signs out with no click', async () => {
	const s = await page();
	host = ['down', 'down', 401];
	s.readyState = CONNECTING; // the browser retries by itself while nothing listens
	await s.onerror?.();
	await settle();
	assert.equal(signedOut.value, true, 'the signed-out sentence is drawn on its own');
	assert.ok(asked >= 1, 'GET /host was asked again');
	assert.equal(s.closed, true, 'the stream is closed: the browser stops retrying a server that signed this page out');
});

test('the restarted server refuses the stream (the browser gives it up): one re-check and the page signs out', async () => {
	const s = await page();
	host = [401];
	s.readyState = CLOSED;
	await s.onerror?.();
	await settle();
	assert.equal(signedOut.value, true);
	assert.equal(asked, 1);
});

test('a stopped server that never answers again signs the page out after a few tries — its sessions went with it', async () => {
	const s = await page();
	host = ['down'];
	s.readyState = CONNECTING;
	await s.onerror?.();
	await settle(200);
	assert.equal(signedOut.value, true);
	assert.ok(asked >= 3 && asked <= 4, `${asked} tries`);
});

test('a dropped stream whose session still holds is not signed out; a stream the browser gave up is opened again', async () => {
	const s = await page();
	host = [200];
	s.readyState = CLOSED;
	await s.onerror?.();
	await settle();
	assert.equal(signedOut.value, false);
	assert.equal(FakeSource.all.length, 2, 'a new event stream');
	assert.equal(latest().url, '/api/events');
});

test('a stream the browser is still reconnecting is left to it when the session holds', async () => {
	const s = await page();
	host = [200];
	s.readyState = CONNECTING;
	await s.onerror?.();
	await settle();
	assert.equal(signedOut.value, false);
	assert.equal(FakeSource.all.length, 1, 'no second stream beside the one the browser reopens');
});

test('errors in a burst ask once at a time', async () => {
	const s = await page();
	host = ['down', 'down', 401];
	s.readyState = CONNECTING;
	await Promise.all([s.onerror?.(), s.onerror?.(), s.onerror?.()]);
	await settle();
	assert.equal(signedOut.value, true);
	assert.equal(asked, 3, 'one re-check, not three');
});
