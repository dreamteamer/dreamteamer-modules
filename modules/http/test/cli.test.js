// `dt serve` through the ENGINE'S OWN CLI in a fixture workspace with the package installed — the
// loader, the dispatch and the process lifetime, as a stranger's workspace gets them.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { BIN, GIT_ENV, workspace } from '../../../test-support/fixture.mjs';

const START_TIMEOUT_MS = 30_000;
let h;

before(() => { h = workspace({ packages: ['http'] }); });

/** Spawn `dt serve …`, resolve once it prints its listening line. Killed by a hard timer either way. */
function startServe(cwd, args) {
	const child = spawn(process.execPath, [BIN, 'serve', ...args], { cwd, env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
	let stdout = '', stderr = '';
	const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
	const killer = setTimeout(() => child.kill('SIGKILL'), START_TIMEOUT_MS * 2);
	exited.then(() => clearTimeout(killer));
	const listening = new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error(`no listening line within ${START_TIMEOUT_MS}ms\nstdout: ${stdout}\nstderr: ${stderr}`)), START_TIMEOUT_MS);
		child.stdout.on('data', (b) => {
			stdout += b;
			const m = /✔ dreamteamer api at (http:\/\/\S+\/api)/.exec(stdout);
			if (m) { clearTimeout(t); resolve(m[1]); }
		});
		child.stderr.on('data', (b) => { stderr += b; });
		exited.then(({ code }) => { clearTimeout(t); reject(new Error(`dt serve exited ${code} before listening\nstdout: ${stdout}\nstderr: ${stderr}`)); });
	});
	return { child, listening, exited, output: () => ({ stdout, stderr }) };
}

describe('dt serve', () => {
	test('the engine CLI dispatches it, it stays up, answers a route, and dies when killed', async () => {
		const s = startServe(h.root, ['--port', '0']);
		try {
			const base = await s.listening;
			assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/api$/, 'loopback by default');
			const res = await fetch(`${base}/info`, { signal: AbortSignal.timeout(20_000) });
			assert.equal(res.status, 200);
			const info = await res.json();
			assert.equal(info.name, h.pkg.name);
			assert.ok(Array.isArray(info.collections) && info.collections.length > 0);
			assert.equal(s.child.exitCode, null, 'still running after answering — the verb keeps the process alive');
		} finally {
			s.child.kill('SIGTERM');
		}
		const { signal } = await s.exited;
		assert.equal(signal, 'SIGTERM');
	});

	test('an unknown flag is refused before anything listens', async () => {
		const r = h.dt('serve', '--admin');
		assert.equal(r.code, 1);
		assert.match(r.stderr, /does not take "--admin"/);
		assert.equal(r.stdout, '');
	});

	test('dt status lists the extension and dt help appends its usage', () => {
		const status = h.dt('status');
		assert.match(status.stdout, /extensions: .*@dreamteamer\/http@0\.1\.0/);
		const help = h.dt('help');
		assert.match(help.stdout, /@dreamteamer\/http@0\.1\.0:\n\s+serve \[--port <n>\] \[--host <addr>\]/);
	});

	test('without the package the engine does not serve — it says the verb left core, exit 2', () => {
		const bare = workspace();
		const r = bare.dt('serve', '--port', '0');
		assert.equal(r.code, 2);
		assert.match(r.stderr, /`dt serve` left core in 0\.31\.0/);
	});
});
