// What every host test shares: the fake Engine API as a CHILD process (fake-docker.js says why), and
// the real `dt-host` binary run against it with DT_HOME in a temp dir — so no test reads or writes the
// real ~/.dreamteamer or reaches a real Docker. Every spawn and every request here carries a timer.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BIN = path.join(PKG, 'bin', 'dt-host.js');
const FAKE = path.join(PKG, 'test', 'helpers', 'fake-docker.js');
export const HQ = 'ghcr.io/dreamteamer/hq:0.6.0'; // the package's pinned default template tag
export const SPAWN_TIMEOUT_MS = 30_000;

/** One request to the fake's control routes, bounded at 5 s. */
export function fakeRequest(sock, method, urlPath, body) {
	return new Promise((resolve, reject) => {
		const payload = body === undefined ? undefined : JSON.stringify(body);
		// agent:false — a kept-alive socket the fake closed while idle fails EPIPE on reuse (seen on Node 26)
		const req = http.request({ agent: false, socketPath: sock, method, path: urlPath, headers: payload ? { 'content-type': 'application/json' } : {} }, (res) => {
			let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; });
			res.on('end', () => { try { resolve(b ? JSON.parse(b) : null); } catch { resolve(b); } });
		});
		req.setTimeout(5000, () => req.destroy(new Error(`fake docker did not answer ${method} ${urlPath} within 5s`)));
		req.on('error', reject);
		req.end(payload);
	});
}

/** The fake as a child process; resolves once it prints `ready` (or fails after 10 s). `fsRoot` gives
 *  every container a real folder for `/`, so …/archive is the system tar over real files. */
export function startFakeDocker(sock, { images = [], plain = [], fsRoot } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [FAKE, sock, JSON.stringify(images), JSON.stringify(plain)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ...(fsRoot ? { FAKE_DOCKER_FS: fsRoot } : {}) } });
		const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('fake docker did not start within 10s')); }, 10_000);
		child.stdout.on('data', (d) => { if (String(d).includes('ready')) { clearTimeout(timer); resolve(handle); } });
		child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`fake docker exited ${code}`)); });
		const handle = {
			state: () => fakeRequest(sock, 'GET', '/_fake/state'),
			// the next request whose path starts with `prefix` is accepted and never answered
			hangNext: (prefix) => fakeRequest(sock, 'POST', `/_fake/hang${prefix ? `?path=${encodeURIComponent(prefix)}` : ''}`),
			// the next exec whose argv starts with `match` (space-joined) fails with exit 1
			failExec: (match) => fakeRequest(sock, 'POST', `/_fake/fail-exec?match=${encodeURIComponent(match)}`),
			// when the next exec whose argv starts with `match` arrives, truncate `file` on the host to `bytes`
			truncateOnExec: (match, file, bytes) => fakeRequest(sock, 'POST', `/_fake/truncate-on-exec?match=${encodeURIComponent(match)}&file=${encodeURIComponent(file)}&bytes=${bytes}`),
			// … or overwrite it with a copy of `from`
			swapOnExec: (match, file, from) => fakeRequest(sock, 'POST', `/_fake/truncate-on-exec?match=${encodeURIComponent(match)}&file=${encodeURIComponent(file)}&copy=${encodeURIComponent(from)}`),
			post: (p, body) => fakeRequest(sock, 'POST', p, body),
			close: () => new Promise((ok) => {
				const t = setTimeout(() => { child.kill('SIGKILL'); ok(); }, 5000);
				child.once('exit', () => { clearTimeout(t); ok(); }); child.kill();
			}),
		};
	});
}

/** A temp dir holding a socket path, a DT_HOME and a cwd with no workspace above it, and a `dt`
 *  that runs the binary there. A trailing object on `dt(...)` overrides env for that one run. */
export function harness({ prefix = 'dth-', env: extraEnv = {} } = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	const sock = path.join(dir, 'd.sock');
	const home = path.join(dir, 'home');
	const bare = path.join(dir, 'bare');
	fs.mkdirSync(bare, { recursive: true });
	const { DT_EXPORT_PASSPHRASE, ...inherited } = process.env; // the suite's own env must never supply one
	for (const k of Object.keys(inherited)) if (k.startsWith('DT_')) delete inherited[k];
	const env = { ...inherited, DT_DOCKER_SOCKET: sock, DT_HOME: home, DT_HEALTH_TIMEOUT: '0', DT_PERSON_NAME: 'Test Person', DT_PERSON_EMAIL: 'test@example.invalid', ...extraEnv };
	const dt = (...args) => {
		const extra = typeof args[args.length - 1] === 'object' ? args.pop() : {};
		const r = spawnSync(process.execPath, [BIN, ...args], { cwd: bare, env: { ...env, ...extra }, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, killSignal: 'SIGKILL' });
		return { code: r.status, stdout: r.stdout, stderr: r.stderr, out: r.stdout + r.stderr + (r.error ? `\n[spawn] ${r.error.message}` : '') };
	};
	/** The binary as a background child, for a test that must act while it runs. */
	const spawnDt = (args, extra = {}) => spawn(process.execPath, [BIN, ...args], { cwd: bare, env: { ...env, ...extra }, stdio: 'ignore' });
	return { dir, sock, home, bare, env, dt, spawnDt, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
