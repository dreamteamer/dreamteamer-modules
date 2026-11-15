// A stable port, a restart that signs the pane out, the idle stop (cr-modules-017 §2 as the security sign-off revised
// it — decisions/2026-11-14--the-pane-re-pairs-after-every-server-restart-sessions-live-in-memory-only;
// rnd/tests/dreamteamer-modules/pane-a2-restart-keeps-the-pane, server half): the second start reuses the stored port,
// the pane's old cookie is refused 401 with the signed-out sentence and a new pairing signs it in again; a pairing code
// dies with its process; a stored port another process holds moves the server and says where from; the server stops
// after its idle minutes with no page and no bearer request, and that stop signs the pane out too; the state file
// never holds a session — neither a sid nor its hash.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { startWeb } from '../src/server.js';
import { readWorkspaceState } from '../src/state.js';
import { movedLine } from '../src/runtime.js';
import { fixture, call, pair, sameOrigin } from './support.mjs';

const SIGNED_OUT = 'sign in: ask the chat to show the pane (dt web open)';

let f;
const open = [];
before(() => { f = fixture(); });
after(async () => { for (const w of open) await w.close(); f?.cleanupAll(); });

const start = async (o = {}) => { const w = await startWeb({ root: f.root, appDir: f.app, idleMinutes: 0, stateDir: f.state, ...o }); open.push(w); return w; };
const host = (w, cookie) => call(`${w.url}/api/host`, { headers: { cookie, ...sameOrigin() } });
const stateText = () => fs.readdirSync(f.state).filter((n) => n.endsWith('.json')).map((n) => fs.readFileSync(path.join(f.state, n), 'utf8')).join('\n');
const sidOf = (cookie) => cookie.split('=')[1];

describe('a restart', () => {
	test('reuses the stored port; the old cookie is refused with the signed-out sentence; a new pairing signs in; a code minted before is refused after', async () => {
		const a = await start();
		assert.equal(readWorkspaceState(f.root, f.state).port, a.port, 'the port is stored at once');
		const cookie = await pair(a);
		assert.equal((await host(a, cookie)).status, 200);
		const code = a.pair();
		await a.close();
		const b = await start();
		assert.equal(b.port, a.port);
		assert.equal(b.movedFrom, undefined);
		const r = await host(b, cookie);
		assert.equal(r.status, 401, 'a restart signs the pane out');
		assert.equal(r.json.error, SIGNED_OUT);
		const late = await call(code);
		assert.equal(late.status, 401, 'a code lives in one process');
		const again = await pair(b);
		assert.equal((await host(b, again)).status, 200, 'dt web open pairs it again');
		assert.equal(stateText().includes(sidOf(cookie)), false);
		assert.equal(stateText().includes(sidOf(again)), false);
		assert.equal('sessions' in readWorkspaceState(f.root, f.state), false, 'the state holds no session');
		assert.doesNotMatch(stateText(), /"sessions"/);
		await b.close();
	});

	test('a stored port another process holds: the server moves, says from where, and the old cookie is refused', async () => {
		const a = await start();
		const cookie = await pair(a);
		const old = a.port;
		await a.close();
		const squatter = net.createServer();
		await new Promise((r, j) => { squatter.once('error', j); squatter.listen(old, '127.0.0.1', r); });
		try {
			const b = await start();
			assert.notEqual(b.port, old);
			assert.equal(b.movedFrom, old);
			assert.equal(movedLine(old, b.port), `port ${old} was taken; moved to ${b.port} — open the pane again: dt web open`);
			assert.equal(readWorkspaceState(f.root, f.state).port, b.port, 'the new port is stored at once');
			const r = await host(b, cookie);
			assert.equal(r.status, 401);
			assert.equal(r.json.error, SIGNED_OUT);
			assert.equal((await host(b, `dt_pane_${b.port}=${sidOf(cookie)}`)).status, 401, 'the sid itself is gone, not only its cookie name');
			const fresh = await pair(b);
			assert.equal((await host(b, fresh)).status, 200);
			assert.equal(stateText().includes(sidOf(fresh)), false);
			await b.close();
		} finally { await new Promise((r) => squatter.close(r)); }
	});

	test('an explicit port that is taken is an error naming it — the person chose it', async () => {
		const squatter = net.createServer();
		await new Promise((r) => squatter.listen(0, '127.0.0.1', r));
		try {
			await assert.rejects(start({ port: squatter.address().port }), /EADDRINUSE|in use/);
		} finally { await new Promise((r) => squatter.close(r)); }
	});
});

describe('the idle stop', () => {
	test('no page and no bearer request: it stops with idle, and the next start has the pane signed out', async () => {
		const w = await start({ idleMinutes: 0.01 });
		const cookie = await pair(w);
		const why = await Promise.race([w.closed, new Promise((r) => setTimeout(() => r('still up'), 3000))]);
		assert.equal(why, 'idle');
		const b = await start();
		assert.equal(b.port, w.port);
		const r = await host(b, cookie);
		assert.equal(r.status, 401, 'an idle stop signs the pane out');
		assert.equal(r.json.error, SIGNED_OUT);
		await b.close();
	});

	test('an open event stream keeps it up past the idle minutes; closing it starts the clock again', async () => {
		const w = await start({ idleMinutes: 0.01 });
		const cookie = await pair(w);
		const ctrl = new AbortController();
		const res = await fetch(`${w.url}/api/events`, { headers: { cookie, ...sameOrigin() }, signal: ctrl.signal });
		assert.equal(res.status, 200);
		const early = await Promise.race([w.closed, new Promise((r) => setTimeout(() => r('still up'), 1500))]);
		assert.equal(early, 'still up');
		ctrl.abort();
		const why = await Promise.race([w.closed, new Promise((r) => setTimeout(() => r('still up'), 3000))]);
		assert.equal(why, 'idle');
	});

	test('a client token\'s open event stream does not keep it up: the idle stop still comes, and ends that stream', async () => {
		const w = await start({ idleMinutes: 0.01 });
		const minted = await call(`${w.url}/_dt/token`, { method: 'POST', headers: { authorization: `Bearer ${w.controlToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'watcher' }) });
		const ctrl = new AbortController();
		const res = await fetch(`${w.url}/api/events`, { headers: { authorization: `Bearer ${minted.json.token}` }, signal: ctrl.signal });
		assert.equal(res.status, 200);
		try {
			const why = await Promise.race([w.closed, new Promise((r) => setTimeout(() => r('still up'), 3000))]);
			assert.equal(why, 'idle');
		} finally { ctrl.abort(); }
	});

	test('a client-token request resets the clock', async () => {
		const w = await start({ idleMinutes: 0.01 });
		const minted = await call(`${w.url}/_dt/token`, { method: 'POST', headers: { authorization: `Bearer ${w.controlToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'ci' }) });
		const token = minted.json.token;
		let up = true;
		w.closed.then(() => { up = false; });
		for (let i = 0; i < 6; i++) {
			await new Promise((r) => setTimeout(r, 300));
			assert.equal(up, true, `stopped after ${(i + 1) * 300} ms of client requests`);
			assert.equal((await call(`${w.url}/api/info`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
		}
		const why = await Promise.race([w.closed, new Promise((r) => setTimeout(() => r('still up'), 3000))]);
		assert.equal(why, 'idle');
	});
});
