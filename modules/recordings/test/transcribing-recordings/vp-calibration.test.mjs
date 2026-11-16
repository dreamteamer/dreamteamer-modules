// The developer's calibration tools (cr-modules-019 task 8): the calibration file and the decision rule of
// design section 13, `label`'s listening session and `evaluate-speakers` with its leave-one-recording-out
// folds (test_vp_calibration.py). Standard-library unittest over synthetic voices made at run time
// (vp_synth.py) in temp stores, with the player and ffmpeg replaced, so a bare python3 runs it without the
// skill's venv, weights, sound or audio — the same shape as run-cleanup.test.mjs.
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

for (const [suite, atLeast] of [['test_vp_calibration', 59]]) {
	test(`${suite} passes under a bare python3`, () => {
		const r = spawnSync(PY, ['-B', '-m', 'unittest', '-v', suite], { cwd: HERE, encoding: 'utf8' });
		assert.ok(!r.error, `${PY} did not start (${r.error?.code}) — these cases need a python3 on PATH`);
		const ran = /Ran (\d+) tests?/.exec(r.stderr);
		assert.equal(r.status, 0, r.stderr);
		assert.ok(ran && Number(ran[1]) >= atLeast, `expected the whole ${suite} suite to run, got: ${ran?.[0] ?? r.stderr.slice(-400)}`);
	});
}
