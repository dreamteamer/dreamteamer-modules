// The setup provider on synthetic fixtures only: no real account, no network, no OAuth. What these
// tests can establish is local behaviour — statuses, previews, confinement, idempotence and that the
// read-only paths really are read-only. They prove nothing about Google consent or live access.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { inspect, plan, apply, legacyDoctor, engineDoctorRows, LEGACY_DOCTOR_IDS } from '../lib/google-setup.mjs';
import { doctor } from '../lib/doctor.mjs';
import activate, { setupCommand, apiVersion } from '../lib/extension.mjs';

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); made.push(d); return d; };
const account = 'dana@northwind.example';

/** A workspace, a machine folder beside it with uvx, an OAuth client file and an owner-only store. */
function machine({ store = true, client = true, uvx = true, stored = [] } = {}) {
	const base = tmp('google-setup-');
	const root = path.join(base, 'workspace'); fs.mkdirSync(root);
	fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'northwind-workspace' }));
	fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
	const bin = path.join(base, 'bin'); fs.mkdirSync(bin);
	if (uvx) { fs.writeFileSync(path.join(bin, 'uvx'), ''); fs.chmodSync(path.join(bin, 'uvx'), 0o700); }
	const secrets = path.join(base, 'secrets'); fs.mkdirSync(secrets, { mode: 0o700 });
	const clientFile = path.join(secrets, 'client.json');
	if (client) fs.writeFileSync(clientFile, '{"installed":{}}');
	const storeDir = path.join(secrets, 'credentials');
	if (store) { fs.mkdirSync(storeDir, { mode: 0o700 }); fs.chmodSync(storeDir, 0o700); }
	for (const a of stored) fs.writeFileSync(path.join(storeDir, `${a}.json`), '{"synthetic":true}');
	return { base, root, env: { PATH: bin, GOOGLE_CLIENT_SECRET_PATH: clientFile, WORKSPACE_MCP_CREDENTIALS_DIR: storeDir }, storeDir, clientFile };
}
const byId = (checks) => Object.fromEntries(checks.map((c) => [c.id, c]));

/** Run `fn` with every write, process and network entry point replaced by a thrower. */
function readOnly(fn) {
	const calls = [];
	const targets = [
		...['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'rmSync', 'unlinkSync', 'chmodSync', 'copyFileSync', 'symlinkSync', 'mkdtempSync', 'writeSync'].map((k) => [fs, k]),
		[net, 'connect'], [net, 'createConnection'], [http, 'request'], [https, 'request'],
		...['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'].map((k) => [cp, k]),
		[globalThis, 'fetch'],
	];
	const saved = targets.map(([o, k]) => [o, k, o[k]]);
	const openSync = fs.openSync;
	for (const [o, k] of targets) o[k] = () => { calls.push(k); throw new Error(`forbidden: ${k}`); };
	fs.openSync = (p, flags, ...rest) => { if (flags && !/^r$|^rs?\+?$/.test(String(flags)) && flags !== 0) { calls.push('openSync:' + flags); throw new Error('forbidden open'); } return openSync(p, flags, ...rest); };
	syncBuiltinESMExports();
	try { return { result: fn(), calls }; } catch (error) { return { error, calls }; } finally { for (const [o, k, v] of saved) o[k] = v; fs.openSync = openSync; syncBuiltinESMExports(); }
}

// The doctor exactly as it was before the provider existed, kept here as the contract it must match.
function originalDoctor({ env = process.env, accessible = (p) => { try { fs.accessSync(p, fs.constants.R_OK); return true; } catch { return false; } } } = {}) {
	const executable = (env.PATH ?? '').split(path.delimiter).some((dir) => {
		if (!dir) return false;
		try { fs.accessSync(path.join(dir, process.platform === 'win32' ? 'uvx.exe' : 'uvx'), fs.constants.X_OK); return true; } catch { return false; }
	});
	const checks = [{ label: 'workspace-mcp runtime', state: executable ? 'ok' : 'bad', detail: executable ? 'uvx is available; server package is pinned when started.' : 'uvx is not available.', fix: 'Install uv from its official distribution after owner approval.' }];
	for (const [key, label] of [['GOOGLE_CLIENT_SECRET_PATH', 'OAuth client configuration'], ['WORKSPACE_MCP_CREDENTIALS_DIR', 'Local account credential store']]) {
		const ok = !!env[key] && path.isAbsolute(env[key]) && accessible(env[key]);
		checks.push({ label, state: ok ? 'ok' : 'bad', detail: ok ? 'Configured local path is readable; account authorization is not verified.' : 'Required absolute local path is missing or unreadable.', fix: `Configure ${key} outside Git and complete owner-controlled setup.` });
	}
	checks.push({ label: 'Account authorization', state: 'warn', detail: 'Not verified. Local paths and stored files do not prove current authorization.', fix: 'After owner-controlled consent, verify a read for each intended account on this computer. Doctor performs no live account calls.' });
	return { checks };
}

describe('inspect', () => {
	test('a fully configured machine is configured and ready locally, and authorization stays unverified', () => {
		const m = machine({ stored: [account] });
		const c = byId(inspect({ root: m.root, env: m.env }).checks);
		assert.equal(c['google.runtime'].status, 'ready');
		assert.equal(c['google.client-config'].status, 'configured');
		assert.equal(c['google.credential-store'].status, 'configured');
		assert.equal(c['google.stored-accounts'].status, 'configured');
		assert.equal(c['google.stored-accounts'].evidence.stored, 1);
		assert.equal(c['google.credential-placement'].status, 'ready');
		assert.equal(c['google.account-authorization'].status, 'unverified');
		assert.equal(c['google.account-authorization'].state, 'warn', 'a stored credential never reads as authorized');
	});
	test('nothing configured is missing or blocked, never ok, and never bad on the board', () => {
		const c = byId(inspect({ root: machine().root, env: { PATH: '' } }).checks);
		assert.equal(c['google.runtime'].status, 'blocked');
		assert.equal(c['google.client-config'].status, 'missing');
		assert.equal(c['google.stored-accounts'].status, 'blocked');
		assert.equal(c['google.credential-placement'].status, 'blocked');
		for (const row of Object.values(c)) assert.notEqual(row.state, 'bad');
	});
	test('an empty store is missing — configuration presence is not an account', () => {
		const m = machine();
		assert.equal(byId(inspect({ root: m.root, env: m.env }).checks)['google.stored-accounts'].status, 'missing');
	});
	test('files inside the workspace or a store others can read are unsafe placement', () => {
		const m = machine();
		const inside = path.join(m.root, 'credentials'); fs.mkdirSync(inside, { mode: 0o700 }); fs.chmodSync(inside, 0o700);
		assert.equal(byId(inspect({ root: m.root, env: { ...m.env, WORKSPACE_MCP_CREDENTIALS_DIR: inside } }).checks)['google.credential-placement'].status, 'blocked');
		if (process.platform !== 'win32') {
			fs.chmodSync(m.storeDir, 0o755);
			const row = byId(inspect({ root: m.root, env: m.env }).checks)['google.credential-placement'];
			assert.equal(row.status, 'blocked');
			assert.match(row.detail, /other local users/);
		}
	});
	test('rows carry no path, account address or credential content', () => {
		const m = machine({ stored: [account] });
		const text = JSON.stringify(inspect({ root: m.root, env: m.env }));
		assert.ok(!text.includes(m.base), 'a configured path leaked');
		assert.ok(!text.includes(account), 'an account leaked');
		assert.ok(!text.includes('synthetic'), 'credential content leaked');
	});
	test('the read-only guard itself catches a write, a process and a request (it is not vacuous)', () => {
		const d = tmp('guard-');
		for (const fn of [() => fs.writeFileSync(path.join(d, 'x'), 'y'), () => fs.mkdirSync(path.join(d, 'y')), () => cp.spawnSync('true'), () => fetch('http://127.0.0.1:9'), () => net.connect(9), () => fs.openSync(path.join(d, 'z'), 'w')]) {
			const { calls, error } = readOnly(fn);
			assert.ok(calls.length && error, String(fn));
		}
		assert.deepEqual(fs.readdirSync(d), []);
	});
	test('inspect and plan write nothing, start no process and reach no network', () => {
		const m = machine({ stored: [account] });
		const before = fs.readdirSync(m.storeDir).join();
		const a = readOnly(() => inspect({ root: m.root, env: m.env }));
		const b = readOnly(() => plan({ root: m.root, env: m.env, accounts: [account, 'sam@northwind.example'] }));
		const d = readOnly(() => engineDoctorRows({ root: m.root, env: m.env }));
		assert.deepEqual([...a.calls, ...b.calls, ...d.calls], []);
		assert.deepEqual([a.error, b.error, d.error], [undefined, undefined, undefined]);
		assert.equal(b.result.actions.length, 5);
		assert.equal(fs.readdirSync(m.storeDir).join(), before);
	});
});

describe('the existing doctor surfaces', () => {
	test('dt-google doctor is byte-for-byte the original report on every fixture shape', () => {
		const shapes = [machine({ stored: [account] }), machine({ uvx: false }), machine({ client: false }), machine({ store: false })];
		for (const m of shapes) {
			assert.deepEqual(doctor({ env: m.env }), originalDoctor({ env: m.env }));
			assert.equal(JSON.stringify(doctor({ env: m.env })), JSON.stringify(originalDoctor({ env: m.env })));
		}
		for (const env of [{ PATH: '' }, { PATH: '', GOOGLE_CLIENT_SECRET_PATH: 'relative.json', WORKSPACE_MCP_CREDENTIALS_DIR: '/x' }]) {
			assert.equal(JSON.stringify(doctor({ env, accessible: () => true })), JSON.stringify(originalDoctor({ env, accessible: () => true })));
		}
		assert.deepEqual(legacyDoctor({ env: { PATH: '' } }).checks.map((c) => c.label), LEGACY_DOCTOR_IDS.map((id) => byId(inspect({ env: { PATH: '' } }).checks)[id].label));
	});
	test('engine doctor rows are API 1 rows, never bad, and can all be ok on a configured machine', () => {
		const m = machine({ stored: [account] });
		const rows = engineDoctorRows({ root: m.root, env: m.env });
		for (const r of rows) assert.deepEqual(Object.keys(r).filter((k) => !['label', 'state', 'detail', 'fix'].includes(k)), []);
		assert.ok(rows.every((r) => r.state === 'ok'), JSON.stringify(rows));
		assert.ok(rows.every((r) => /not verified|ready|owner-only|available/i.test(r.detail)));
		assert.ok(!rows.some((r) => /Account authorization/.test(r.label)), 'the never-locally-verifiable row is left to SETUP.md');
		assert.ok(engineDoctorRows({ root: m.root, env: { PATH: '' } }).every((r) => r.state === 'warn' && r.fix));
	});
	test('the extension activates as API 1 with one namespaced command and one setup unit (its rows are the doctor\'s)', () => {
		assert.equal(apiVersion, 1);
		const ext = activate();
		assert.deepEqual(Object.keys(ext.commands), ['google-setup']);
		assert.match(ext.commands['google-setup'].usage, /google-setup/);
		assert.equal(ext.doctor, undefined, 'the engine renders the unit\'s inspect as this capability\'s rows');
		assert.equal(ext.setup.length, 1);
		assert.equal(ext.setup[0].id, 'google-workspace');
		assert.ok(Array.isArray(ext.setup[0].inspect({ root: machine().root, env: {}, receiptDir: path.join(machine().root, 'r') }).checks));
	});
});

describe('plan', () => {
	test('names the workspace by real path and package name', () => {
		const m = machine();
		const link = path.join(m.base, 'linked'); fs.symlinkSync(m.root, link);
		const p = plan({ root: link, env: m.env });
		assert.deepEqual(p.workspace, { root: m.root, name: 'northwind-workspace' });
		assert.equal(p.protocol, 1);
	});
	test('create-credential-store: needs input, ready with a bound preview, done, or refused — by what is on disk', () => {
		const m = machine({ store: false });
		const step = (env) => plan({ root: m.root, env }).actions.find((a) => a.id === 'create-credential-store');
		assert.equal(step({ ...m.env, WORKSPACE_MCP_CREDENTIALS_DIR: undefined }).state, 'needs-input');
		assert.equal(step({ ...m.env, WORKSPACE_MCP_CREDENTIALS_DIR: 'relative/store' }).state, 'needs-input');
		const ready = step(m.env);
		assert.equal(ready.state, 'ready');
		const parent = path.dirname(m.storeDir);
		const st = fs.lstatSync(parent, { bigint: true });
		assert.deepEqual(ready.preview, { creates: m.storeDir, parent, parentId: `${st.dev}:${st.ino}`, mode: '0700' });
		assert.match(ready.effects[0], /^machine-file: one new owner-only directory/);
		assert.deepEqual(ready.command, ['npx', 'dreamteamer', 'google-setup', 'apply', 'create-credential-store', '--target', m.storeDir, '--parent-id', `${st.dev}:${st.ino}`, '--workspace', m.root]);
		assert.equal(step({ ...m.env, WORKSPACE_MCP_CREDENTIALS_DIR: path.join(m.root, 'store') }).state, 'blocked', 'inside the workspace');
		fs.writeFileSync(m.storeDir, 'not a directory');
		assert.equal(step(m.env).state, 'blocked');
		fs.rmSync(m.storeDir);
		fs.symlinkSync(m.base, m.storeDir);
		assert.equal(step(m.env).state, 'blocked', 'a symlink is never taken for the directory');
	});
	test('create-credential-store refuses a path through a symlink, with .. in it, or with a missing parent', () => {
		const m = machine({ store: false });
		const step = (dir) => plan({ root: m.root, env: { ...m.env, WORKSPACE_MCP_CREDENTIALS_DIR: dir } }).actions.find((a) => a.id === 'create-credential-store');
		const link = path.join(m.base, 'linked-secrets'); fs.symlinkSync(path.join(m.base, 'secrets'), link);
		const through = step(path.join(link, 'credentials'));
		assert.equal(through.state, 'blocked');
		assert.match(through.reason, /not canonical.*secrets[\\/]credentials/);
		assert.equal(step(`${m.base}/bin/../secrets/credentials`).state, 'blocked');
		const missing = step(path.join(m.base, 'no-such-parent', 'credentials'));
		assert.equal(missing.state, 'blocked');
		assert.match(missing.reason, /creates only the last folder/);
		assert.ok(!fs.existsSync(path.join(m.base, 'no-such-parent')));
	});
	test('an existing directory others can read is blocked, never done and never re-permissioned', { skip: process.platform === 'win32' }, () => {
		const m = machine();
		fs.chmodSync(m.storeDir, 0o755);
		const step = plan({ root: m.root, env: m.env }).actions.find((a) => a.id === 'create-credential-store');
		assert.equal(step.state, 'blocked');
		assert.match(step.reason, /never changes existing permissions/);
		assert.throws(() => apply({ root: m.root, env: m.env, action: 'create-credential-store', workspace: m.root, target: m.storeDir, parentId: 'x' }), (e) => e.code === 'blocked');
		assert.equal(fs.statSync(m.storeDir).mode & 0o777, 0o755, 'permissions untouched');
		fs.chmodSync(m.storeDir, 0o700);
		assert.equal(plan({ root: m.root, env: m.env }).actions.find((a) => a.id === 'create-credential-store').state, 'done');
	});
	test('a parent other users can write is refused', { skip: process.platform === 'win32' }, () => {
		const m = machine({ store: false });
		fs.chmodSync(path.dirname(m.storeDir), 0o777);
		try { assert.match(plan({ root: m.root, env: m.env }).actions.find((a) => a.id === 'create-credential-store').reason, /Other users can write/); }
		finally { fs.chmodSync(path.dirname(m.storeDir), 0o700); }
	});
	test('owner steps are live, name their effects and use the existing commands, never run here', () => {
		const m = machine({ stored: [account] });
		const p = plan({ root: m.root, env: m.env, accounts: [account, 'sam@northwind.example'] });
		const dana = p.actions.filter((a) => a.account === account);
		const sam = p.actions.filter((a) => a.account === 'sam@northwind.example');
		assert.equal(dana.find((a) => a.id === 'authorize-account').state, 'done');
		assert.equal(dana.find((a) => a.id === 'verify-account-read').state, 'ready');
		assert.equal(sam.find((a) => a.id === 'authorize-account').state, 'ready');
		assert.equal(sam.find((a) => a.id === 'verify-account-read').state, 'blocked');
		for (const a of [...dana, ...sam]) {
			assert.equal(a.kind, 'live'); assert.equal(a.runBy, 'owner');
			assert.ok(a.effects.some((e) => e.startsWith('network')) && a.effects.some((e) => e.startsWith('account-access')));
			assert.deepEqual(a.command.slice(0, 2), ['npx', 'dt-google']);
		}
		assert.deepEqual(sam.find((a) => a.id === 'authorize-account').command, ['npx', 'dt-google', 'auth', 'sam@northwind.example']);
	});
	test('without an account the owner step asks; an invalid account or Windows is blocked', () => {
		const m = machine();
		assert.equal(plan({ root: m.root, env: m.env }).actions.find((a) => a.id === 'authorize-account').state, 'needs-input');
		assert.equal(plan({ root: m.root, env: m.env, accounts: ['../escape'] }).actions.find((a) => a.id === 'authorize-account').state, 'blocked');
		assert.equal(plan({ root: m.root, env: m.env, accounts: [account], platform: 'win32' }).actions.find((a) => a.id === 'authorize-account').state, 'blocked');
		assert.match(plan({ root: m.root, env: { PATH: '' }, accounts: [account] }).actions.find((a) => a.id === 'authorize-account').reason, /Complete first: google\.runtime/);
	});
});

describe('apply', () => {
	const preview = (m, env = m.env) => plan({ root: m.root, env }).actions.find((a) => a.id === 'create-credential-store').preview;
	const create = (m, p, env = m.env) => apply({ root: m.root, env, action: 'create-credential-store', workspace: m.root, target: p.creates, parentId: p.parentId });
	test('creates exactly the previewed owner-only directory once; a second run changes nothing', () => {
		const m = machine({ store: false });
		const p = preview(m);
		const parentMode = fs.statSync(path.dirname(m.storeDir)).mode;
		const r = create(m, p);
		assert.equal(r.changed, true);
		assert.ok(fs.statSync(m.storeDir).isDirectory());
		if (process.platform !== 'win32') assert.equal(fs.statSync(m.storeDir).mode & 0o077, 0, 'owner-only, without a chmod');
		assert.equal(fs.statSync(path.dirname(m.storeDir)).mode, parentMode, 'the parent is untouched');
		assert.equal(byId(r.checks)['google.credential-store'].status, 'configured', 'the result re-inspects');
		assert.equal(create(m, p).changed, false);
	});
	test('a configured target changed after the preview is refused, and the new path is not created', () => {
		const m = machine({ store: false });
		const p = preview(m);
		const moved = { ...m.env, WORKSPACE_MCP_CREDENTIALS_DIR: path.join(path.dirname(m.storeDir), 'elsewhere') };
		assert.throws(() => create(m, p, moved), (e) => e.code === 'stale' && /not the one previewed/.test(e.message));
		assert.ok(!fs.existsSync(moved.WORKSPACE_MCP_CREDENTIALS_DIR) && !fs.existsSync(m.storeDir));
		fs.mkdirSync(moved.WORKSPACE_MCP_CREDENTIALS_DIR, { mode: 0o700 });
		assert.throws(() => create(m, p, moved), (e) => e.code === 'stale', 'even when the other path already exists');
	});
	test('a parent folder replaced after the preview is refused', () => {
		const m = machine({ store: false });
		const p = preview(m);
		const parent = path.dirname(m.storeDir);
		fs.renameSync(parent, `${parent}-old`);
		fs.mkdirSync(parent, { mode: 0o700 });
		assert.throws(() => create(m, p), (e) => e.code === 'stale' && /parent folder was replaced/.test(e.message));
		assert.deepEqual(fs.readdirSync(parent), []);
	});
	test('a directory or file appearing after the preview is never replaced', () => {
		const m = machine({ store: false });
		const p = preview(m);
		fs.writeFileSync(m.storeDir, 'appeared after the preview');
		assert.throws(() => create(m, p), (e) => e.code === 'blocked');
		assert.equal(fs.readFileSync(m.storeDir, 'utf8'), 'appeared after the preview', 'nothing replaced');
		fs.rmSync(m.storeDir);
		// the race itself: the path appears between the last check and mkdir
		const mkdir = fs.mkdirSync;
		fs.mkdirSync = (dir, ...rest) => { mkdir(dir, { mode: 0o755 }); return mkdir(dir, ...rest); };
		try { assert.throws(() => create(m, p), (e) => e.code === 'stale'); } finally { fs.mkdirSync = mkdir; }
		if (process.platform !== 'win32') assert.equal(fs.statSync(m.storeDir).mode & 0o777, 0o755, 'the other writer\'s directory is left as it was');
	});
	test('refuses another workspace, missing bindings and every owner step', () => {
		const m = machine({ store: false });
		const other = machine();
		const p = preview(m);
		assert.throws(() => apply({ root: m.root, env: m.env, action: 'create-credential-store', workspace: other.root, target: p.creates, parentId: p.parentId }), (e) => e.code === 'workspace');
		assert.throws(() => apply({ root: m.root, env: m.env, action: 'create-credential-store', target: p.creates, parentId: p.parentId }), (e) => e.code === 'workspace');
		assert.throws(() => apply({ root: m.root, env: m.env, action: 'create-credential-store', workspace: m.root }), (e) => e.code === 'usage');
		for (const action of ['authorize-account', 'verify-account-read']) assert.throws(() => apply({ root: m.root, env: m.env, action, workspace: m.root }), (e) => e.code === 'action' && /owner/.test(e.message));
		assert.ok(!fs.existsSync(m.storeDir));
	});
});

describe('the google-setup command', () => {
	const run = (root, argv, env) => { const out = []; const err = []; const code = setupCommand({ root, argv, env, out: (s) => out.push(s), err: (s) => err.push(s) }); return { code, out: out.join('\n'), err: err.join('\n') }; };
	test('inspect --json is the inspect result; plan prints effects; apply round-trips', () => {
		const m = machine({ store: false });
		assert.equal(JSON.parse(run(m.root, ['inspect', '--json'], m.env).out).module, '@dreamteamer/google-workspace');
		const p = run(m.root, ['plan', '--account', account], m.env);
		assert.equal(p.code, 0);
		assert.match(p.out, /effects: machine-file/);
		const ready = JSON.parse(run(m.root, ['plan', '--json'], m.env).out).actions.find((a) => a.id === 'create-credential-store');
		const r = run(m.root, ready.command.slice(3).concat('--json'), m.env);
		assert.equal(r.code, 0, r.out + r.err);
		assert.equal(JSON.parse(r.out).changed, true);
	});
	test('usage errors exit 2, refusals exit 1 with a JSON reason, nothing leaks', () => {
		const m = machine();
		assert.equal(run(m.root, ['frobnicate'], m.env).code, 2);
		assert.equal(run(m.root, ['plan', '--account'], m.env).code, 2);
		assert.equal(run(m.root, ['plan', '--bogus', 'x'], m.env).code, 2);
		const refused = run(m.root, ['apply', 'authorize-account', '--workspace', m.root, '--json'], m.env);
		assert.equal(refused.code, 1);
		assert.equal(JSON.parse(refused.out).error, 'action');
		const failed = run(path.join(m.base, 'missing-workspace'), ['plan', '--json'], m.env);
		assert.equal(failed.code, 1);
		assert.ok(!failed.out.includes(m.base), 'an error carried a path');
	});
});

test('SETUP.md is shipped and names every action and command this provider has', () => {
	const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	assert.ok(pkg.files.includes('SETUP.md'));
	assert.equal(pkg.dreamteamer.extension, './lib/extension.mjs');
	const text = fs.readFileSync(new URL('../SETUP.md', import.meta.url), 'utf8');
	for (const id of ['create-credential-store', 'authorize-account', 'verify-account-read']) assert.match(text, new RegExp(`\\b${id}\\b`));
	for (const word of ['ready', 'configured', 'unverified', 'blocked', 'skipped']) assert.match(text, new RegExp(word));
	assert.match(text, /google-setup inspect/);
});
