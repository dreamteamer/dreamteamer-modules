// REMOTE ACCESS, the protocol's half (cr-vscode-012, re-homed with cr-modules-005): a declared url never
// leaves the host with its userinfo, every Sources entry is checked against the right remote, the redaction
// guard scrubs what a provider could leak, and the two routes answer through the handler with and without a
// provider. The providers themselves (GitHub, Bitbucket) are the VS Code extension's and are tested there.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ENGINE_DIR } from '../../../tests/helpers/fixture.mjs';
import { declaredUrl, withoutUserinfo } from '../src/host/sources.js';
import { accessTargets, redactSecrets, unavailableAccess, NOT_AVAILABLE } from '../src/host/remote-access.js';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => import(pathToFileURL(path.join(PKG, rel)).href);
const quietly = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };
const secret = ['sec', 'ret', 'Value'].join('');

describe('withoutUserinfo — what the host may send', () => {
	test('an https url loses any userinfo: user only, user and password, percent-encoded, any case', () => {
		assert.equal(withoutUserinfo(`https://${secret}@github.example/acme/w.git`), 'https://github.example/acme/w.git');
		assert.equal(withoutUserinfo(`https://x-user:${secret}@github.example/acme/w.git`), 'https://github.example/acme/w.git');
		assert.equal(withoutUserinfo(`https://x-user:pa%40${secret}@github.example/acme/w.git`), 'https://github.example/acme/w.git');
		assert.equal(withoutUserinfo(`HTTPS://u:${secret}@GitHub.example/acme/w.git`), 'HTTPS://GitHub.example/acme/w.git');
	});
	test('a url `new URL` refuses (a raw slash in the password) is cut at its last @', () => {
		const out = withoutUserinfo(`https://x-user:pa/${secret}@github.example/acme/w.git`);
		assert.ok(!out.includes(secret), out);
		assert.equal(out, 'https://github.example/acme/w.git');
	});
	test('ssh:// and git+ssh:// lose their login and keep the port and path', () => {
		assert.equal(withoutUserinfo('ssh://git@bitbucket.example/example-ws/w.git'), 'ssh://bitbucket.example/example-ws/w.git');
		assert.equal(withoutUserinfo(`ssh://dev-login:${secret}@bitbucket.example:2222/example-ws/w.git`), 'ssh://bitbucket.example:2222/example-ws/w.git');
		assert.equal(withoutUserinfo('git+ssh://dev-login@github.example/acme/w.git'), 'git+ssh://github.example/acme/w.git');
	});
	test('a scp-like user@host:path remote never shows its login, split at the LAST @ as ssh does', () => {
		assert.equal(withoutUserinfo('git@github.example:acme/w.git'), 'github.example:acme/w.git');
		assert.equal(withoutUserinfo('x-user@github.example-example:acme/w.git'), 'github.example-example:acme/w.git');
		assert.equal(withoutUserinfo('first@second@github.example:acme/w.git'), 'github.example:acme/w.git');
	});
	test('login-free forms, local paths and no url are unchanged', () => {
		for (const same of ['github.example:acme/w.git', '/srv/git/w.git', 'C:\\repos\\w', '../w', './me@lab/w:2', 'https://github.example/acme/w.git']) assert.equal(withoutUserinfo(same), same);
		assert.equal(withoutUserinfo(undefined), undefined);
	});
	test('declaredUrl — the one reader of a git_modules url for the stack — strips it for a layer and a bundle alike', () => {
		const ctx = { gitModules: { 'project-a': { url: `https://x:${secret}@github.example/acme/project-a.git` }, 'org-bundle': { url: `https://${secret}@github.example/acme/org.git` } } };
		assert.equal(declaredUrl(ctx, 'project-a'), 'https://github.example/acme/project-a.git');
		assert.equal(declaredUrl(ctx, 'org-bundle'), 'https://github.example/acme/org.git');
		assert.equal(declaredUrl(ctx, undefined), undefined);
		assert.equal(declaredUrl(ctx, 'missing'), undefined);
	});
});

describe('accessTargets — which remote each entry is checked against', () => {
	const stack = {
		workspace: { name: 'my-hq', kind: 'own', repo: '.', installed: true, via: 'own', access: 'write', collections: [] },
		layers: [
			{ name: 'project-a', kind: 'layer', repo: 'git_modules/project-a', installed: true, via: 'clone', access: 'edit', collections: [] },
			{ name: 'project-b', kind: 'layer', repo: 'git_modules/project-b', installed: false, via: 'layer', access: 'read', collections: [] },
		],
		modules: [
			{ name: 'inline', kind: 'module', repo: '.', installed: true, via: 'own', access: 'write', collections: [] },
			{ name: 'pkg', kind: 'module', repo: 'node_modules/@x/pkg', installed: true, via: 'package', access: 'read', collections: [] },
		],
	};
	// the folders exist (top-level resolution reads the real path); git itself is scripted below
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-ra-')));
	fs.mkdirSync(path.join(root, 'git_modules', 'project-a'), { recursive: true });
	after(() => fs.rmSync(root, { recursive: true, force: true }));
	// a scripted git: top-levels by folder, push urls by top-level — no repo on disk is read
	const git = (args, cwd) => {
		if (args[0] === 'rev-parse') return cwd.startsWith(path.join(root, 'git_modules', 'project-a')) ? path.join(root, 'git_modules', 'project-a') : cwd.startsWith(root) ? root : undefined;
		if (args[0] === 'remote') return cwd === root ? 'git@github.example:acme/my-hq.git' : 'git@github.example:acme/project-a.git';
		return undefined;
	};
	test('the workspace and a clone each get their own push url; an inline module notes the workspace remote; a package is skipped; an uninstalled layer says so', () => {
		const targets = accessTargets(stack, root, [{ id: 'inline', path: '.' }], { 'project-a': { url: 'https://x@github.example/acme/project-a.git' }, 'project-b': { url: 'https://github.example/acme/project-b.git' } }, git);
		assert.deepEqual(targets.map((t) => t.source), ['my-hq', 'project-a', 'project-b', 'inline']);
		assert.equal(targets[0].url, 'git@github.example:acme/my-hq.git');
		assert.equal(targets[1].url, 'git@github.example:acme/project-a.git');
		assert.deepEqual(targets[2], { source: 'project-b', reason: 'not installed' });
		assert.equal(targets[3].note, "the workspace's remote");
	});
	test('a host without a provider answers every target not-checked, with the one reason', () => {
		const out = unavailableAccess([{ source: 'a', url: 'x' }, { source: 'b', reason: 'no remote' }]);
		assert.equal(out.available, false);
		assert.deepEqual(out.access, { a: { state: 'not-checked', reason: NOT_AVAILABLE }, b: { state: 'not-checked', reason: NOT_AVAILABLE } });
	});
});

describe('redactSecrets — the second line of the token rule', () => {
	test('full token shapes and exact held values are replaced everywhere in a body; short names survive', () => {
		const token = 'ghp_' + 'A'.repeat(40);
		const held = 'held-' + secret;
		const out = redactSecrets({ a: `Bearer ${'b'.repeat(20)}`, b: [`x ${token} y`, { c: `saw ${held}` }], d: 'ghp_tools', e: 'short' }, [held, 'tiny']);
		assert.deepEqual(out, { a: '[redacted]', b: ['x [redacted] y', { c: 'saw [redacted]' }], d: 'ghp_tools', e: 'short' });
	});
});

let fixture;
after(() => fixture?.cleanup());

test('the handler answers /sources/access without a provider, and with a scripted one through the seam', { timeout: 120_000 }, async () => {
	const { makeFixture } = await load('lib/contract/fixture.js');
	const { createHandler } = await load('src/handler.js');
	fixture = makeFixture({ engineDir: ENGINE_DIR });
	const handler = await createHandler({ root: fixture.root });
	const request = (m, p, b) => quietly(() => handler.handle(m, p, b));

	assert.equal(handler.api.hasRemoteAccess(), false);
	const none = await request('GET', '/sources/access');
	assert.equal(none.status, 200);
	assert.equal(none.body.available, false);
	assert.equal(none.body.access['northwind-archive']?.state, 'not-checked');
	assert.equal(none.body.access['northwind-archive']?.reason, NOT_AVAILABLE);
	const noneMembers = await request('GET', '/sources/access/members?source=northwind-archive');
	assert.deepEqual(noneMembers.body, { state: 'unknown', members: [], reason: NOT_AVAILABLE });

	const asked = [];
	const token = 'ghp_' + 'Z'.repeat(40);
	handler.api.useRemoteAccess({
		own: async (targets, opts) => (asked.push(opts), Object.fromEntries(targets.map((t) => [t.source, { state: 'ok', level: 'write', role: 'push', account: 'dev-one', tiedToPushKey: true, note: `saw ${token} and ${secret}` }]))),
		members: async (target) => ({ state: 'ok', members: [{ name: 'dev-one', kind: 'user', level: 'write' }], account: `dev-one ${secret}`, reason: target.source }),
		heldSecrets: async () => [secret],
	});
	assert.equal(handler.api.hasRemoteAccess(), true);
	const own = await request('GET', '/sources/access?fresh=1');
	assert.equal(own.status, 200);
	assert.equal(own.body.available, true);
	assert.deepEqual(asked, [{ fresh: true }]);
	assert.ok(Object.keys(own.body.access).includes('northwind-archive'), Object.keys(own.body.access).join());
	assert.equal(own.body.access['northwind-archive'].note, 'saw [redacted] and [redacted]');
	const members = await request('GET', '/sources/access/members?source=northwind-archive');
	assert.deepEqual(members.body.members.map((m) => m.name), ['dev-one']);
	assert.equal(members.body.account, 'dev-one [redacted]');
	assert.equal((await request('GET', '/sources/access/members?source=nope')).status, 404);

	// a provider that throws never leaks its message: our sentence and the route
	handler.api.useRemoteAccess({ own: async () => { throw new Error(`boom ${token}`); }, members: async () => { throw new Error('x'); }, heldSecrets: async () => [] });
	const thrown = await request('GET', '/sources/access');
	assert.equal(thrown.status, 500);
	assert.equal(thrown.body.error, 'remote access failed (/sources/access)');
});
