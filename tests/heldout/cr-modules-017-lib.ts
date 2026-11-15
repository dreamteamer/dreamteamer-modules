// Shared harness for cr-modules-017's held-out tests (h1-h7), written by the TEST STAGE from the held-out records'
// steps and expected alone. It reuses what the records name — modules/web/test/support.mjs (fixture, call, pair,
// sameOrigin) — and adds raw requests (node:http, so a path is sent exactly as written), the dt-web bin as a
// session runs it (per-test DT_WEB_STATE_DIR / DT_WEB_RUNTIME_DIR, DT_WEB_APP_DIR the built app), the prompt hook
// bin with a payload, and a page's event stream held open with the pane's cookie.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WEB = path.join(ROOT, 'modules', 'web');
export const BIN = path.join(WEB, 'bin', 'dt-web.mjs');
export const HOOK_BIN = path.join(WEB, 'bin', 'dt-web-hook.mjs');
export const APP_DIR = path.resolve(process.env.DT_WEB_APP_DIR ?? path.join(ROOT, 'modules', 'ui', 'dist', 'app'));
if (!fs.existsSync(path.join(APP_DIR, 'index.html'))) throw new Error(`no built app at ${APP_DIR} — npm run build -w modules/ui`);

const support = await import(pathToFileURL(path.join(WEB, 'test', 'support.mjs')).href);
export const { fixture, call, pair, sameOrigin } = support;
export const { startWeb } = await import(pathToFileURL(path.join(WEB, 'src', 'server.js')).href);
export const { ENGINE_DIR } = await import(pathToFileURL(path.join(ROOT, 'tests', 'helpers', 'fixture.mjs')).href);
export const { makeFixture } = await import(pathToFileURL(path.join(ROOT, 'modules', 'protocol', 'lib', 'contract', 'fixture.js')).href);
const runtime = await import(pathToFileURL(path.join(WEB, 'src', 'runtime.js')).href);
const stateMod = await import(pathToFileURL(path.join(WEB, 'src', 'state.js')).href);
export const workspaceKey = runtime.workspaceKey;
export const runtimeFile = (root, dir) => runtime.stateFile(root, dir);
export const stateFileOf = (root, dir) => stateMod.workspaceStateFile(root, dir);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmps = [];
export function tmpDir(prefix) {
	const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
	tmps.push(d);
	return d;
}
/** One machine's dt web dirs: a private state dir and runtime dir, and the env a session's verbs run under. */
export function machine() {
	const state = tmpDir('m017-state-');
	const rt = tmpDir('m017-rt-');
	const env = { ...process.env, DT_WEB_STATE_DIR: state, DT_WEB_RUNTIME_DIR: rt, DT_WEB_APP_DIR: APP_DIR, CLAUDE_PID: '' };
	return { state, runtime: rt, env };
}
export function cleanupTmps() { for (const d of tmps.splice(0)) { try { fs.chmodSync(d, 0o700); } catch { /* gone */ } fs.rmSync(d, { recursive: true, force: true }); } }

/** A Northwind workspace (the contract fixture) named `name`, with this package linked in as node_modules/@dreamteamer/web. */
export function workspaceNamed(name, { tmp } = {}) {
	const f = tmp ? makeFixture({ engineDir: ENGINE_DIR, tmp }) : makeFixture({ engineDir: ENGINE_DIR });
	const pkgFile = path.join(f.root, 'package.json');
	const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
	pkg.name = name;
	fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, '\t') + '\n');
	fs.mkdirSync(path.join(f.root, 'node_modules', '@dreamteamer'), { recursive: true });
	fs.symlinkSync(WEB, path.join(f.root, 'node_modules', '@dreamteamer', 'web'), 'dir');
	return f;
}

/** `dt-web <root> <args…>` — what `dt web <args…>` runs — synchronously, bounded. */
export function dtWeb(root, args, env, { timeout = 60_000, bin = BIN, node = process.execPath } = {}) {
	const t0 = Date.now();
	const r = spawnSync(node, [bin, root, ...args], { env, encoding: 'utf8', timeout, killSignal: 'SIGKILL' });
	return { code: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ms: Date.now() - t0 };
}
/** The same, as a promise (for two verbs at the same instant). */
export function dtWebAsync(root, args, env, { timeout = 60_000 } = {}) {
	return new Promise((resolve) => {
		const t0 = Date.now();
		const c = spawn(process.execPath, [BIN, root, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = ''; let stderr = '';
		c.stdout.on('data', (b) => { stdout += b; });
		c.stderr.on('data', (b) => { stderr += b; });
		const k = setTimeout(() => c.kill('SIGKILL'), timeout);
		c.on('exit', (code, signal) => { clearTimeout(k); resolve({ code, signal, stdout, stderr, ms: Date.now() - t0 }); });
	});
}
export const urlOf = (out) => /(http:\/\/127\.0\.0\.1:\d+\/sign-in\/\S+)/.exec(out)?.[1] ?? null;

/** The runtime file of a workspace's server: `{ pid, port, token, … }` or null. */
export function rtOf(root, m) {
	try { return JSON.parse(fs.readFileSync(runtimeFile(root, m.runtime), 'utf8')); } catch { return null; }
}
export function stateOf(root, m) {
	try { return JSON.parse(fs.readFileSync(stateFileOf(root, m.state), 'utf8')); } catch { return null; }
}

/** A request under the control token. */
export async function control(port, token, method, p, body) {
	return call(`http://127.0.0.1:${port}${p}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
}
/** Sign in through a sign-in URL; → the cookie pair `dt_pane_<port>=<sid>` (throws when it does not sign in). */
export async function signIn(url) {
	const r = await call(url);
	if (r.status !== 302) throw new Error(`sign-in answered ${r.status}: ${r.text}`);
	return r.headers.get('set-cookie').split(';')[0];
}
/** A request from the pane's page: the cookie and Sec-Fetch-Site: same-origin. */
export async function page(base, cookie, method, p, body, headers = {}) {
	return call(`${base}${p}`, { method, headers: { cookie, ...sameOrigin(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
}

/** A raw request with node:http: the path goes out exactly as written. → { status, headers, body } */
export function raw(url, { method = 'GET', headers = {}, body, path: p } = {}) {
	return new Promise((resolve, reject) => {
		const u = new URL(url);
		const req = http.request({ host: u.hostname, port: u.port, path: p ?? (u.pathname + u.search), method, headers, timeout: 20_000 }, (res) => {
			const chunks = [];
			res.on('data', (c) => chunks.push(c));
			res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
		});
		req.on('error', reject);
		req.on('timeout', () => req.destroy(new Error('timeout')));
		if (body !== undefined) req.write(body);
		req.end();
	});
}

/** A page's event stream held open with the cookie; `.messages` collects each `data:` JSON; `.close()` ends it. */
export async function stream(base, cookie) {
	const ac = new AbortController();
	const res = await fetch(`${base}/api/events`, { headers: { cookie, ...sameOrigin() }, signal: ac.signal });
	if (res.status !== 200) throw new Error(`events answered ${res.status}`);
	const messages = [];
	(async () => {
		const reader = res.body.getReader();
		const dec = new TextDecoder();
		let buf = '';
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buf += dec.decode(value, { stream: true });
				let i;
				while ((i = buf.indexOf('\n\n')) >= 0) {
					const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
					const data = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
					if (data) { try { messages.push(JSON.parse(data)); } catch { messages.push(data); } }
				}
			}
		} catch { /* closed */ }
	})();
	await sleep(150);
	return { messages, close: () => ac.abort() };
}

/** The prompt hook bin, as the harness runs it: the payload on stdin; → { code, stdout, stderr, ms }. */
export function hook(payload, env, { node = process.execPath, bin = HOOK_BIN } = {}) {
	return new Promise((resolve) => {
		const t0 = Date.now();
		const c = spawn(node, [bin], { env, stdio: ['pipe', 'pipe', 'pipe'] });
		let stdout = ''; let stderr = '';
		c.stdout.on('data', (b) => { stdout += b; });
		c.stderr.on('data', (b) => { stderr += b; });
		const k = setTimeout(() => c.kill('SIGKILL'), 10_000);
		c.on('exit', (code) => { clearTimeout(k); resolve({ code, stdout, stderr, ms: Date.now() - t0 }); });
		c.stdin.end(JSON.stringify(payload));
	});
}
export const payload = (cwd, session = 'sess-1') => ({ session_id: session, transcript_path: '/dev/null', cwd, hook_event_name: 'UserPromptSubmit', prompt: 'what is selected?' });

/** The pids listening on a TCP port (lsof), [] when none. */
export function listeners(port) {
	const r = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
	return [...new Set((r.stdout ?? '').split('\n').filter(Boolean))];
}
/** lsof rows for the 127.0.0.1 listener on a port. */
export function v4Listeners(port) {
	const r = spawnSync('lsof', ['-nP', `-iTCP@127.0.0.1:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
	return (r.stdout ?? '').split('\n').slice(1).filter(Boolean);
}
export function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

/** Stop a workspace's server through the verb, and make sure nothing is left. */
export function stopAll(roots, m) {
	for (const r of roots) {
		try { dtWeb(r, ['stop'], m.env, { timeout: 15_000 }); } catch { /* best effort */ }
		const rt = rtOf(r, m);
		if (rt?.pid && alive(rt.pid)) { try { process.kill(rt.pid, 'SIGKILL'); } catch { /* gone */ } }
	}
}

/** A free TCP port on 127.0.0.1. */
export function freePort() {
	return new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
