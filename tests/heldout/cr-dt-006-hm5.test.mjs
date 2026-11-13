// held-out cr-dt-006-hm5 — a phase-2 unit whose tool is on PATH but not executable reads blocked, never
// configured, and is never run by status or doctor. rnd/tests/cr-dt-006-hm5. (The docker-workspaces half is
// retired by D49: it stays a no-setup module, and the test holds it to that.)
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { virginWorkspace, packedInto, closure, dt, cleanEnv, cleanup, tmp, skipUnless, fakeBins, statusLines } from './cr-dt-006-lib.mjs';

after(cleanup);

describe('hm5', { skip: skipUnless('wikis') }, () => {
	let root, env, bins, trap;
	test('qmd on PATH as a 0644 file: wikis reads blocked (not configured), doctor row bad, install-qmd offered, the file never executed; chmod +x → configured', () => {
		const from = packedInto(tmp('dtm-from-'), ...closure('wikis'), ...closure('docker-workspaces'));
		root = virginWorkspace(); env = cleanEnv();
		trap = path.join(tmp('dtm-trap-'), 'ran');
		bins = fakeBins(['qmd', 'docker'], { bodies: { qmd: `#!/bin/sh\ntouch ${trap}\nexit 0\n`, docker: `#!/bin/sh\ntouch ${trap}\nexit 0\n` }, mode: 0o644 });
		// the install needs node and npm on PATH; status and doctor are then read with ONLY the stand-ins and the
		// system folders — a qmd the operator installed beside node or under /opt/homebrew must not answer for the fixture
		const r = dt(root, ['install', '@dreamteamer/wikis', '@dreamteamer/docker-workspaces', '--from', from, '--no-input'], { ...env, PATH: `${bins}${path.delimiter}${env.PATH}` });
		env.PATH = [bins, '/usr/bin', '/bin'].join(path.delimiter);
		assert.equal(r.code, 0, r.stderr + r.stdout.slice(-500));
		const lines = statusLines(root, env);
		const w = lines.find((l) => l.unit === 'wikis');
		assert.ok(w, JSON.stringify(lines));
		assert.equal(w.state, 'blocked', `blocked, not configured: ${JSON.stringify(w)}`);
		const d = dt(root, ['doctor', '--json'], env);
		assert.equal(d.code, 0, d.stderr);
		const cap = JSON.parse(d.stdout).find?.((c) => c.name === 'wikis') ?? Object.values(JSON.parse(d.stdout)).flat().find?.((c) => c?.name === 'wikis');
		assert.ok(cap, d.stdout.slice(0, 400));
		assert.ok(cap.checks.some((k) => k.state === 'bad'), `doctor's row is bad: ${JSON.stringify(cap)}`);
		assert.match(dt(root, ['setup', 'wikis', '--no-input'], env).stdout, /… install-qmd/, 'install-qmd is still offered as pending');
		assert.ok(!fs.existsSync(trap), 'status and doctor never ran the file');
		const dw = lines.find((l) => l.package === '@dreamteamer/docker-workspaces');
		assert.ok(dw && dw.state === 'no-setup', `docker-workspaces stays a no-setup module (D49): ${JSON.stringify(dw)}`);
		fs.chmodSync(path.join(bins, 'qmd'), 0o755);
		const after = statusLines(root, env).find((l) => l.unit === 'wikis');
		// the record says "reads configured": the check is configured, and a unit whose every check is configured folds to ready
		assert.equal(after.checks[0].status, 'configured', JSON.stringify(after));
		assert.ok(['configured', 'ready'].includes(after.state), JSON.stringify(after));
		assert.ok(!fs.existsSync(trap), 'still never executed');
	});
	test('the detail says the tool is on PATH but not executable, with the fix', () => {
		fs.chmodSync(path.join(bins, 'qmd'), 0o644);
		const w = statusLines(root, env).find((l) => l.unit === 'wikis');
		assert.match(w.detail, /on PATH but not executable/, `the detail tells the person what is wrong: ${JSON.stringify(w)}`);
		assert.match(w.next ?? '', /chmod \+x|reinstall/, 'and the fix');
	});
});
