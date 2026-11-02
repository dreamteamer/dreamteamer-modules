// dt-web as a person or a session runs it: the first stdout line is the sign-in URL; status, url and stop
// answer from the per-user runtime directory (0700 / 0600, nothing in the workspace); --owner-pid stops the
// server when its owner exits. Every child is bounded by a timeout and killed in after().
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './support.mjs';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'dt-web.mjs');
let f, runtime, env;
const children = [];
before(() => {
	f = fixture();
	runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-web-runtime-'));
	env = { ...process.env, DT_WEB_RUNTIME_DIR: path.join(runtime, 'rt'), DT_WEB_APP_DIR: f.app, CLAUDE_PID: '' };
});
after(() => { for (const c of children) try { c.kill('SIGKILL'); } catch { /* gone */ } f?.cleanupAll(); fs.rmSync(runtime, { recursive: true, force: true }); });

const run = (...args) => spawnSync(process.execPath, [BIN, f.root, ...args], { env, encoding: 'utf8', timeout: 30_000 });
function start(...args) {
	const c = spawn(process.execPath, [BIN, f.root, '--no-open', '--idle', '0', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
	children.push(c);
	const first = new Promise((resolve, reject) => {
		let out = '';
		c.stdout.on('data', (b) => { out += b; const line = out.split('\n')[0]; if (out.includes('\n')) resolve(line); });
		c.on('exit', (code) => reject(new Error(`exited ${code} before printing`)));
		setTimeout(() => reject(new Error('no first line in 30 s')), 30_000).unref();
	});
	return { child: c, first };
}
const exited = (c, ms) => new Promise((resolve) => { if (c.exitCode !== null) return resolve(true); const t = setTimeout(() => resolve(false), ms); c.once('exit', () => { clearTimeout(t); resolve(true); }); });

test('start prints the sign-in URL first; status, url and stop answer; the state is private and outside the workspace', { timeout: 120_000 }, async () => {
	assert.equal(run('status').status, 1, 'not running yet');
	const { child, first } = start();
	const line = await first;
	assert.match(line, /^✔ dreamteamer web at http:\/\/127\.0\.0\.1:\d+\/sign-in\/[\w-]+$/);
	const status = run('status');
	assert.equal(status.status, 0, status.stdout + status.stderr);
	assert.match(status.stdout, /^running at http:\/\/127\.0\.0\.1:\d+ · pid \d+ · since /);
	const dir = env.DT_WEB_RUNTIME_DIR;
	assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
	const [file] = fs.readdirSync(dir);
	assert.equal(fs.statSync(path.join(dir, file)).mode & 0o777, 0o600);
	assert.equal(f.git(['status', '--porcelain', '--ignored', '--', '.dreamteamer']).includes('web'), false, 'a web file in the workspace');
	const url = run('url');
	assert.equal(url.status, 0, url.stderr);
	assert.match(url.stdout.trim(), /^http:\/\/127\.0\.0\.1:\d+\/sign-in\/[\w-]+$/);
	assert.notEqual(url.stdout.trim(), line.split(' at ')[1], 'url reprinted the same code');
	assert.equal(run('stop').status, 0);
	assert.ok(await exited(child, 10_000), 'the server did not exit');
	assert.equal(run('status').status, 1);
	assert.deepEqual(fs.readdirSync(dir), [], 'the state file was left behind');
});

test('--owner-pid: the server stops within ten seconds of its owner exiting', { timeout: 120_000 }, async () => {
	const owner = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
	children.push(owner);
	const { child, first } = start('--owner-pid', String(owner.pid));
	await first;
	owner.kill('SIGKILL');
	assert.ok(await exited(child, 10_000), 'the server outlived its owner');
	assert.equal(run('status').status, 1);
});

test('flags are exact: an unknown flag or a bad number is refused before anything listens', () => {
	for (const bad of [['--host', '0.0.0.0'], ['--port', 'x'], ['--idle']]) {
		const r = run(...bad);
		assert.equal(r.status, 2, bad.join(' '));
	}
});

test('two starts at the same moment: one serves, the other refuses naming it — never two servers', { timeout: 120_000 }, async () => {
	const a = spawn(process.execPath, [BIN, f.root, '--no-open', '--idle', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
	const b = spawn(process.execPath, [BIN, f.root, '--no-open', '--idle', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
	children.push(a, b);
	const firstLine = (c) => new Promise((resolve) => { let out = ''; c.stdout.on('data', (x) => { out += x; if (out.includes('\n')) resolve(out.split('\n')[0]); }); c.on('exit', () => resolve(out.split('\n')[0])); });
	const [la, lb] = await Promise.all([firstLine(a), firstLine(b)]);
	const serving = [la, lb].filter((l) => /^✔ dreamteamer web at/.test(l));
	assert.equal(serving.length, 1, `both or neither served: ${JSON.stringify([la, lb])}`);
	const refused = la === serving[0] ? b : a;
	assert.ok(await exited(refused, 15_000), 'the second start kept running');
	assert.equal(refused.exitCode, 1);
	assert.equal(run('status').status, 0, 'dt web status does not name the one serving');
	assert.equal(run('stop').status, 0);
});
