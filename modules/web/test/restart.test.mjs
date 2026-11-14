// A stable port, sessions across restarts, the idle stop (cr-modules-017 §2; rnd/tests/dreamteamer-modules/
// pane-a2-restart-keeps-the-pane, server half; pane-s1-the-pane-is-still-there-tomorrow with auth-primitives): the
// second start reuses the stored port and the pane's cookie still answers with no new sign-in; a pairing code dies
// with its process; a stored port another process holds moves the server, ends every session and says where from;
// the server stops after its idle minutes with no page and no bearer request, and the state never holds a cookie.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { startWeb } from '../src/server.js';
import { readWorkspaceState } from '../src/state.js';
import { movedLine } from '../src/runtime.js';
import { fixture, call, pair, sameOrigin } from './support.mjs';

let f;
const open = [];
before(() => { f = fixture(); });
after(async () => { for (const w of open) await w.close(); f?.cleanupAll(); });

const start = async (o = {}) => { const w = await startWeb({ root: f.root, appDir: f.app, idleMinutes: 0, stateDir: f.state, ...o }); open.push(w); return w; };
const host = (w, cookie) => call(`${w.url}/api/host`, { headers: { cookie, ...sameOrigin() } });
const stateText = () => fs.readdirSync(f.state).filter((n) => n.endsWith('.json')).map((n) => fs.readFileSync(path.join(f.state, n), 'utf8')).join('\n');
const sidOf = (cookie) => cookie.split('=')[1];

describe('a restart', () => {
	test('reuses the stored port; the old cookie answers with no new sign-in; a code minted before is refused after', async () => {
		const a = await start();
		assert.equal(readWorkspaceState(f.root, f.state).port, a.port, 'the port is stored at once');
		const cookie = await pair(a);
		const code = a.pair();
		await a.close();
		const b = await start();
		assert.equal(b.port, a.port);
		assert.equal(b.movedFrom, undefined);
		const r = await host(b, cookie);
		assert.equal(r.status, 200, r.text);
		const late = await call(code);
		assert.equal(late.status, 401, 'a code lives in one process');
		assert.equal(stateText().includes(sidOf(cookie)), false);
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
			assert.deepEqual(readWorkspaceState(f.root, f.state).sessions, {}, 'every session ended');
			assert.equal((await host(b, cookie)).status, 401);
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
	test('no page and no bearer request: it stops with idle', async () => {
		const w = await start({ idleMinutes: 0.01 });
		const why = await Promise.race([w.closed, new Promise((r) => setTimeout(() => r('still up'), 3000))]);
		assert.equal(why, 'idle');
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
