// `dt-web <root> start --foreground` — what `dt web open` runs detached, and a launch.json entry: the first stdout
// line says where it serves; status and stop answer from the per-user runtime directory (0700 / 0600, nothing in the
// workspace); --owner-pid stops the server when its owner exits, and CLAUDE_PID no longer does (cr-modules-017 §2);
// two starts at once serve once. Every child is bounded by a timeout and killed in after().
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
	env = { ...process.env, DT_WEB_RUNTIME_DIR: path.join(runtime, 'rt'), DT_WEB_STATE_DIR: f.state, DT_WEB_APP_DIR: f.app, CLAUDE_PID: '' };
});
after(() => { for (const c of children) try { c.kill('SIGKILL'); } catch { /* gone */ } f?.cleanupAll(); fs.rmSync(runtime, { recursive: true, force: true }); });

const run = (...args) => spawnSync(process.execPath, [BIN, f.root, ...args], { env, encoding: 'utf8', timeout: 30_000 });
function start(args = [], extraEnv = {}) {
	const c = spawn(process.execPath, [BIN, f.root, 'start', '--foreground', '--idle', '0', ...args], { env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
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

test('start --foreground says where it serves; status and stop answer; the state is private and outside the workspace', { timeout: 120_000 }, async () => {
	assert.equal(run('status').status, 1, 'not running yet');
	const { child, first } = start();
	const line = await first;
	assert.match(line, /^✔ dt web serving lab at http:\/\/127\.0\.0\.1:\d+ · pid \d+$/);
	assert.equal(line.includes('sign-in'), false, 'a sign-in URL is open\'s to print');
	const status = run('status');
	assert.equal(status.status, 0, status.stdout + status.stderr);
	assert.match(status.stdout, /^running at http:\/\/127\.0\.0\.1:\d+ · pid \d+ · level Edit · since /);
	const dir = env.DT_WEB_RUNTIME_DIR;
	assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
	const [file] = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
	assert.equal(fs.statSync(path.join(dir, file)).mode & 0o777, 0o600);
	assert.equal(f.git(['status', '--porcelain', '--ignored', '--', '.dreamteamer']).includes('web'), false, 'a web file in the workspace');
	assert.equal(run('stop').status, 0);
	assert.ok(await exited(child, 10_000), 'the server did not exit');
	assert.equal(run('status').status, 1);
	assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.json') || n.endsWith('.lock')), [], 'the runtime file was left behind');
});

test('CLAUDE_PID is not an owner: a server started with one outlives that process', { timeout: 120_000 }, async () => {
	const owner = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
	children.push(owner);
	const { child, first } = start([], { CLAUDE_PID: String(owner.pid) });
	await first;
	owner.kill('SIGKILL');
	assert.equal(await exited(child, 7_000), false, 'the server stopped with CLAUDE_PID');
	assert.equal(run('stop').status, 0);
	assert.ok(await exited(child, 10_000));
});

test('--owner-pid: the server stops within ten seconds of its owner exiting', { timeout: 120_000 }, async () => {
	const owner = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
	children.push(owner);
	const { child, first } = start(['--owner-pid', String(owner.pid)]);
	await first;
	owner.kill('SIGKILL');
	assert.ok(await exited(child, 10_000), 'the server outlived its owner');
	assert.equal(run('status').status, 1);
});

test('flags are exact: an unknown flag or a bad number is refused before anything listens', () => {
	for (const bad of [['--host', '0.0.0.0'], ['start', '--port', 'x'], ['start', '--idle'], ['start', '--host', '0.0.0.0'], ['--no-open']]) {
		const r = run(...bad);
		assert.equal(r.status, 2, bad.join(' '));
	}
});

test('two starts at the same moment: one serves, the other refuses naming it — never two servers', { timeout: 120_000 }, async () => {
	const a = spawn(process.execPath, [BIN, f.root, 'start', '--foreground', '--idle', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
	const b = spawn(process.execPath, [BIN, f.root, 'start', '--foreground', '--idle', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
	children.push(a, b);
	const firstLine = (c) => new Promise((resolve) => { let out = ''; c.stdout.on('data', (x) => { out += x; if (out.includes('\n')) resolve(out.split('\n')[0]); }); c.on('exit', () => resolve(out.split('\n')[0])); });
	const [la, lb] = await Promise.all([firstLine(a), firstLine(b)]);
	const serving = [la, lb].filter((l) => /^✔ dt web serving/.test(l));
	assert.equal(serving.length, 1, `both or neither served: ${JSON.stringify([la, lb])}`);
	const refused = la === serving[0] ? b : a;
	assert.ok(await exited(refused, 15_000), 'the second start kept running');
	assert.equal(refused.exitCode, 1);
	assert.equal(run('status').status, 0, 'dt web status does not name the one serving');
	assert.equal(run('stop').status, 0);
});

test('a stop is clean: dt web stop and SIGTERM each end the server with exit 0 and leave no lock', { timeout: 120_000 }, async () => {
	for (const how of ['stop', 'SIGTERM']) {
		const { child, first } = start();
		await first;
		if (how === 'stop') assert.equal(run('stop').status, 0);
		else child.kill('SIGTERM');
		assert.ok(await exited(child, 15_000), `${how}: the server did not exit`);
		assert.equal(child.exitCode, 0, `${how}: exit ${child.exitCode}`);
		assert.deepEqual(fs.readdirSync(path.join(runtime, 'rt')).filter((n) => n.endsWith('.lock')), [], `${how}: a lock is left`);
	}
});

test('a stale lock is taken over by one claimant only; a takeover in progress refuses the next', async () => {
	const { claimStart } = await import('../src/runtime.js');
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-web-lock-'));
	const file = path.join(dir, 'ws.json');
	fs.writeFileSync(`${file}.lock`, '999999');
	fs.writeFileSync(`${file}.lock.takeover`, String(process.ppid));
	assert.equal(claimStart(file, process.pid).ok, false, 'a live takeover is in progress — the claim must wait its turn');
	fs.rmSync(`${file}.lock.takeover`);
	const first = claimStart(file, process.pid);
	assert.equal(first.ok, true);
	const second = claimStart(file, process.pid + 1);
	assert.deepEqual([second.ok, second.pid], [false, process.pid]);
	first.release();
	first.release();
	assert.ok(!fs.existsSync(`${file}.lock`));
	fs.rmSync(dir, { recursive: true, force: true });
});

// review round 1 (a-stale-runtime-file-with-a-reused-pid-blocks-open-and-stop-signals-a-stranger): a runtime file whose
// process is alive but is not this workspace's server — a hard-killed server's pid reused by another program, which
// here also answers every request on the port — is stale for status, open and stop alike
test('a stale runtime file whose pid another program holds: status says not running, open starts a fresh server promptly, stop removes it and signals nothing', { timeout: 120_000 }, async () => {
	const { readState, stateFile, writeState } = await import('../src/runtime.js');
	const stranger = spawn(process.execPath, ['-e', "require('node:http').createServer((q, s) => { s.writeHead(200, { 'content-type': 'application/json' }); s.end('{\"connected\":true,\"url\":\"http://127.0.0.1:1/sign-in/x\",\"proof\":\"x\"}'); }).listen(0, '127.0.0.1', function () { console.log(this.address().port); }); setTimeout(() => {}, 120000);"], { stdio: ['ignore', 'pipe', 'ignore'] });
	children.push(stranger);
	const port = await new Promise((resolve, reject) => { stranger.stdout.once('data', (b) => resolve(Number(String(b).trim()))); stranger.once('exit', () => reject(new Error('the stranger exited'))); });
	const file = stateFile(f.root, env.DT_WEB_RUNTIME_DIR);
	const forge = () => {
		writeState(file, { pid: stranger.pid, port, started: new Date().toISOString(), owner: null, token: 'the-dead-servers-token', instance: 'the-dead-servers-instance' });
		fs.writeFileSync(`${file}.lock`, String(stranger.pid), { mode: 0o600 });
	};
	forge();
	const status = run('status');
	assert.equal(status.status, 1, status.stdout + status.stderr);
	assert.match(status.stdout, /^not running/);

	const stop = run('stop');
	assert.equal(stop.status, 1, stop.stdout + stop.stderr);
	assert.match(stop.stdout, new RegExp(`^not running — removed a stale runtime file: pid ${stranger.pid} is not this workspace's server, and was not signalled`));
	assert.equal(fs.existsSync(file), false, 'the stale runtime file is still there');
	assert.equal(fs.existsSync(`${file}.lock`), false, 'the stale lock is still there');
	assert.equal(await exited(stranger, 500), false, 'stop signalled the stranger');

	forge();
	const t0 = Date.now();
	const open = run('open');
	const ms = Date.now() - t0;
	assert.equal(open.status, 0, open.stdout + open.stderr);
	assert.ok(ms < 10_000, `open took ${ms} ms`);
	assert.match(open.stdout, /^✔ open in the pane: http:\/\/127\.0\.0\.1:\d+\/sign-in\//);
	const fresh = readState(file);
	assert.notEqual(fresh.pid, stranger.pid);
	assert.notEqual(fresh.port, port, 'the fresh server is on its own port');
	assert.equal(run('status').status, 0);
	assert.equal(run('stop').status, 0);
	assert.equal(await exited(stranger, 300), false, 'the stranger was signalled');
});
