// The per-user state of dt web (cr-modules-017 §2): one file per workspace in a private dir outside every workspace,
// keyed like the runtime file; a registry of the workspaces `dt web open` has seen. Nothing in clear: a sid, a code
// or a token never reaches a file.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stateDir, workspaceKey, readWorkspaceState, writeWorkspaceState, DEFAULT_STATE, readRegistry, register, lookup } from '../src/state.js';
import { stateFile } from '../src/runtime.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-web-state-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const workspace = (name) => { const d = path.join(tmp, 'ws', name); fs.mkdirSync(d, { recursive: true }); return d; };

test('the state dir: the override, then the platform default', () => {
	const home = '/home/dana';
	assert.equal(stateDir({ DT_WEB_STATE_DIR: '/x/state' }, 'darwin', home), '/x/state');
	assert.equal(stateDir({}, 'darwin', home), path.join(home, 'Library', 'Application Support', 'dreamteamer', 'web', 'state'));
	assert.equal(stateDir({ XDG_STATE_HOME: '/xdg' }, 'linux', home), path.join('/xdg', 'dreamteamer', 'web'));
	assert.equal(stateDir({}, 'linux', home), path.join(home, '.local', 'state', 'dreamteamer', 'web'));
	assert.equal(stateDir({}, 'win32', home), path.join(home, '.local', 'state', 'dreamteamer', 'web'));
});

test('the key is the runtime file\'s, from the real path', () => {
	const root = workspace('northwind');
	const link = path.join(tmp, 'link-to-northwind');
	fs.symlinkSync(root, link);
	assert.match(workspaceKey(root), /^[0-9a-f]{16}$/);
	assert.equal(workspaceKey(root), path.basename(stateFile(root, tmp), '.json'));
	assert.equal(workspaceKey(link), workspaceKey(root));
});

test('absent state reads as the defaults; a write is 0700 / 0600; garbage reads as defaults, keeping a readable port', () => {
	const root = workspace('harbor');
	const dir = path.join(tmp, 'state-a');
	assert.deepEqual(readWorkspaceState(root, dir), DEFAULT_STATE);
	assert.equal(DEFAULT_STATE.level, 'edit');
	assert.equal(DEFAULT_STATE.port, null);
	const s = readWorkspaceState(root, dir);
	s.port = 4870; s.level = 'read';
	writeWorkspaceState(root, s, dir);
	assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
	const file = path.join(dir, `${workspaceKey(root)}.json`);
	assert.equal(fs.statSync(file).mode & 0o777, 0o600);
	assert.equal(readWorkspaceState(root, dir).level, 'read');
	assert.equal(readWorkspaceState(root, dir).port, 4870);
	fs.writeFileSync(file, '{"port": 4871, "level": "admin", "sessi');
	assert.deepEqual(readWorkspaceState(root, dir), { ...DEFAULT_STATE, port: 4871 }, 'a half-written file reads as the defaults, its port kept');
	fs.writeFileSync(file, 'garbage');
	assert.deepEqual(readWorkspaceState(root, dir), DEFAULT_STATE);
	fs.writeFileSync(file, JSON.stringify({ port: 4872, level: 'root', sessions: 'x', pane: 7 }));
	const odd = readWorkspaceState(root, dir);
	assert.equal(odd.port, 4872, 'a readable port is kept');
	assert.equal(odd.level, 'edit', 'an unknown level reads as the default');
	assert.equal('sessions' in odd, false, 'a sessions key is never read: sessions live in memory only');
	assert.deepEqual(odd.pane, DEFAULT_STATE.pane);
	const fresh = readWorkspaceState(root, dir);
	fresh.clientTokens.push(1);
	fresh.pane.refs.push('x');
	assert.deepEqual(DEFAULT_STATE.clientTokens, [], 'the defaults are never shared by reference');
	assert.deepEqual(DEFAULT_STATE.pane.refs, []);
});

test('the written file holds no session: a state carrying one is refused, a file that has one drops it on the next write', () => {
	const root = workspace('hashes');
	const dir = path.join(tmp, 'state-b');
	const s = readWorkspaceState(root, dir);
	assert.equal('sessions' in DEFAULT_STATE, false);
	assert.throws(() => writeWorkspaceState(root, { ...s, sessions: { ['a'.repeat(64)]: { created: 1, seen: 1 } } }, dir), /memory only/);
	const file = path.join(dir, `${workspaceKey(root)}.json`);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(file, JSON.stringify({ port: 4873, sessions: { ['b'.repeat(64)]: { created: 1, seen: 1 } } }));
	const back = readWorkspaceState(root, dir);
	assert.equal(back.port, 4873);
	writeWorkspaceState(root, back, dir);
	assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /sessions|b{64}/);
});

test('register: upsert by id, lastOpened moves; lookup; twenty concurrent registers keep twenty', async () => {
	const dir = path.join(tmp, 'state-c');
	const root = workspace('reg-one');
	let t = 1000;
	await register({ root, name: 'Northwind' }, dir, () => t);
	t = 2000;
	await register({ root, name: 'Northwind HQ' }, dir, () => t);
	const reg = readRegistry(dir);
	assert.equal(reg.length, 1);
	assert.deepEqual(reg[0], { id: workspaceKey(root), root: fs.realpathSync(root), name: 'Northwind HQ', lastOpened: new Date(2000).toISOString() });
	assert.deepEqual(lookup(workspaceKey(root), dir), reg[0]);
	assert.equal(lookup('0000000000000000', dir), null);
	assert.equal(fs.statSync(path.join(dir, 'registry.json')).mode & 0o777, 0o600);
	const roots = Array.from({ length: 20 }, (_, i) => workspace(`many-${i}`));
	await Promise.all(roots.map((r, i) => register({ root: r, name: `ws ${i}` }, dir)));
	assert.equal(readRegistry(dir).length, 21);
	assert.equal(fs.existsSync(path.join(dir, 'registry.json.lock')), false, 'the lock is released');
	fs.writeFileSync(path.join(dir, 'registry.json'), 'not json');
	assert.deepEqual(readRegistry(dir), []);
});

test('register waits for a lock another process holds, and gives up after twenty tries', async () => {
	const dir = path.join(tmp, 'state-d');
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	const lock = path.join(dir, 'registry.json.lock');
	fs.writeFileSync(lock, String(process.pid));
	const started = Date.now();
	setTimeout(() => fs.rmSync(lock, { force: true }), 120);
	await register({ root: workspace('waits'), name: 'w' }, dir);
	assert.ok(Date.now() - started >= 100);
	assert.equal(readRegistry(dir).length, 1);
	fs.writeFileSync(lock, String(process.pid));
	await assert.rejects(register({ root: workspace('gives-up'), name: 'g' }, dir), /registry/);
	fs.writeFileSync(lock, '999999999');
	await register({ root: workspace('after-a-crash'), name: 'c' }, dir);
	assert.equal(readRegistry(dir).length, 2, 'a lock whose process is gone is taken over');
});
