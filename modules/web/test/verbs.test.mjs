// The verbs (cr-modules-017 §8; rnd/tests/dreamteamer-modules/pane-a2-restart-keeps-the-pane, process half;
// pane-a3-one-listener-one-process, process half): `dt web open` starts ONE detached server with ONE loopback listener
// and prints a sign-in URL that lands on its target; `dt serve` is a client token of that same process; a stop and
// the next verb bring it back on the same port with the pane signed out (sessions live in memory only — the security
// sign-off) until the next open pairs it; show, select, token, revoke, list, the level flags and the usage line. Every server is stopped in after().
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
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

	test('list names a registered root by the name it has now', () => {
		const file = path.join(f.root, 'package.json');
		const before = fs.readFileSync(file, 'utf8');
		fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(before), name: 'lab-renamed' }, null, '\t') + '\n');
		try {
			const list = run('list');
			assert.equal(list.status, 0);
			assert.match(list.stdout, /^lab-renamed · /m, list.stdout);
		} finally { fs.writeFileSync(file, before); }
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
	test('with the state dir read-only, token and revoke --token refuse naming the dir, as open does, and the earlier token keeps working', { skip: process.getuid?.() === 0 ? 'root ignores the mode' : false }, async () => {
		const minted = run('token', '--name', 'serve');
		assert.equal(minted.status, 0, minted.stdout + minted.stderr);
		const first = minted.lines[1].replace(/^token /, '');
		const info = async () => (await call(`http://127.0.0.1:${port}/api/info`, { headers: { authorization: `Bearer ${first}` } })).status;
		assert.equal(await info(), 200);
		const stateFile = () => fs.readdirSync(f.state).filter((n) => n !== 'registry.json').map((n) => fs.readFileSync(path.join(f.state, n), 'utf8')).join('\n');
		const before = stateFile();
		fs.chmodSync(f.state, 0o500);
		try {
			const open = run('open');
			assert.equal(open.status, 2, 'open, the reference: ' + open.stdout + open.stderr);
			const said = (r) => r.stdout + r.stderr;
			const named = (r) => said(r).includes(f.state) && /chmod 700/.test(said(r)) && /DT_WEB_STATE_DIR/.test(said(r));
			const again = run('token', '--name', 'serve');
			assert.equal(again.status, 2, said(again));
			assert.ok(named(again), `token did not name the dir and the fix:\n${said(again)}`);
			assert.doesNotMatch(said(again), /^token /m, 'no token printed');
			assert.equal(await info(), 200, 'a refused re-mint never ends the earlier token');
			const rv = run('revoke', '--token', 'serve');
			assert.equal(rv.status, 2, said(rv));
			assert.ok(named(rv), `revoke --token did not name the dir and the fix:\n${said(rv)}`);
			assert.equal(await info(), 200, 'a refused revoke never ends the token');
			const none = run('revoke', '--token', 'nope');
			assert.equal(none.status, 1, said(none));
			assert.equal(none.stdout.trim(), 'no token named nope', 'nothing to write, so nothing refused');
			assert.equal(fs.statSync(f.state).mode & 0o777, 0o500, 'the mode the person set');
		} finally { fs.chmodSync(f.state, 0o700); }
		assert.equal(stateFile(), before, 'the state file is what it was');
		assert.equal(await info(), 200, 'and after the dir is writable again');
		assert.equal(run('revoke', '--token', 'serve').status, 0);
		assert.equal(await info(), 401);
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

describe('start, detached, with its flags', () => {
	const freePort = () => new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
	test('--port, --idle and --owner-pid reach the server the verb starts', { timeout: 60_000 }, async () => {
		run('stop');
		assert.equal(run('status').status, 1, 'stopped');
		const q = await freePort();
		const r = run('start', '--port', String(q), '--idle', '7', '--owner-pid', String(process.pid));
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.equal(r.stdout.trim(), `running at http://127.0.0.1:${q}`);
		const rt = runtimeFile();
		assert.equal(rt.port, q);
		assert.equal(rt.owner, process.pid);
		assert.equal(rt.idle, 7);
		assert.match(run('status').stdout, new RegExp(`running at http://127.0.0.1:${q} · .* · owner ${process.pid} · `));
	});
	test('on a running server a flag it already has is fine; one it does not is refused, naming the server and the way out', { timeout: 60_000 }, async () => {
		const rt = runtimeFile();
		assert.equal(run('start').status, 0);
		const same = run('start', '--port', String(rt.port), '--idle', '7', '--owner-pid', String(process.pid));
		assert.equal(same.status, 0, same.stdout + same.stderr);
		for (const flags of [['--port', String(await freePort())], ['--idle', '9'], ['--owner-pid', '1']]) {
			const r = run('start', ...flags);
			assert.equal(r.status, 1, `${flags.join(' ')}: ${r.stdout}${r.stderr}`);
			assert.match(r.stdout, new RegExp(`already running at http://127\\.0\\.0\\.1:${rt.port} — ${flags[0]} ${flags[1]} .*dt web stop`), flags.join(' '));
		}
		assert.equal(runtimeFile().pid, rt.pid, 'the server was not replaced');
	});
	test('--port 0 asks for any port, so it agrees with a running server on whatever port it has', { timeout: 60_000 }, () => {
		const rt = runtimeFile();
		const r = run('start', '--port', '0');
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.equal(r.stdout.trim(), `running at http://127.0.0.1:${rt.port}`);
		const env0 = spawnSync(process.execPath, [BIN, f.root, 'start'], { env: { ...env, DT_WEB_PORT: '0' }, encoding: 'utf8', timeout: 30_000 });
		assert.equal(env0.status, 0, env0.stdout + env0.stderr);
		assert.equal(runtimeFile().pid, rt.pid, 'the server was not replaced');
	});
	test('starts at the same instant: the ones that lose the start lock wait for the winner, never fail on its lock', { timeout: 60_000 }, async () => {
		run('stop');
		assert.equal(run('status').status, 1, 'stopped');
		const at = (args) => new Promise((resolve) => {
			const c = spawn(process.execPath, [BIN, f.root, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
			let out = '';
			c.stdout.on('data', (b) => { out += b; });
			c.stderr.on('data', (b) => { out += b; });
			const k = setTimeout(() => c.kill('SIGKILL'), 30_000);
			c.on('exit', (code) => { clearTimeout(k); resolve({ code, out }); });
		});
		const all = await Promise.all([at(['start']), at(['start']), at(['open']), at(['open'])]);
		for (const r of all) assert.equal(r.code, 0, r.out);
		const ports = new Set(all.map((r) => /127\.0\.0\.1:(\d+)/.exec(r.out)?.[1]));
		assert.equal(ports.size, 1, `one port: ${[...ports]}`);
		assert.equal(Number([...ports][0]), runtimeFile().port);
	});
	test('a --port another program holds fails at once, naming the port — never a wait or another port', { timeout: 60_000 }, async () => {
		run('stop');
		assert.equal(run('status').status, 1, 'stopped');
		const holder = http.createServer();
		await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve));
		const taken = holder.address().port;
		try {
			const r = run('start', '--port', String(taken));
			assert.notEqual(r.status, 0, r.stdout + r.stderr);
			assert.ok(r.ms < 8_000, `${r.ms} ms`);
			assert.match(r.stdout + r.stderr, new RegExp(`port ${taken} is taken`));
			assert.equal(run('status').status, 1, 'nothing runs');
		} finally { await new Promise((resolve) => holder.close(resolve)); }
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
