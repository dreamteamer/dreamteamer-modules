// The workspace switcher's server half (cr-modules-017 §7; rnd/tests/dreamteamer-modules/pane-a7-switcher-opens-
// another-workspace): GET /_dt/workspaces lists what `dt web open` registered on this machine, with no paths; POST
// /_dt/handoff starts the chosen one when it is stopped (its OWN installed dt-web), pairs there at the lower of this
// page's level and the target's stored level — never writing the target's level — and leaves a movedTo the hook
// answers once. Only a registered id is reached; only the page's cookie may ask.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWeb } from '../src/server.js';
import { readState, stateFile, workspaceKey, writeState } from '../src/runtime.js';
import { readWorkspaceState, register } from '../src/state.js';
import { fixture, call, pair, sameOrigin } from './support.mjs';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let a, b, gone, web, cookie, runtime;
const saved = {};
before(async () => {
	a = fixture();
	b = fixture();
	gone = fixture();
	runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-web-handoff-rt-'));
	// one machine: the three share one state dir and one runtime dir, as a person's do
	for (const [k, v] of Object.entries({ DT_WEB_RUNTIME_DIR: runtime, DT_WEB_STATE_DIR: a.state, DT_WEB_APP_DIR: a.app, CLAUDE_PID: '' })) { saved[k] = process.env[k]; process.env[k] = v; }
	// B has dt web installed, as `npm i @dreamteamer/web` leaves it
	fs.mkdirSync(path.join(b.root, 'node_modules', '@dreamteamer'), { recursive: true });
	fs.symlinkSync(WEB, path.join(b.root, 'node_modules', '@dreamteamer', 'web'), 'dir');
	for (const [ws, name] of [[a, 'alpha'], [b, 'bravo'], [gone, 'gone']]) await register({ root: ws.root, name }, a.state);
	fs.rmSync(gone.root, { recursive: true, force: true });
	web = await startWeb({ root: a.root, appDir: a.app, idleMinutes: 0, stateDir: a.state });
	writeState(stateFile(a.root, runtime), { pid: process.pid, port: web.port, token: web.controlToken, instance: web.instance });
	cookie = await pair(web);
});
after(async () => {
	const rb = readState(stateFile(b.root, runtime));
	if (rb?.pid && rb.pid !== process.pid) try { process.kill(rb.pid, 'SIGTERM'); } catch { /* gone */ }
	await web?.close();
	await new Promise((r) => setTimeout(r, 300));
	for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
	for (const f of [a, b, gone]) f?.cleanupAll();
	fs.rmSync(runtime, { recursive: true, force: true });
});

const JSON_TYPE = { 'content-type': 'application/json' };
const page = (p, method = 'GET', body, c = cookie) => call(`${web.url}${p}`, { method, headers: { cookie: c, ...sameOrigin(), ...(body ? JSON_TYPE : {}) }, body: body ? JSON.stringify(body) : undefined });
const control = (p, method = 'GET', body) => call(`${web.url}/_dt${p}`, { method, headers: { authorization: `Bearer ${web.controlToken}`, ...(body ? JSON_TYPE : {}) }, body: body ? JSON.stringify(body) : undefined });
const values = (o, out = []) => { if (o && typeof o === 'object') for (const v of Object.values(o)) values(v, out); else out.push(o); return out; };

describe('the list', () => {
	test('every registered workspace: id, name, running, current — and no path', async () => {
		const r = await page('/_dt/workspaces');
		assert.equal(r.status, 200, r.text);
		const byName = Object.fromEntries(r.json.map((w) => [w.name, w]));
		assert.deepEqual(Object.keys(byName).sort(), ['alpha', 'bravo', 'gone']);
		assert.deepEqual(byName.alpha, { id: workspaceKey(a.root), name: 'alpha', running: true, current: true });
		assert.deepEqual(byName.bravo, { id: workspaceKey(b.root), name: 'bravo', running: false, current: false });
		for (const v of values(r.json)) assert.ok(typeof v !== 'string' || !v.includes(path.sep + 'dt-contract-'), `a path: ${v}`);
	});

	test('a client token, the control token or no cookie cannot list or hand off', async () => {
		const token = (await control('/token', 'POST', { name: 'ci', level: 'edit' })).json.token;
		for (const [p, method, body] of [['/_dt/workspaces', 'GET'], ['/_dt/handoff', 'POST', { id: workspaceKey(b.root) }]]) {
			assert.equal((await call(`${web.url}${p}`, { method, headers: { authorization: `Bearer ${token}`, ...JSON_TYPE }, body: body ? JSON.stringify(body) : undefined })).status, 401, `client ${p}`);
			assert.equal((await call(`${web.url}${p}`, { method, headers: { ...sameOrigin(), ...JSON_TYPE }, body: body ? JSON.stringify(body) : undefined })).status, 401, `nothing ${p}`);
		}
		assert.equal((await control('/handoff', 'POST', { id: workspaceKey(b.root) })).status, 404, 'the control token has no handoff verb');
	});
});

describe('the handoff', () => {
	test('a Read page hands off to a stopped Edit workspace: it starts, the session there is Read, its stored level stays Edit', { timeout: 60_000 }, async () => {
		assert.equal((await control('/level', 'POST', { level: 'read' })).status, 200);
		assert.equal(readWorkspaceState(b.root, a.state).level, 'edit');
		const r = await page('/_dt/handoff', 'POST', { id: workspaceKey(b.root) });
		assert.equal(r.status, 200, r.text);
		const rb = readState(stateFile(b.root, runtime));
		assert.ok(rb?.port, 'B is running: its runtime file is there');
		assert.notEqual(rb.pid, process.pid, 'B runs in its own process');
		assert.match(r.json.url, new RegExp(`^http://127\\.0\\.0\\.1:${rb.port}/sign-in/[\\w-]+$`));
		const signIn = await call(r.json.url);
		assert.equal(signIn.status, 302);
		assert.equal(signIn.headers.get('location'), '/app/#/');
		const bCookie = signIn.headers.get('set-cookie').split(';')[0];
		assert.ok(bCookie.startsWith(`dt_pane_${rb.port}=`));
		const atB = (p, method = 'GET', body) => call(`http://127.0.0.1:${rb.port}${p}`, { method, headers: { cookie: bCookie, ...sameOrigin(), ...(body ? JSON_TYPE : {}) }, body: body ? JSON.stringify(body) : undefined });
		assert.equal((await atB('/api/host')).json.level, 'read');
		const patch = await atB('/api/collections/tasks/records/brief-dana', 'PATCH', { done: true });
		assert.equal(patch.status, 403);
		assert.match(patch.json.error, /this pane is at Read/);
		assert.equal(readWorkspaceState(b.root, a.state).level, 'edit', 'the target\'s stored level is never written');
		const listed = (await page('/_dt/workspaces')).json.find((w) => w.name === 'bravo');
		assert.equal(listed.running, true);
	});

	test('the hook in A hears movedTo once', async () => {
		const first = (await control('/pane?hook=1')).json;
		assert.equal(first.movedTo?.name, 'bravo');
		assert.equal((await control('/pane?hook=1')).json.movedTo, null);
	});

	test('an Admin page to a running Edit workspace pairs at Edit', async () => {
		assert.equal((await control('/level', 'POST', { level: 'admin' })).status, 200);
		const r = await page('/_dt/handoff', 'POST', { id: workspaceKey(b.root) });
		assert.equal(r.status, 200, r.text);
		const signIn = await call(r.json.url);
		const bCookie = signIn.headers.get('set-cookie').split(';')[0];
		const port = new URL(r.json.url).port;
		const h = await call(`http://127.0.0.1:${port}/api/host`, { headers: { cookie: bCookie, ...sameOrigin() } });
		assert.equal(h.json.level, 'edit');
		await control('/level', 'POST', { level: 'edit' });
	});

	test('an unregistered id is 404; a registered root gone from disk is 409; the current workspace is 400', async () => {
		const nope = await page('/_dt/handoff', 'POST', { id: '0123456789abcdef' });
		assert.equal(nope.status, 404);
		assert.match(nope.json.error, /no workspace 0123456789abcdef was opened on this machine/);
		const goneId = (await page('/_dt/workspaces')).json.find((w) => w.name === 'gone').id;
		const g = await page('/_dt/handoff', 'POST', { id: goneId });
		assert.equal(g.status, 409);
		assert.match(g.json.error, /gone/);
		assert.equal((await page('/_dt/handoff', 'POST', { id: workspaceKey(a.root) })).status, 400);
		assert.equal((await page('/_dt/handoff', 'POST', { id: '../x' })).status, 404);
	});

	test('a registered workspace without dt web installed is 409 naming what is missing', async () => {
		const c = fixture();
		try {
			await register({ root: c.root, name: 'charlie' }, a.state);
			const r = await page('/_dt/handoff', 'POST', { id: workspaceKey(c.root) });
			assert.equal(r.status, 409);
			assert.match(r.json.error, /charlie.*node_modules\/@dreamteamer\/web/);
		} finally { c.cleanupAll(); }
	});
});
