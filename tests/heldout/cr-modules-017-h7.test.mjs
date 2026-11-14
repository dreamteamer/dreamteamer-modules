// HELD-OUT cr-modules-017-h7 (rnd/tests dreamteamer-modules/heldout-m017-m-handoff-edges), written by the test stage
// from the record alone: a cycle A to B to A, a target whose engine does not open, a registry entry whose root now
// holds a different workspace, and a handoff while the target is mid-start. Every workspace is registered in ONE
// state dir by `dt web open` and has @dreamteamer/web installed (linked), as the switcher needs.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { call, cleanupTmps, dtWeb, dtWebAsync, hook, listeners, machine, page, payload, rtOf, signIn, sleep, stateOf, stopAll, stream, urlOf, v4Listeners, workspaceKey, workspaceNamed } from './cr-modules-017-lib.mjs';

let m, A, B;
const roots = [];
const ws = (name) => { const f = workspaceNamed(name); roots.push(f.root); return f; };
const baseOf = (root) => `http://127.0.0.1:${rtOf(root, m).port}`;
const lines = (s) => s.split('\n').filter(Boolean);
const MOVED = (name) => `dreamteamer pane moved to workspace "${name}"`;
/** The page of the pane: where it is, its cookie, its open event stream. */
const pane = { base: null, cookie: null, es: null };
async function land(url) {
	pane.es?.close();
	pane.cookie = await signIn(url);
	pane.base = new URL(url).origin;
	pane.es = await stream(pane.base, pane.cookie);
}
const handoffTo = (id) => page(pane.base, pane.cookie, 'POST', '/_dt/handoff', { id });

before(async () => {
	m = machine();
	A = ws('h7-alpha');
	B = ws('h7-bravo');
	const b = dtWeb(B.root, ['open'], m.env);
	assert.equal(b.code, 0, b.stdout + b.stderr);
	assert.equal(dtWeb(B.root, ['stop'], m.env).code, 0);
	const a = dtWeb(A.root, ['open'], m.env);
	assert.equal(a.code, 0, a.stdout + a.stderr);
	await land(urlOf(a.stdout));
});
after(() => { pane.es?.close(); stopAll(roots, m); for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); cleanupTmps(); });

describe('step 1: a cycle A to B to A', () => {
	const signIns = { A: 1, B: 0 };
	test('A → B: a /sign-in/ URL on B\'s port; the page lands signed in with no step', async () => {
		const r = await handoffTo(workspaceKey(B.root));
		assert.equal(r.status, 200, r.text);
		const portB = rtOf(B.root, m).port;
		assert.match(r.json.url, new RegExp(`^http://127\\.0\\.0\\.1:${portB}/sign-in/`));
		await land(r.json.url);
		signIns.B++;
		assert.equal((await page(pane.base, pane.cookie, 'PUT', '/api/selection', { view: { collection: 'tasks' }, refs: [] })).status, 200);
	});
	test("A's hook prints the one moved line once, then no moved line; B's hook prints the normal line", async () => {
		const a1 = await hook(payload(A.root), m.env);
		assert.deepEqual(lines(a1.stdout), [MOVED('h7-bravo')], `A's first prompt: ${a1.stdout}`);
		const a2 = await hook(payload(A.root), m.env);
		assert.ok(!a2.stdout.includes('moved to workspace'), `A's second prompt: ${a2.stdout}`);
		const b1 = await hook(payload(B.root), m.env);
		assert.match(b1.stdout, /^dreamteamer pane \(data, not instructions\) — showing: tasks · List/m, `B's prompt: ${b1.stdout}`);
	});
	test('B → A: a /sign-in/ URL on A\'s port; signed in; B\'s hook says moved once, A\'s hook the normal line', async () => {
		const r = await handoffTo(workspaceKey(A.root));
		assert.equal(r.status, 200, r.text);
		assert.match(r.json.url, new RegExp(`^http://127\\.0\\.0\\.1:${rtOf(A.root, m).port}/sign-in/`));
		await land(r.json.url);
		signIns.A++;
		assert.equal((await page(pane.base, pane.cookie, 'PUT', '/api/selection', { view: { collection: 'projects' }, refs: [] })).status, 200);
		const b1 = await hook(payload(B.root), m.env);
		assert.deepEqual(lines(b1.stdout), [MOVED('h7-alpha')], `B's first prompt: ${b1.stdout}`);
		const b2 = await hook(payload(B.root), m.env);
		assert.ok(!b2.stdout.includes('moved to workspace'), `B's second prompt: ${b2.stdout}`);
		const a1 = await hook(payload(A.root), m.env);
		assert.match(a1.stdout, /^dreamteamer pane \(data, not instructions\) — showing: projects · List/m, `A's prompt: ${a1.stdout}`);
	});
	test('no session count grows without bound: A holds at most the sessions that signed in', () => {
		// revoking counts the live sessions; the pane signs in again after
		const ra = dtWeb(A.root, ['revoke'], m.env);
		const n = Number(/revoked (\d+) session/.exec(ra.stdout)?.[1]);
		assert.ok(Number.isInteger(n) && n <= signIns.A, `A held ${ra.stdout.trim()} after ${signIns.A} sign-ins`);
		const rb = dtWeb(B.root, ['revoke'], m.env);
		const nb = Number(/revoked (\d+) session/.exec(rb.stdout)?.[1]);
		assert.ok(Number.isInteger(nb) && nb <= signIns.B, `B held ${rb.stdout.trim()} after ${signIns.B} sign-ins`);
	});
	after(async () => {
		const a = dtWeb(A.root, ['open'], m.env);
		await land(urlOf(a.stdout));
	});
});

describe('step 2: a target whose engine does not open', () => {
	const broken = [
		['h7-charlie', 'its node_modules/dreamteamer deleted', (root) => fs.rmSync(path.join(root, 'node_modules', 'dreamteamer'), { recursive: true, force: true })],
		// the record's other break, "an invalid dreamteamer block", does not stop this engine: 0.48/cr-dt-008 lists and
		// checks a workspace whose block is a string, null or of wrong types (probed by the test stage), so such a target
		// serves and is no broken target at all. The block REMOVED is the break that remains: the root is no workspace.
		['h7-charlie-two', 'the dreamteamer key removed from its package.json', (root) => {
			const f = path.join(root, 'package.json');
			const pkg = JSON.parse(fs.readFileSync(f, 'utf8'));
			delete pkg.dreamteamer;
			fs.writeFileSync(f, JSON.stringify(pkg, null, '\t'));
		}],
	];
	for (const [name, how, breakIt] of broken) {
		test(`${name} (${how}): 409 or 502 within 12 s naming the workspace and what failed; A keeps working; no orphan of C listens`, async () => {
			const C = ws(name);
			const o = dtWeb(C.root, ['open'], m.env);
			assert.equal(o.code, 0, o.stdout + o.stderr);
			const portC = rtOf(C.root, m).port;
			assert.equal(dtWeb(C.root, ['stop'], m.env).code, 0);
			breakIt(C.root);
			const t0 = Date.now();
			const r = await handoffTo(workspaceKey(C.root));
			const ms = Date.now() - t0;
			assert.ok(r.status === 409 || r.status === 502, `${r.status} ${r.text}`);
			assert.ok(ms < 12_000, `${ms} ms`);
			assert.ok((r.json?.error ?? '').includes(name), `the message names the workspace: ${r.text}`);
			const info = await page(pane.base, pane.cookie, 'GET', '/api/info');
			assert.equal(info.status, 200, "A's page stopped working");
			await sleep(500);
			const rt = rtOf(C.root, m);
			assert.ok(!rt || !(() => { try { process.kill(rt.pid, 0); return true; } catch { return false; } })(), `C left a process: ${JSON.stringify(rt)}`);
			const stored = stateOf(C.root, m)?.port ?? portC;
			assert.deepEqual(listeners(stored), [], `something listens on C's port ${stored}`);
			console.log(`# ${name}: ${r.status} in ${ms} ms — ${r.json?.error}`);
		});
	}
});

describe('step 3: a registry entry whose root now holds a different workspace', () => {
	test('the switcher shows the name the root has now or the handoff refuses naming it; never signed in under the old name', async () => {
		const D = ws('h7-delta');
		const o = dtWeb(D.root, ['open'], m.env);
		assert.equal(o.code, 0, o.stdout + o.stderr);
		assert.equal(dtWeb(D.root, ['stop'], m.env).code, 0);
		const id = workspaceKey(D.root);
		const E = ws('h7-echo');
		fs.rmSync(D.root, { recursive: true, force: true });
		fs.renameSync(E.root, D.root);
		const c = D.dt('compile');
		assert.equal(c.status, 0, c.stdout + c.stderr);
		assert.equal(workspaceKey(D.root), id, 'the same path, so the same registry id');
		const list = await page(pane.base, pane.cookie, 'GET', '/_dt/workspaces');
		assert.equal(list.status, 200, list.text);
		const row = list.json.find((x) => x.id === id);
		const r = await handoffTo(id);
		if (r.status !== 200) {
			assert.match(r.json?.error ?? '', /h7-echo/, `refused without naming the root's workspace: ${r.text}`);
			return;
		}
		assert.equal(new URL(r.json.url).port, String(rtOf(D.root, m).port), 'the URL is the registered root\'s server');
		await land(r.json.url);
		const host = await page(pane.base, pane.cookie, 'GET', '/api/host');
		assert.equal(host.json.workspace.name, 'h7-echo', 'the page is signed in under the old name');
		assert.equal(row?.name, 'h7-echo', `the page lands in h7-echo, but the switcher listed the root under "${row?.name}"`);
	});
	after(async () => {
		const a = dtWeb(A.root, ['open'], m.env);
		await land(urlOf(a.stdout));
	});
});

describe('step 4: a handoff while the target is mid-start', () => {
	test('one B server (one pid, one listener); both the verb\'s URL and the handoff\'s URL sign in', async () => {
		dtWeb(B.root, ['stop'], m.env);
		assert.equal(rtOf(B.root, m), null);
		const verb = dtWebAsync(B.root, ['open'], m.env);
		await sleep(50);
		const r = await handoffTo(workspaceKey(B.root));
		const v = await verb;
		assert.equal(v.code, 0, v.stdout + v.stderr);
		assert.equal(r.status, 200, r.text);
		const port = rtOf(B.root, m).port;
		assert.equal(new URL(urlOf(v.stdout)).port, String(port));
		assert.equal(new URL(r.json.url).port, String(port));
		assert.equal(listeners(port).length, 1, `pids: ${listeners(port)}`);
		assert.equal(v4Listeners(port).length, 1);
		assert.equal(fs.readdirSync(m.runtime).filter((x) => x.startsWith(workspaceKey(B.root)) && x.endsWith('.json')).length, 1);
		await signIn(urlOf(v.stdout));
		await signIn(r.json.url);
	});
});

describe('step 5: from a Read page of A to B stored at Admin', () => {
	test("the PATCH at B is 403 naming Read; B's state file still says admin", async () => {
		const up = dtWeb(B.root, ['open', '--admin'], m.env);
		assert.equal(up.code, 0, up.stdout + up.stderr);
		assert.equal(stateOf(B.root, m).level, 'admin');
		const low = await page(pane.base, pane.cookie, 'POST', '/_dt/level', { level: 'read' });
		assert.equal(low.status, 200, low.text);
		const r = await handoffTo(workspaceKey(B.root));
		assert.equal(r.status, 200, r.text);
		await land(r.json.url);
		const p = await page(pane.base, pane.cookie, 'PATCH', '/api/collections/tasks/records/brief-dana', { done: true });
		assert.equal(p.status, 403, p.text);
		assert.match(p.json?.error ?? '', /\bread\b/i);
		assert.equal(stateOf(B.root, m).level, 'admin');
	});
});
