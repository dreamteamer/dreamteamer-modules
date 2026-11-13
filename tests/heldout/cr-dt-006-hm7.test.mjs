// held-out cr-dt-006-hm7 — google installed without a client secret (D41): sign-in attempted with the secret
// still missing is refused naming it, nothing written, no browser; a world-readable or malformed secret file
// is refused without printing its contents. rnd/tests/cr-dt-006-hm7.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { virginWorkspace, packedInto, closure, dt, cleanEnv, cleanup, tmp, skipUnless, statusLines, pty } from './cr-dt-006-lib.mjs';

after(cleanup);
const dirHash = (dir) => { const h = createHash('sha256'); if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).sort()) h.update(`${f}:${fs.statSync(path.join(dir, f)).size}`); return h.digest('hex'); };
const SECRET = '{"installed":{"client_secret":"SECRET-CONTENT-NEVER-SHOWN-9c1d"}}';
const noSecret = (text) => assert.doesNotMatch(text, /SECRET-CONTENT/, 'the secret file\'s contents are never printed');

describe('hm7', { skip: skipUnless('google-workspace') }, () => {
	let root, env, creds, receipts;
	test('install without a secret exits 0 with the authorize line; status reads configured naming the client secret as what is missing', () => {
		const from = packedInto(tmp('dtm-from-'), ...closure('google-workspace'));
		root = virginWorkspace(); env = cleanEnv();
		// no uvx, no browser opener: node's folder and the system folders only
		env.PATH = [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter);
		creds = path.join(tmp('dtm-creds-'), 'creds'); receipts = path.join(root, '.dreamteamer', 'setup', 'google-workspace');
		const r = dt(root, ['install', '@dreamteamer/google-workspace', '--from', from, '--input', `credentials_dir=${creds}`, '--allow', 'machine', '--no-input'], env);
		assert.equal(r.code, 0, r.stderr + r.stdout.slice(-500));
		assert.match(r.stdout, /authorize-account/, 'the authorize step is printed as pending');
		assert.match(r.stdout, /--authorize/, 'with the command that runs it (the record: "prints the authorize line")');
		assert.ok(fs.existsSync(creds), 'the store was created without a secret (D41)');
		const s = dt(root, ['status'], env);
		assert.match(s.stdout, /google-workspace\s+configured/, s.stdout);
		assert.match(s.stdout, /OAuth client|client[_ -]secret|GOOGLE_CLIENT_SECRET_PATH/i, 'the text names the client secret');
		const g = statusLines(root, env).find((l) => l.unit === 'google-workspace');
		assert.equal(g.checks.find((c) => c.id === 'google.client-config')?.status, 'missing', JSON.stringify(g.checks));
	});
	test('--verify --authorize in a terminal with the secret still missing: no browser, no URL, store and receipts unchanged, the secret named', () => {
		const before = dirHash(creds);
		const r = pty(root, ['setup', 'google-workspace', '--verify', '--authorize'], { env, answers: [{ when: 'OAuth client file', send: '\n' }, { when: 'account', send: '\n' }] });
		assert.doesNotMatch(r.out, /https?:\/\//, `no URL opened:\n${r.out}`);
		assert.doesNotMatch(r.out, /dt-google auth|consent completed|Opening|open .*browser/i, 'no sign-in command ran');
		assert.equal(dirHash(creds), before, 'the credentials dir is unchanged');
		assert.ok(!fs.existsSync(receipts) || fs.readdirSync(receipts).length === 0, 'no receipt was written');
		assert.match(r.out, /GOOGLE_CLIENT_SECRET_PATH|client[_ -]secret|OAuth client/i, `the missing input is named:\n${r.out}`);
		noSecret(r.out);
	});
	test('that attempt ends with the pending owner step and the missing input named (the design: pending owner-only actions exit 0; the record read it as non-zero)', () => {
		const r = pty(root, ['setup', 'google-workspace', '--verify', '--authorize'], { env, answers: [{ when: 'OAuth client file', send: '\n' }, { when: 'account', send: '\n' }] });
		assert.equal(r.code, 0, `exit ${r.code}\n${r.out}`);
		assert.match(r.out, /needs input: client_secret/, r.out);
		assert.match(r.out, /authorize-account \(needs input\)/);
	});
	test('a 0644 secret file is refused naming the mode, nothing written', () => {
		const secret = path.join(tmp('dtm-secret-'), 'secret.json'); fs.writeFileSync(secret, SECRET, { mode: 0o644 }); fs.chmodSync(secret, 0o644);
		const before = dirHash(creds);
		const r = pty(root, ['setup', 'google-workspace', '--verify', '--authorize'], { env: { ...env, GOOGLE_CLIENT_SECRET_PATH: secret }, answers: [{ when: 'account', send: '\n' }] });
		noSecret(r.out);
		assert.match(r.out, /0644|readable by other|mode|permission/i, `refused naming the mode:\n${r.out}`);
		assert.doesNotMatch(r.out, /https?:\/\//);
		assert.equal(dirHash(creds), before);
		// "nothing written": a refused secret-path must not reach .env either — the unit reads the key from the env the engine hands it
		assert.doesNotMatch(fs.readFileSync(path.join(root, '.env'), 'utf8'), /GOOGLE_CLIENT_SECRET_PATH=/, 'the world-readable file\'s path is not recorded in .env');
	});
	test('a 0600 file whose contents are not a client config: the provider\'s refusal names the file, never its contents', () => {
		const secret = path.join(tmp('dtm-secret-'), 'secret.json'); fs.writeFileSync(secret, 'SECRET-CONTENT-NOT-A-CLIENT-CONFIG', { mode: 0o600 });
		const before = dirHash(creds);
		const r = pty(root, ['setup', 'google-workspace', '--verify', '--authorize'], { env: { ...env, GOOGLE_CLIENT_SECRET_PATH: secret }, answers: [{ when: 'account', send: 'nobody@example.invalid\n' }] });
		noSecret(r.out);
		assert.doesNotMatch(r.out, /https?:\/\//, 'no browser');
		assert.equal(dirHash(creds), before, 'nothing written to the store');
		assert.match(r.out, /secret\.json|client/i, 'the file is named');
	});
});
