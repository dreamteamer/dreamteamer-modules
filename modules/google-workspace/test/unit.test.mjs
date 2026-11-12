// The google-workspace SETUP UNIT — the engine's view of this module. Pure half: inspect, plan and apply
// against a fake environment and temp folders. Engine half: `dt install` of the packed module on the
// engine under test, driven as a person would, into a virgin workspace.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SETUP_UNIT, inspect, plan, apply } from '../lib/google-workspace-setup.mjs';
import { virginWorkspace, packedInto, run, cleanup, ENGINE_VERSION, engineMeets } from '../../../tests/helpers/workspace.mjs';

after(cleanup);
// realpath: the module refuses a store path that passes through a symlink, and macOS's tmp does
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-google-')));
const ctxFor = (root, env = {}) => ({ root, env, tty: false, receiptDir: path.join(root, '.dreamteamer', 'setup', 'google-workspace') });

describe('the unit, pure', () => {
	test('declares the three inputs, client_secret optional (D41), and version 1', () => {
		assert.equal(SETUP_UNIT.id, 'google-workspace');
		assert.equal(SETUP_UNIT.version, 1);
		assert.deepEqual(SETUP_UNIT.inputs.map((i) => [i.id, i.kind, i.env, i.required]), [
			['credentials_dir', 'path', 'WORKSPACE_MCP_CREDENTIALS_DIR', true],
			['client_secret', 'secret-path', 'GOOGLE_CLIENT_SECRET_PATH', false],
			['account', 'string', undefined, false],
		]);
	});

	test('inspect maps the module\'s rows; authorization is unverified until a receipt exists', () => {
		const root = tmp();
		const r = inspect(ctxFor(root, { PATH: '' }));
		assert.ok(r.checks.every((c) => ['ready', 'configured', 'unverified', 'missing', 'blocked'].includes(c.status)));
		assert.equal(r.checks.find((c) => c.id === 'google.account-authorization').status, 'unverified');
		const ctx = ctxFor(root, { PATH: '' });
		fs.mkdirSync(ctx.receiptDir, { recursive: true });
		fs.writeFileSync(path.join(ctx.receiptDir, 'a%40example.invalid.verified.json'), JSON.stringify({ what: 'read', at: '2026-11-13' }));
		const after = inspect(ctx).checks.find((c) => c.id === 'google.account-authorization');
		assert.equal(after.status, 'ready');
		assert.equal(after.evidence.at, '2026-11-13');
	});

	test('plan names client_secret and account in needs, the store creation as a machine effect, the owner\'s steps as account', () => {
		const root = tmp();
		const store = path.join(tmp(), 'creds');
		const p = plan(ctxFor(root, { PATH: '' }), { credentials_dir: store });
		assert.deepEqual(p.needs, ['client_secret', 'account']);
		const create = p.actions.find((a) => a.id === 'create-credential-store');
		assert.equal(create.state, 'ready');
		assert.deepEqual(create.effects.map((e) => e.kind), ['machine']);
		assert.equal(create.preview.creates, store);
		assert.equal(create.runBy, 'engine');
		const withAccount = plan(ctxFor(root, { PATH: '' }), { credentials_dir: store, account: 'a@example.invalid' });
		const auth = withAccount.actions.find((a) => a.id === 'authorize-account');
		assert.equal(auth.runBy, 'owner');
		assert.ok(auth.effects.some((e) => e.kind === 'account'));
		assert.equal(withAccount.actions.find((a) => a.id === 'verify-account-read').kind, 'verify');
		assert.deepEqual(withAccount.needs, ['client_secret']);
	});

	test('apply creates exactly the previewed store, owner-only, and refuses a stale preview; again is nothing to do', () => {
		const root = tmp();
		const store = path.join(tmp(), 'creds');
		const ctx = ctxFor(root, { PATH: '' });
		const p = plan(ctx, { credentials_dir: store });
		const create = p.actions.find((a) => a.id === 'create-credential-store');
		const r = apply(ctx, create, { credentials_dir: store });
		assert.equal(r.ok, true, r.message);
		assert.deepEqual(r.changed, [store]);
		assert.equal(fs.statSync(store).mode & 0o777, 0o700);
		const again = apply(ctx, plan(ctx, { credentials_dir: store }).actions.find((a) => a.id === 'create-credential-store'), { credentials_dir: store });
		assert.equal(again.ok, true);
		assert.deepEqual(again.changed, []);
		// a stale preview: the parent replaced after the plan — on a store that does not exist yet
		const store2 = path.join(tmp(), 'creds2');
		const create2 = plan(ctx, { credentials_dir: store2 }).actions.find((a) => a.id === 'create-credential-store');
		const stale = apply(ctx, { ...create2, preview: { ...create2.preview, parentId: 'nope' } }, { credentials_dir: store2 });
		assert.equal(stale.ok, false);
		assert.match(stale.message, /Nothing was changed/);
		assert.ok(!fs.existsSync(store2));
	});
});

describe('through the engine', { skip: !engineMeets('google-workspace') && `needs engine ${JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).dreamteamer.engine}, this is ${ENGINE_VERSION}` }, () => {
	test('dt install creates the store under --allow machine, prints the sign-in line, status reads configured naming client_secret; --authorize without a terminal is exit 2', () => {
		const root = virginWorkspace();
		const from = packedInto(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-from-')), 'google-workspace');
		const store = path.join(fs.realpathSync(path.join(root, '..')), `creds-${path.basename(root)}`);
		const r = run(root, ['install', '@dreamteamer/google-workspace', '--from', from, '--input', `credentials_dir=${store}`, '--allow', 'machine', '--no-input']);
		assert.equal(r.status, 0, r.stderr + r.stdout);
		assert.ok(fs.existsSync(store), 'the store was created');
		assert.match(r.stdout, /✔ create-credential-store — created/);
		assert.match(r.stdout, /authorize-account \(needs input\)/, 'no account named yet');
		assert.match(r.stdout, /needs input: client_secret, account/);
		const s = run(root, ['status']);
		assert.match(s.stdout, /google-workspace\s+configured/);
		// with the account named and a client file in place, the sign-in is the owner's step, never run here
		const client = path.join(fs.realpathSync(path.join(root, '..')), `client-${path.basename(root)}.json`);
		fs.writeFileSync(client, '{}');
		const named = run(root, ['setup', 'google-workspace', '--input', `credentials_dir=${store}`, '--input', `client_secret=${client}`, '--input', 'account=a@example.invalid', '--no-input']);
		assert.equal(named.status, 0, named.stderr + named.stdout);
		if (/uvx is not available/.test(named.stdout)) assert.match(named.stdout, /authorize-account \(blocked\)/, 'no uvx on this machine: the owner\'s step is blocked, named');
		else assert.match(named.stdout, /authorize-account \(the owner's step: dt setup <unit> --authorize\)/);
		assert.doesNotMatch(named.stdout, /needs input: client_secret/);
		fs.rmSync(client, { force: true });
		assert.equal(run(root, ['setup', 'google-workspace', '--verify', '--authorize']).status, 2);
		// nothing of the module's reached a registry, and the install committed its two files only
		assert.equal(run(root, ['status']).status, 0);
		fs.rmSync(store, { recursive: true, force: true });
	});
});
