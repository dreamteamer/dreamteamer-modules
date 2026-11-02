// The packed install: what a stranger's workspace gets from npm. protocol and web are packed, unpacked into a
// fresh workspace's node_modules and compiled (the session skill with it); then `dt web` runs through the ENGINE'S OWN CLI — help lists it,
// status answers "not running" (exit 1), and the `web` row of `dt doctor` says "not running" and then, while a
// server started by `dt web --no-open` is up, "running at" its address. Every child is bounded and killed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { virginWorkspace, installPacked, packedFiles, cleanup, BIN, ENGINE } from '../../../tests/helpers/workspace.mjs';

const children = [];
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-web-packed-'));
after(() => { for (const c of children) try { c.kill('SIGKILL'); } catch { /* gone */ } cleanup(); fs.rmSync(scratch, { recursive: true, force: true }); });

// a minimal app, so the test needs no vendored build (CI has none)
const app = path.join(scratch, 'app');
fs.mkdirSync(path.join(app, 'assets'), { recursive: true });
fs.writeFileSync(path.join(app, 'browser.html'), '<!doctype html><html><head><title>dreamteamer</title></head><body></body></html>');
const env = { ...process.env, DT_WEB_RUNTIME_DIR: path.join(scratch, 'rt'), DT_WEB_APP_DIR: app, CLAUDE_PID: '', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const dt = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL' });
const webRow = (out) => out.split('\n').find((l) => /\bweb\b/.test(l) && /running/.test(l)) ?? '';

test('the tarball ships the bin, the source, the vendor script and the pin — never the tests', () => {
	const files = packedFiles('web');
	for (const f of ['bin/dt-web.mjs', 'src/cli.js', 'src/server.js', 'src/extension.js', 'src/runtime.js', 'src/headers.js', 'scripts/vendor-app.mjs', 'dist/app/SOURCE.json', 'README.md', 'skills/serving-the-web-ui/SKILL.md']) assert.ok(files.includes(f), `${f} is not in the tarball`);
	assert.ok(!files.some((f) => f.startsWith('test/')), 'tests do not ship');
});

test('a workspace that installs the packed protocol and web compiles; dt web answers through the engine CLI; the doctor row follows a running server', { timeout: 180_000 }, async () => {
	assert.ok(fs.existsSync(BIN), `no engine at ${ENGINE}`);
	const ws = virginWorkspace();
	installPacked(ws, ['protocol', 'web']);
	const c = dt(ws, 'compile');
	assert.equal(c.status, 0, c.stderr + c.stdout);

	const skill = dt(ws, 'get', 'skills/serving-the-web-ui');
	assert.equal(skill.status, 0, `the session skill is not compiled in: ${skill.stderr}`);
	const help = dt(ws, 'help');
	assert.match(help.stdout, /web \[url\|status\|stop\]/, 'dt help lists the verb');
	const st = dt(ws, 'web', 'status');
	assert.equal(st.status, 1, st.stderr + st.stdout);
	assert.match(st.stdout, /^not running$/m);
	const before = dt(ws, 'doctor');
	assert.match(webRow(before.stdout), /not running/, `no web row saying "not running" in:\n${before.stdout}`);

	const child = spawn(process.execPath, [BIN, 'web', '--no-open', '--idle', '0'], { cwd: ws, env, stdio: ['ignore', 'pipe', 'pipe'] });
	children.push(child);
	const first = await new Promise((resolve, reject) => {
		let out = '', err = '';
		child.stdout.on('data', (b) => { out += b; if (out.includes('\n')) resolve(out.split('\n')[0]); });
		child.stderr.on('data', (b) => { err += b; });
		child.on('exit', (code) => reject(new Error(`dt web exited ${code} before printing: ${err}`)));
		setTimeout(() => reject(new Error(`no first line in 60 s: ${err}`)), 60_000).unref();
	});
	assert.match(first, /^✔ dreamteamer web at http:\/\/127\.0\.0\.1:(\d+)\/sign-in\/\S+$/);
	const port = /:(\d+)\//.exec(first)[1];
	const during = dt(ws, 'doctor');
	assert.match(webRow(during.stdout), new RegExp(`running at http://127\\.0\\.0\\.1:${port}`), `the web row does not name the running server:\n${during.stdout}`);
	const stop = dt(ws, 'web', 'stop');
	assert.equal(stop.status, 0, stop.stderr + stop.stdout);
	const gone = await new Promise((r) => { if (child.exitCode !== null) return r(true); const t = setTimeout(() => r(false), 15_000); child.once('exit', () => { clearTimeout(t); r(true); }); });
	assert.ok(gone, 'dt web stop left the server running');
	assert.match(webRow(dt(ws, 'doctor').stdout), /not running/);
});
