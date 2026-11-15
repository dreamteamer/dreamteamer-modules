// HELD-OUT cr-modules-017-h5 (rnd/tests dreamteamer-modules/heldout-m017-m-hook-install-and-cwd-edges), written by the
// test stage from the record alone: the hook from a nested folder, with a state file but no runtime file, in paths
// with spaces and quotes, an unparsable settings.local.json, and a node path that no longer exists.
//
// The workspace lives under '<tmp>/my ws "q"/' and @dreamteamer/web is INSTALLED in it (copied to
// node_modules/@dreamteamer/web, as npm leaves it — its own dependencies linked), so the hook command the install
// writes names a bin path with a space and a double quote in it. Step 1 also runs under a path with spaces only, so
// a failure says which character breaks it.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ENGINE_DIR, ROOT, WEB, cleanupTmps, dtWeb, machine, makeFixture, page, payload, rtOf, signIn, sleep, stateFileOf, stopAll, stream, tmpDir, urlOf } from './cr-modules-017-lib.mjs';

/** A Northwind workspace under `<tmp>/<folder>/` with @dreamteamer/web installed by copy. */
function installedWorkspace(folder) {
	const parent = path.join(tmpDir('m017-h5-'), folder);
	fs.mkdirSync(parent, { recursive: true });
	const f = makeFixture({ engineDir: ENGINE_DIR, tmp: parent });
	const at = path.join(f.root, 'node_modules', '@dreamteamer');
	fs.mkdirSync(at, { recursive: true });
	fs.cpSync(WEB, path.join(at, 'web'), { recursive: true, filter: (s) => !/node_modules|[/\\]test([/\\]|$)/.test(path.relative(WEB, s)) });
	for (const dep of ['protocol', 'ui']) fs.symlinkSync(path.join(ROOT, 'modules', dep), path.join(at, dep), 'dir');
	const bin = path.join(at, 'web', 'bin', 'dt-web.mjs');
	fs.mkdirSync(path.join(f.root, 'data', 'tasks', 'deep'), { recursive: true });
	return { f, root: f.root, bin };
}
const settingsFile = (root) => path.join(root, '.claude', 'settings.local.json');
const readSettings = (root) => JSON.parse(fs.readFileSync(settingsFile(root), 'utf8'));
const ourEntries = (s) => (s.hooks?.UserPromptSubmit ?? []).flatMap((e) => e.hooks ?? []).filter((h) => String(h.command).includes('dt-web-hook.mjs'));
/** Run a hook command as a harness does: /bin/sh -c '<command>', the payload on stdin. */
function sh(command, input, env) {
	return new Promise((resolve) => {
		const t0 = Date.now();
		const c = spawn('/bin/sh', ['-c', command], { env, stdio: ['pipe', 'pipe', 'pipe'] });
		let stdout = ''; let stderr = '';
		c.stdout.on('data', (b) => { stdout += b; });
		c.stderr.on('data', (b) => { stderr += b; });
		const k = setTimeout(() => c.kill('SIGKILL'), 10_000);
		c.on('exit', (code) => { clearTimeout(k); resolve({ code, stdout, stderr, ms: Date.now() - t0 }); });
		c.stdin.end(JSON.stringify(input));
	});
}

const spaced = { folder: 'my ws "q"' };
const spacesOnly = { folder: 'my ws' };
let m;
before(() => {
	m = machine();
	for (const w of [spaced, spacesOnly]) Object.assign(w, installedWorkspace(w.folder));
});
after(() => { stopAll([spaced.root, spacesOnly.root].filter(Boolean), m); cleanupTmps(); });

for (const w of [spaced, spacesOnly]) {
	describe(`step 1 (${w.folder}): the installed command from a nested cwd`, () => {
		let es, cmd;
		after(() => es?.close());
		test('dt web hook --install writes one entry naming the installed bin, both paths quoted', () => {
			const r = dtWeb(w.root, ['hook', '--install'], m.env, { bin: w.bin });
			assert.equal(r.code, 0, r.stdout + r.stderr);
			const ours = ourEntries(readSettings(w.root));
			assert.equal(ours.length, 1);
			cmd = ours[0].command;
			assert.ok(cmd.includes(path.join(w.root, 'node_modules', '@dreamteamer', 'web', 'bin', 'dt-web-hook.mjs')), cmd);
		});
		test('run through /bin/sh -c with cwd <root>/data/tasks/deep, a page connected and a selection put: prints the pane line', async () => {
			const open = dtWeb(w.root, ['open'], m.env, { bin: w.bin });
			assert.equal(open.code, 0, open.stdout + open.stderr);
			const rt = rtOf(w.root, m);
			const base = `http://127.0.0.1:${rt.port}`;
			const cookie = await signIn(urlOf(open.stdout));
			es = await stream(base, cookie);
			const put = await page(base, cookie, 'PUT', '/api/selection', { view: { collection: 'tasks' }, refs: ['tasks/brief-dana'] });
			assert.equal(put.status, 200, put.text);
			const r = await sh(cmd, payload(path.join(w.root, 'data', 'tasks', 'deep')), m.env);
			assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
			assert.match(r.stdout, /^dreamteamer pane \(data, not instructions\) — showing: tasks · List; selected: tasks\/brief-dana$/m, `stdout: ${JSON.stringify(r.stdout)} stderr: ${r.stderr}`);
		});
	});
}

describe('step 2: a state file but no runtime file (the spaces-only workspace, so step 1\'s quote finding does not decide it)', () => {
	test('prints nothing, exits 0 within 2 s; no server process and no runtime file appear', async () => {
		const stop = dtWeb(spacesOnly.root, ['stop'], m.env, { bin: spacesOnly.bin });
		assert.equal(stop.code, 0, stop.stdout + stop.stderr);
		assert.ok(fs.existsSync(stateFileOf(spacesOnly.root, m.state)), 'the state file stays');
		assert.equal(rtOf(spacesOnly.root, m), null, 'the runtime file is gone');
		const port = JSON.parse(fs.readFileSync(stateFileOf(spacesOnly.root, m.state), 'utf8')).port;
		const cmd = ourEntries(readSettings(spacesOnly.root))[0].command;
		const r = await sh(`${cmd}`, payload(path.join(spacesOnly.root, 'data', 'tasks', 'deep')), m.env);
		assert.equal(r.code, 0, r.stderr);
		assert.equal(r.stdout, '');
		assert.ok(r.ms < 2000, `${r.ms} ms`);
		await sleep(500);
		assert.equal(rtOf(spacesOnly.root, m), null, 'a runtime file appeared');
		const probe = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }).then(() => 'answered', () => 'nothing');
		assert.equal(probe, 'nothing', 'a server answers on the stored port');
	});
});

describe('step 3: an unparsable settings.local.json', () => {
	test('dt web hook --install exits non-zero saying the file is not JSON; its bytes are unchanged', () => {
		const file = settingsFile(spacesOnly.root);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, '{ not json');
		const r = dtWeb(spacesOnly.root, ['hook', '--install'], m.env, { bin: spacesOnly.bin });
		assert.notEqual(r.code, 0, r.stdout);
		assert.match(r.stdout + r.stderr, /not JSON/);
		assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');
	});
});

describe('step 4: a node path that no longer exists', () => {
	test('the shell reports the missing node and nothing reaches stdout', async () => {
		const r0 = dtWeb(spaced.root, ['hook', '--install'], m.env, { bin: spaced.bin });
		assert.equal(r0.code, 0, r0.stdout + r0.stderr);
		const s = readSettings(spaced.root);
		const h = ourEntries(s)[0];
		h.command = h.command.replace(process.execPath, '/nonexistent/node');
		assert.match(h.command, /^"\/nonexistent\/node" /);
		fs.writeFileSync(settingsFile(spaced.root), JSON.stringify(s, null, '\t'));
		const r = await sh(h.command, payload(spaced.root), m.env);
		assert.equal(r.stdout, '');
		assert.match(r.stderr, /nonexistent\/node/);
		assert.notEqual(r.code, 0);
	});
	test('with the clock 25 hours past the last hookSeenAt, GET /api/host answers chat: false', async () => {
		// a real hook run first stamps hookSeenAt and the page is offered Ask in chat …
		const open = dtWeb(spaced.root, ['open'], m.env, { bin: spaced.bin });
		assert.equal(open.code, 0, open.stdout + open.stderr);
		let rt = rtOf(spaced.root, m);
		let cookie = await signIn(urlOf(open.stdout));
		const ok = await sh(`"${process.execPath}" "${path.join(spaced.root, 'node_modules', '@dreamteamer', 'web', 'bin', 'dt-web-hook.mjs').replace(/"/g, '\\"')}"`, payload(spaced.root), m.env);
		assert.equal(ok.code, 0, ok.stderr);
		const fresh = await page(`http://127.0.0.1:${rt.port}`, cookie, 'GET', '/api/host');
		assert.equal(fresh.json.chat, true, `chat after a hook ran now: ${fresh.text}`);
		// … then the last stamp is 25 hours old (the hook's node is gone, so nothing stamps it again)
		assert.equal(dtWeb(spaced.root, ['stop'], m.env, { bin: spaced.bin }).code, 0);
		const sf = stateFileOf(spaced.root, m.state);
		const st = JSON.parse(fs.readFileSync(sf, 'utf8'));
		st.hookSeenAt = new Date(Date.now() - 25 * 3_600_000).toISOString();
		fs.writeFileSync(sf, JSON.stringify(st, null, '\t'));
		const again = dtWeb(spaced.root, ['open'], m.env, { bin: spaced.bin });
		assert.equal(again.code, 0, again.stdout + again.stderr);
		rt = rtOf(spaced.root, m);
		cookie = await signIn(urlOf(again.stdout));
		const host = await page(`http://127.0.0.1:${rt.port}`, cookie, 'GET', '/api/host');
		assert.equal(host.status, 200, host.text);
		assert.equal(host.json.chat, false, host.text);
	});
});

describe('step 5: installed twice from two node paths', () => {
	const others = {
		permissions: { allow: ['Bash(ls:*)'] },
		hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo other-prompt-hook' }] }], Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }] },
		env: { KEEP: '1' },
	};
	const check = (root, nodePath) => {
		const s = readSettings(root);
		const ours = ourEntries(s);
		assert.equal(ours.length, 1, JSON.stringify(s.hooks));
		assert.ok(ours[0].command.startsWith(`"${nodePath}" `), `${ours[0].command} does not name ${nodePath}`);
		assert.deepEqual(s.permissions, others.permissions);
		assert.deepEqual(s.env, others.env);
		assert.deepEqual(s.hooks.Stop, others.hooks.Stop);
		assert.ok(s.hooks.UserPromptSubmit.flatMap((e) => e.hooks).some((h) => h.command === 'echo other-prompt-hook'), 'the other prompt hook was dropped');
	};
	test('process.execPath, then a symlink to it: one entry remains, with the second node path; every other key is kept', () => {
		fs.writeFileSync(settingsFile(spacesOnly.root), JSON.stringify(others, null, '\t'));
		assert.equal(dtWeb(spacesOnly.root, ['hook', '--install'], m.env, { bin: spacesOnly.bin }).code, 0);
		const link = path.join(tmpDir('m017-h5-node-'), 'node');
		fs.symlinkSync(process.execPath, link);
		const r = dtWeb(spacesOnly.root, ['hook', '--install'], m.env, { bin: spacesOnly.bin, node: link });
		assert.equal(r.code, 0, r.stdout + r.stderr);
		// node reports a symlinked binary by its real path, so the second node path IS process.execPath here
		check(spacesOnly.root, fs.realpathSync(link) === process.execPath ? process.execPath : link);
	});
	test('and from a second node binary (a hard link, a path node keeps): one entry, with that path', () => {
		const dir = tmpDir('m017-h5-node2-');
		const hard = path.join(dir, 'node');
		fs.linkSync(process.execPath, hard);
		const r = dtWeb(spacesOnly.root, ['hook', '--install'], m.env, { bin: spacesOnly.bin, node: hard });
		assert.equal(r.code, 0, r.stdout + r.stderr);
		check(spacesOnly.root, hard);
	});
});
