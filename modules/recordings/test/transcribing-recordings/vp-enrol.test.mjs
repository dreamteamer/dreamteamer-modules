// Enrolment (cr-modules-019 task 5): design section 9's checks 1 to 10, admission, trust, the reseed
// notice, corrections, and the one replay in a total order that live confirmation shares
// (test_vp_enrol.py). Standard-library unittest over synthetic voices made at run time (vp_synth.py) in
// temp stores, so a bare python3 runs it without the skill's venv, weights or a GPU — the same shape as
// run-cleanup.test.mjs.
//
// ⚠ A missing python3 FAILS here rather than skipping: a skipped file is green in every job and
// tested nowhere. GitHub's ubuntu runners carry python3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = process.env.PYTHON || 'python3';

for (const [suite, atLeast] of [['test_vp_enrol', 69]]) {
	test(`${suite} passes under a bare python3`, () => {
		const r = spawnSync(PY, ['-B', '-m', 'unittest', '-v', suite], { cwd: HERE, encoding: 'utf8' });
		assert.ok(!r.error, `${PY} did not start (${r.error?.code}) — these cases need a python3 on PATH`);
		const ran = /Ran (\d+) tests?/.exec(r.stderr);
		assert.equal(r.status, 0, r.stderr);
		assert.ok(ran && Number(ran[1]) >= atLeast, `expected the whole ${suite} suite to run, got: ${ran?.[0] ?? r.stderr.slice(-400)}`);
	});
}
