// The verbs (cr-modules-017 §8; rnd/tests/dreamteamer-modules/pane-a2-restart-keeps-the-pane, process half;
// pane-a3-one-listener-one-process, process half): `dt web open` starts ONE detached server with ONE loopback listener
// and prints a sign-in URL that lands on its target; `dt serve` is a client token of that same process; a stop and
// the next verb bring it back on the same port with the pane signed out (sessions live in memory only — the security
// sign-off) until the next open pairs it; show, select, token, revoke, list, the level flags and the usage line. Every server is stopped in after().
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, call, sameOrigin } from './support.mjs';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'dt-web.mjs');
let f, tmp, env;
before(() => {
	f = fixture();
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-web-verbs-'));
	env = { ...process.env, DT_WEB_RUNTIME_DIR: path.join(tmp, 'rt'), DT_WEB_STATE_DIR: f.state, DT_WEB_APP_DIR: f.app, CLAUDE_PID: '' };
	// the in-process verbs (dt serve through the extension) read the same dirs
	Object.assign(process.env, { DT_WEB_RUNTIME_DIR: env.DT_WEB_RUNTIME_DIR, DT_WEB_STATE_DIR: env.DT_WEB_STATE_DIR, DT_WEB_APP_DIR: env.DT_WEB_APP_DIR });
});
after(() => {
	run('stop');
	try { const rt = runtimeFile(); if (rt) process.kill(rt.pid, 'SIGKILL'); } catch { /* gone */ }
	f?.cleanupAll();
	fs.rmSync(tmp, { recursive: true, force: true });
});

const run = (...args) => { const t0 = Date.now(); const r = spawnSync(process.execPath, [BIN, f.root, ...args], { env, encoding: 'utf8', timeout: 30_000 }); return { ...r, ms: Date.now() - t0, lines: r.stdout.trim().split('\n') }; };
const runtimeFile = () => {
	const dir = env.DT_WEB_RUNTIME_DIR;
	const name = fs.existsSync(dir) ? fs.readdirSync(dir).find((n) => n.endsWith('.json')) : null;
	return name ? JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) : null;
};
const signIn = async (url) => { const r = await call(url); assert.equal(r.status, 302, r.text); return { cookie: r.headers.get('set-cookie').split(';')[0], location: r.headers.get('location') }; };
const host = (port, cookie) => call(`http://127.0.0.1:${port}/api/host`, { headers: { cookie, ...sameOrigin() } });
async function serve(argv) {
	const { default: activate } = await import('../src/extension.js');
	const out = [];
	const err = [];
	const [log, error] = [console.log, console.error];
	console.log = (...a) => out.push(a.join(' '));
	console.error = (...a) => err.push(a.join(' '));
	try { return { code: await activate().commands.serve.run({ root: f.root }, argv), out, err }; } finally { console.log = log; console.error = error; }
}

let port, cookie;
describe('open', () => {
	test('open tasks: one detached server, a sign-in URL that lands on the list, the level and the hook hint', { timeout: 60_000 }, async () => {
		assert.equal(run('status').status, 1, 'not running yet');
		const r = run('open', 'tasks');
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.ok(r.ms < 15_000, `${r.ms} ms`);
		const url = /^✔ open in the pane: (http:\/\/127\.0\.0\.1:(\d+)\/sign-in\/[\w-]+)$/.exec(r.lines[0]);
		assert.ok(url, r.lines[0]);
		port = Number(url[2]);
		assert.equal(r.lines[1], 'level: Edit');
		assert.equal(r.lines[2], 'the chat cannot see the pane yet — run: dt web hook --install');
		const s = await signIn(url[1]);
		assert.equal(s.location, '/app/#/content/tasks');
		cookie = s.cookie;
		const status = run('status');
		assert.equal(status.status, 0);
		const rt = runtimeFile();
		assert.match(status.stdout, new RegExp(`^running at http://127\\.0\\.0\\.1:${port} · pid ${rt.pid} · level Edit · since `));
		assert.equal(fs.statSync(env.DT_WEB_RUNTIME_DIR).mode & 0o777, 0o700);
		assert.equal(f.git(['status', '--porcelain']).includes('.claude'), false, 'open wrote nothing into the workspace');
	});

	test('one process, one listener: 127.0.0.1 and at most the [::1] redirect, on the same port', () => {
		const rt = runtimeFile();
		const l = spawnSync('lsof', ['-nP', '-a', '-p', String(rt.pid), '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8' });
		const rows = l.stdout.trim().split('\n').slice(1);
		const v4 = rows.filter((x) => x.includes(`127.0.0.1:${port} `));
		const v6 = rows.filter((x) => x.includes(`[::1]:${port} `));
		assert.equal(v4.length, 1, l.stdout);
		assert.ok(v6.length <= 1, l.stdout);
		assert.equal(rows.length, v4.length + v6.length, `no other listener: ${l.stdout}`);
	});

	test('dt serve is a client token of the same process: the API answers it at Read', async () => {
		const r = await serve([]);
		assert.equal(r.code, 0, r.err.join('\n'));
		assert.equal(r.out[0], `API http://127.0.0.1:${port}/api`);
		const token = /^token (dtw_[\w-]+)$/.exec(r.out[1])?.[1];
		assert.ok(token, r.out[1]);
		assert.equal((await call(`http://127.0.0.1:${port}/api/info`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
		const patch = await call(`http://127.0.0.1:${port}/api/collections/tasks/records/brief-dana`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{"done":true}' });
		assert.equal(patch.status, 403);
		for (const flag of [['--host', '0.0.0.0'], ['--port', '1'], ['--token=x']]) {
			const refused = await serve(flag);
			assert.notEqual(refused.code, 0, flag.join(' '));
			assert.match(refused.err.join('\n'), /dt serve is dt web token now: loopback only, a client token of the pane's server — dt web token \[--read\|--edit\]/);
		}
	});

	test('open --read sets the level and says so; list names the workspace', () => {
		const r = run('open', '--read');
		assert.equal(r.status, 0, r.stderr);
		assert.equal(r.lines[1], 'level: Read');
		const back = run('open', '--edit');
		assert.equal(back.lines[1], 'level: Edit');
		const list = run('list');
		assert.equal(list.status, 0);
		assert.match(list.stdout, new RegExp(`^lab · ${port} · running · ${fs.realpathSync(f.root).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
	});

	test('a target that names nothing is refused', () => {
		const r = run('open', 'tasks/nope');
		assert.equal(r.status, 1);
		assert.match(r.stdout, /no record, collection or ui-view tasks\/nope/);
	});
});

describe('the push verbs', () => {
	test('show and select with no page connected say so and exit 1; selection prints the place and refs', () => {
		const show = run('show', 'tasks');
		assert.equal(show.status, 1);
		assert.equal(show.stdout.trim(), 'no page is connected — run: dt web open tasks');
		const sel = run('select', 'tasks/brief-dana');
		assert.equal(sel.status, 1);
		assert.match(sel.stdout, /no page is connected/);
		const selection = run('selection');
		assert.equal(selection.status, 0, selection.stderr);
		assert.equal(selection.lines[0], 'showing: -');
		const json = JSON.parse(run('selection', '--json').stdout);
		assert.deepEqual(json.refs, []);
		assert.equal(json.connected, false);
	});

	test('with a page connected show and select deliver', async () => {
		const ctrl = new AbortController();
		const res = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { cookie, ...sameOrigin() }, signal: ctrl.signal });
		assert.equal(res.status, 200);
		res.body.getReader().read().catch(() => {});
		try {
			await new Promise((r) => setTimeout(r, 50));
			// spawnSync would block this process's event loop, and the stream with it: the push goes from a child, the
			// stream only has to be open
			const show = run('show', 'tasks/brief-dana');
			assert.equal(show.status, 0, show.stdout + show.stderr);
			assert.equal(show.stdout.trim(), '✔ the pane shows /content/tasks/brief-dana');
			const sel = run('select', '--clear');
			assert.equal(sel.status, 0);
		} finally { ctrl.abort(); }
	});
});

describe('tokens and revoke', () => {
	test('token --edit --name ci answers; revoke --token ci refuses it after', async () => {
		const r = run('token', '--edit', '--name', 'ci');
		assert.equal(r.status, 0, r.stderr);
		assert.equal(r.lines[0], `API http://127.0.0.1:${port}/api`);
		const token = r.lines[1].replace(/^token /, '');
		const patch = await call(`http://127.0.0.1:${port}/api/collections/tasks/records/brief-dana`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{"done":true}' });
		assert.equal(patch.status, 200, patch.text);
		const rv = run('revoke', '--token', 'ci');
		assert.equal(rv.status, 0, rv.stdout);
		assert.equal((await call(`http://127.0.0.1:${port}/api/info`, { headers: { authorization: `Bearer ${token}` } })).status, 401);
		assert.equal(run('revoke', '--token', 'ci').status, 1, 'no token of that name now');
	});
});

describe('stop and come back', () => {
	test('stop, then selection brings it back on the same port, signed out: the old cookie gets 401 and the signed-out sentence; open pairs it again', { timeout: 60_000 }, async () => {
		assert.equal(run('stop').status, 0);
		assert.equal(run('status').status, 1);
		const r = run('selection');
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.equal(runtimeFile().port, port);
		const old = await host(port, cookie);
		assert.equal(old.status, 401, 'a restart signs the pane out');
		assert.equal(old.json.error, 'sign in: ask the chat to show the pane (dt web open)');
		const fresh = await signIn(/(http\S+)$/.exec(run('open').lines[0])[1]);
		assert.equal((await host(port, fresh.cookie)).status, 200, 'one dt web open signs it in again');
		cookie = fresh.cookie;
	});

	test('revoke signs the page out while the server keeps running', async () => {
		assert.equal((await host(port, cookie)).status, 200);
		const rv = run('revoke');
		assert.equal(rv.status, 0, rv.stdout);
		assert.equal(rv.stdout.trim(), '✔ revoked 1 session(s)');
		assert.equal(run('status').status, 0, 'still running');
		assert.equal((await host(port, cookie)).status, 401);
	});

	test('stop --revoke, then start: the old cookie is refused', { timeout: 60_000 }, async () => {
		const fresh = await signIn(/(http\S+)$/.exec(run('open').lines[0])[1]);
		assert.equal(run('stop', '--revoke').status, 0);
		const r = run('start');
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.equal(r.stdout.trim(), `running at http://127.0.0.1:${port}`);
		assert.equal((await host(port, fresh.cookie)).status, 401);
	});

	test('revoke with no server running starts nothing: no page is signed in to revoke', () => {
		assert.equal(run('stop').status, 0);
		const rv = run('revoke');
		assert.equal(rv.status, 0, rv.stdout);
		assert.equal(rv.stdout.trim(), '✔ revoked 0 session(s)');
		assert.equal(run('status').status, 1, 'revoke started nothing');
		assert.equal(run('start').status, 0);
	});
});

describe('the grammar', () => {
	test('an unknown verb or flag exits 2 naming the usage', () => {
		for (const bad of [['launch'], ['open', '--admin', '--read'], ['open', '--host', '0.0.0.0'], ['show'], ['select'], ['hook'], ['token', '--admin'], ['start', '--port', 'x'], ['start', '--idle'], ['status', 'now'], ['url']]) {
			const r = run(...bad);
			assert.equal(r.status, 2, bad.join(' '));
			assert.match(r.stderr, /usage: dt web /, bad.join(' '));
		}
	});
});
