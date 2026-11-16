// The speaker models (cr-modules-019 task 3): the registry is complete, the files live in
// models/speaker/ apart from the diariser's, a file whose sha256 is not the registry's is refused,
// the active model is the one the skill's calibration/ folder names, `setup --speaker-models all`
// asks for every registered model and nothing else, and a missing speaker model is reported only when
// asked (test_vp_models.py). Standard-library unittest with stand-in files in temp folders and a
// mocked download, so a bare python3 runs it with no model on disk and no network; the embedding
// class needs numpy and runs where numpy is installed — the same shape as run-cleanup.test.mjs.
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

for (const [suite, atLeast] of [['test_vp_models', 37]]) {
	test(`${suite} passes under a bare python3`, () => {
		const r = spawnSync(PY, ['-B', '-m', 'unittest', '-v', suite], { cwd: HERE, encoding: 'utf8' });
		assert.ok(!r.error, `${PY} did not start (${r.error?.code}) — these cases need a python3 on PATH`);
		const ran = /Ran (\d+) tests?/.exec(r.stderr);
		assert.equal(r.status, 0, r.stderr);
		assert.ok(ran && Number(ran[1]) >= atLeast, `expected the whole ${suite} suite to run, got: ${ran?.[0] ?? r.stderr.slice(-400)}`);
	});
}
