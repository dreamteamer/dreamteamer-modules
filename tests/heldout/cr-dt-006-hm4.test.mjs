// held-out cr-dt-006-hm4 — google's credential store on a path whose parent is group-writable is reported
// blocked, not configured; after chmod 0755 the same call configures it; no secret is ever printed.
// rnd/tests/cr-dt-006-hm4.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { virginWorkspace, packedInto, closure, dt, cleanEnv, cleanup, tmp, skipUnless, statusLines } from './cr-dt-006-lib.mjs';

after(cleanup);
const SECRET = '{"installed":{"client_secret":"SECRET-CONTENT-NEVER-SHOWN-7f3a"}}';

describe('hm4', { skip: skipUnless('google-workspace') }, () => {
	let root, env, from, shared, args;
	test('group-writable parent: the store is not created as configured; placement never reads configured; nothing printed is the secret', () => {
		from = packedInto(tmp('dtm-from-'), ...closure('google-workspace'));
		root = virginWorkspace(); env = cleanEnv();
		shared = path.join(tmp('dtm-shared-'), 'shared'); fs.mkdirSync(shared, { mode: 0o775 }); fs.chmodSync(shared, 0o775);
		const secret = path.join(tmp('dtm-secret-'), 'secret.json'); fs.writeFileSync(secret, SECRET, { mode: 0o600 });
		args = ['install', '@dreamteamer/google-workspace', '--from', from, '--input', `credentials_dir=${path.join(shared, 'creds')}`, '--input', `client_secret=${secret}`, '--allow', 'machine', '--no-input'];
		const r = dt(root, args, env);
		assert.equal(r.code, 0, r.stderr + r.stdout.slice(-500));
		const out = r.stdout + r.stderr;
		assert.doesNotMatch(out, /SECRET-CONTENT/, 'no secret contents appear in any output');
		const created = fs.existsSync(path.join(shared, 'creds'));
		if (created) assert.equal(fs.statSync(path.join(shared, 'creds')).mode & 0o777, 0o700, 'if created, the store is 0700');
		else assert.match(out, /create-credential-store \(blocked\)/, `the store was not created:\n${out.slice(-800)}`);
		const lines = statusLines(root, env);
		const g = lines.find((l) => l.unit === 'google-workspace');
		assert.ok(g, JSON.stringify(lines));
		const placement = g.checks.find((c) => c.id === 'google.credential-placement');
		assert.ok(placement, JSON.stringify(g.checks.map((c) => c.id)));
		assert.ok(!['configured', 'ready'].includes(placement.status), `placement never reads configured: ${JSON.stringify(placement)}`);
		const s = dt(root, ['status'], env);
		assert.doesNotMatch(s.stdout + s.stderr, /SECRET-CONTENT/);
		const d = dt(root, ['doctor', '--strict'], env);
		assert.doesNotMatch(d.stdout + d.stderr, /SECRET-CONTENT/);
	});
	test('the blocked action\'s reason — the group-writable parent — reaches the person in the text output, not only in --json', () => {
		// the record read "doctor --strict exits 1" for a store created under an unsafe parent; the module never
		// creates it (create-credential-store is refused instead), so placement is "not evaluated" and --strict has
		// nothing bad to fail on — what matters is that the refusal's reason is printed where the person looks
		const r = dt(root, ['setup', 'google-workspace', '--allow', 'machine', '--no-input'], env);
		assert.equal(r.code, 0, r.stderr);
		assert.match(r.stdout, /create-credential-store/, r.stdout);
		assert.match(r.stdout, /Other users can write to the parent folder|parent/i, `the reason is printed:\n${r.stdout}`);
		const j = JSON.parse(dt(root, ['setup', 'google-workspace', '--allow', 'machine', '--json'], env).stdout);
		const blocked = j.units[0].pending.find((p) => p.id === 'create-credential-store');
		assert.match(blocked?.reason ?? '', /Other users can write to the parent folder/, 'the JSON carries it');
	});
	test('chmod 0755 the parent and resume with dt setup: the store is created and the placement reads configured', () => {
		fs.chmodSync(shared, 0o755);
		// `dt install` of an installed package is "nothing to do"; the resume verb is `dt setup <unit>`
		const r = dt(root, ['setup', 'google-workspace', '--allow', 'machine', '--no-input'], env);
		assert.equal(r.code, 0, r.stderr + r.stdout.slice(-500));
		assert.ok(fs.existsSync(path.join(shared, 'creds')), 'the store was created');
		assert.equal(fs.statSync(path.join(shared, 'creds')).mode & 0o777, 0o700, 'owner-only');
		const g = statusLines(root, env).find((l) => l.unit === 'google-workspace');
		const placement = g.checks.find((c) => c.id === 'google.credential-placement');
		assert.ok(['configured', 'ready'].includes(placement.status), JSON.stringify(placement));
		assert.doesNotMatch(r.stdout + r.stderr, /SECRET-CONTENT/);
	});
});
