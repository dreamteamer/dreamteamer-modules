// held-out cr-dt-006-hm1 — composed core (which provides meetings) and the small meetings module side
// by side: two units, one id — refused at compile; status still answers; install refuses by provides.
// rnd/tests/cr-dt-006-hm1.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { virginWorkspace, packedInto, closure, dt, cleanEnv, cleanup, tmp, skipUnless, bypassInstall } from './cr-dt-006-lib.mjs';

after(cleanup);

describe('hm1', { skip: skipUnless('core') }, () => {
	test('install path refused naming core › meetings; the bypass is a compile refusal naming both packages; status still answers', () => {
		const root = virginWorkspace();
		const env = cleanEnv();
		const from = packedInto(tmp('dtm-from-'), ...new Set([...closure('core'), ...closure('meetings')]));
		const r = dt(root, ['install', '@dreamteamer/core', '--from', from, '--input', `files_folder=${path.join(env.HOME, 'files')}`, '--no-input'], env);
		assert.equal(r.code, 0, r.stderr + r.stdout.slice(-500));
		const refused = dt(root, ['install', '@dreamteamer/meetings', '--from', from], env);
		assert.equal(refused.code, 1, refused.stdout + refused.stderr);
		assert.match(refused.stderr, /@dreamteamer\/core already provides @dreamteamer\/meetings/, 'the install path names the pair, via provides');
		// bypass dt install: the meetings package put in place and declared by hand
		bypassInstall(root, 'meetings');
		const manifestBefore = fs.readFileSync(path.join(root, '.dreamteamer', 'manifest.yaml'), 'utf8');
		const c = dt(root, ['compile'], env);
		assert.equal(c.code, 1, `compile refuses: exit ${c.code}\n${c.stdout}${c.stderr}`);
		assert.match(c.stderr, /unit "?meetings"? is contributed by @dreamteamer\/(core|meetings) and @dreamteamer\/(core|meetings)/, c.stderr);
		assert.equal(fs.readFileSync(path.join(root, '.dreamteamer', 'manifest.yaml'), 'utf8'), manifestBefore, 'the previous runtime stands');
		const s = dt(root, ['status'], env);
		assert.equal(s.code, 0, `status answers (read-only, no crash): ${s.stderr}`);
		assert.doesNotMatch(s.stderr, /TypeError|at .*\.js:\d+/, 'no crash');
		assert.match(s.stdout + s.stderr, /meetings/, 'and names the unit in question');
		const again = dt(root, ['install', '@dreamteamer/meetings', '--from', from], env);
		assert.notEqual(again.code, 0, 'the install path is still a refusal');
		assert.match(again.stderr, /core|contributed by/, again.stderr);
	});
});
