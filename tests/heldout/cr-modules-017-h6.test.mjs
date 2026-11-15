// HELD-OUT cr-modules-017-h6 (rnd/tests dreamteamer-modules/heldout-m017-m-port-and-lifetime-edges), written by the
// test stage from the record alone: the stored port taken by another workspace's dt web, --port different from the
// stored one, two dt web open at the same instant, and a read-only state dir. bin/dt-web.mjs is driven as a session
// drives `dt web`, with per-test state and runtime dirs.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { BIN, call, cleanupTmps, dtWeb, dtWebAsync, freePort, listeners, machine, page, rtOf, signIn, sleep, stateOf, stopAll, urlOf, v4Listeners, workspaceNamed } from './cr-modules-017-lib.mjs';

const children = [];
/** `dt-web <root> start --port <p> --foreground` as a child; resolves once its runtime file names a port. */
async function foreground(root, m, port) {
	const c = spawn(process.execPath, [BIN, root, 'start', '--port', String(port), '--foreground'], { env: m.env, stdio: ['ignore', 'pipe', 'pipe'] });
	children.push(c);
	let out = '';
	c.stdout.on('data', (b) => { out += b; });
	c.stderr.on('data', (b) => { out += b; });
	const t0 = Date.now();
	while (Date.now() - t0 < 15_000) {
		if (c.exitCode !== null) return { child: c, out, exited: c.exitCode };
		if (rtOf(root, m)?.pid === c.pid) return { child: c, out, rt: rtOf(root, m) };
		await sleep(100);
	}
	return { child: c, out, timedOut: true };
}
const identity = async (port) => call(`http://127.0.0.1:${port}/_dt/identity?challenge=${'a'.repeat(24)}`).then((r) => r.status, () => 0);

after(() => { for (const c of children) if (c.exitCode === null) c.kill('SIGKILL'); cleanupTmps(); });

describe("step 1: the stored port taken by another workspace's dt web", () => {
	let m, A, B, P, oldCookie, bByFlag;
	before(async () => {
		m = machine();
		A = workspaceNamed('h6-alpha');
		B = workspaceNamed('h6-bravo');
		const open = dtWeb(A.root, ['open'], m.env);
		assert.equal(open.code, 0, open.stdout + open.stderr);
		oldCookie = await signIn(urlOf(open.stdout));
		P = rtOf(A.root, m).port;
		assert.equal(dtWeb(A.root, ['stop'], m.env).code, 0);
		assert.equal(stateOf(A.root, m).port, P, 'P is stored');
	});
	after(() => { stopAll([A.root, B.root], m); A.cleanup(); B.cleanup(); });

	test('B started with `start --port P` serves on P', async () => {
		const r = dtWeb(B.root, ['start', '--port', String(P)], m.env);
		assert.equal(r.code, 0, r.stdout + r.stderr);
		bByFlag = rtOf(B.root, m)?.port;
		assert.equal(bByFlag, P, `dt web start --port ${P} printed "${r.stdout.trim()}" and serves on ${bByFlag}`);
	});

	test("with B on P, A's open prints the moved line; A's old cookie is 401 on the new port; B keeps serving on P; A's cookie is 401 on B", async () => {
		if (bByFlag !== P) {
			// the flag did not hold P: put B on P in the foreground so the rest of the step is still judged
			dtWeb(B.root, ['stop'], m.env);
			const fg = await foreground(B.root, m, P);
			assert.ok(fg.rt?.port === P, `B could not take P in the foreground either: ${fg.out}`);
		}
		const bPid = rtOf(B.root, m).pid;
		const open = dtWeb(A.root, ['open'], m.env);
		assert.equal(open.code, 0, open.stdout + open.stderr);
		const newPort = rtOf(A.root, m).port;
		assert.notEqual(newPort, P);
		assert.match(open.stdout, new RegExp(`port ${P} was taken; moved to ${newPort} — open the pane again: dt web open`));
		const sid = oldCookie.split('=')[1];
		for (const c of [oldCookie, `dt_pane_${newPort}=${sid}`]) {
			const r = await page(`http://127.0.0.1:${newPort}`, c, 'GET', '/api/host');
			assert.equal(r.status, 401, `A's old cookie on the new port (${c.split('=')[0]}): ${r.status}`);
		}
		assert.equal(rtOf(B.root, m).pid, bPid, 'B was not replaced');
		assert.equal(rtOf(B.root, m).port, P);
		assert.equal(await identity(P), 200, 'B still answers on P');
		for (const c of [oldCookie, `dt_pane_${P}=${sid}`]) {
			const r = await page(`http://127.0.0.1:${P}`, c, 'GET', '/api/host');
			assert.equal(r.status, 401, `A's cookie on B: ${r.status}`);
		}
	});
});

describe('step 2: --port different from the stored one', () => {
	test('the server listens on Q, the stored port becomes Q, and a session minted on P is refused on Q — or the verb refuses; never two listeners', async () => {
		const m = machine();
		const A = workspaceNamed('h6-alpha2');
		try {
			const open = dtWeb(A.root, ['open'], m.env);
			assert.equal(open.code, 0, open.stdout + open.stderr);
			const P = rtOf(A.root, m).port;
			const cookieP = await signIn(urlOf(open.stdout));
			assert.equal(dtWeb(A.root, ['stop'], m.env).code, 0);
			const Q = await freePort();
			const fg = await foreground(A.root, m, Q);
			if (fg.exited !== undefined) {
				assert.notEqual(fg.exited, 0);
				assert.match(fg.out, /port/i, `the refusal says why: ${fg.out}`);
				return;
			}
			assert.ok(fg.rt, `start --port ${Q} --foreground did not serve: ${fg.out}`);
			assert.equal(fg.rt.port, Q);
			assert.equal(stateOf(A.root, m).port, Q, 'the stored port is Q');
			const pair = dtWeb(A.root, ['open'], m.env);
			assert.equal(pair.code, 0, pair.stdout + pair.stderr);
			assert.match(urlOf(pair.stdout), new RegExp(`:${Q}/sign-in/`));
			const sid = cookieP.split('=')[1];
			for (const c of [cookieP, `dt_pane_${Q}=${sid}`]) {
				const r = await page(`http://127.0.0.1:${Q}`, c, 'GET', '/api/host');
				assert.equal(r.status, 401, `a session minted on P, on Q (${c.split('=')[0]}): ${r.status}`);
			}
			assert.deepEqual(listeners(P), [], `something listens on the old port ${P}`);
			assert.equal(listeners(Q).length, 1, `listeners on Q: ${listeners(Q)}`);
		} finally { stopAll([A.root], m); A.cleanup(); }
	});
});

describe('step 3: two dt web open at the same instant in a stopped workspace', () => {
	test('both exit 0 printing a URL on the same port; one server pid; one 127.0.0.1 listener; both URLs sign in', async () => {
		const m = machine();
		const C = workspaceNamed('h6-charlie');
		try {
			const [a, b] = await Promise.all([dtWebAsync(C.root, ['open'], m.env), dtWebAsync(C.root, ['open'], m.env)]);
			assert.equal(a.code, 0, a.stdout + a.stderr);
			assert.equal(b.code, 0, b.stdout + b.stderr);
			const ua = urlOf(a.stdout); const ub = urlOf(b.stdout);
			assert.ok(ua && ub, `${a.stdout}\n${b.stdout}`);
			const port = Number(new URL(ua).port);
			assert.equal(Number(new URL(ub).port), port, `${ua} vs ${ub}`);
			const files = fs.readdirSync(m.runtime).filter((x) => x.endsWith('.json'));
			assert.equal(files.length, 1, `runtime files: ${files}`);
			assert.equal(listeners(port).length, 1, `pids on ${port}: ${listeners(port)}`);
			assert.equal(v4Listeners(port).length, 1, v4Listeners(port).join('\n'));
			await signIn(ua);
			await signIn(ub);
		} finally { stopAll([C.root], m); C.cleanup(); }
	});
});

describe('step 4: a read-only state dir', { skip: process.getuid?.() === 0 ? 'root ignores the mode' : false }, () => {
	let m, D, base, cookie;
	before(async () => {
		m = machine();
		D = workspaceNamed('h6-delta');
		const open = dtWeb(D.root, ['open', '--edit'], m.env);
		assert.equal(open.code, 0, open.stdout + open.stderr);
		base = `http://127.0.0.1:${rtOf(D.root, m).port}`;
		cookie = await signIn(urlOf(open.stdout));
		fs.chmodSync(m.state, 0o500);
	});
	after(() => { fs.chmodSync(m.state, 0o700); stopAll([D.root], m); D.cleanup(); });

	test('a running server keeps answering: PUT /api/selection never takes it down, and the record PATCH saves', async () => {
		const sel = await page(base, cookie, 'PUT', '/api/selection', { view: { collection: 'tasks' }, refs: ['tasks/brief-dana'] });
		assert.ok(sel.status > 0, 'PUT /api/selection got no answer');
		const r = await page(base, cookie, 'PATCH', '/api/collections/tasks/records/brief-dana', { done: true });
		assert.equal(r.status, 200, r.text);
		const again = await page(base, cookie, 'GET', '/api/info');
		assert.equal(again.status, 200);
	});

	test('dt web open with the server stopped works with a warning naming the state dir, or exits non-zero naming it — within 15 s, never writing state into the workspace', () => {
		// The snapshot is taken here, after the previous test's record PATCH (a write the record asks for), so the
		// comparison below sees only what stop and open themselves leave in the workspace.
		const porcelain = D.git(['status', '--porcelain', '--ignored']);
		assert.equal(dtWeb(D.root, ['stop'], m.env).code, 0);
		const r = dtWeb(D.root, ['open'], m.env, { timeout: 20_000 });
		assert.ok(r.ms < 15_000, `open took ${r.ms} ms`);
		assert.equal(r.signal, null, `open was killed (${r.signal}) — it hung`);
		const said = r.stdout + r.stderr;
		const mode = (fs.statSync(m.state).mode & 0o777).toString(8);
		if (r.code === 0) assert.ok(said.includes(m.state), `open worked without naming the state dir (the dir's mode is now ${mode}, it was 500):\n${said}`);
		else assert.ok(said.includes(m.state), `open failed without naming the state dir:\n${said}`);
		assert.equal(D.git(['status', '--porcelain', '--ignored']), porcelain, 'state was written inside the workspace');
	});
});
