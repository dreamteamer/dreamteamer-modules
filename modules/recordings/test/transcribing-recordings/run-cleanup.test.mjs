// What a transcription leaves behind on the machine: no decoded audio in TMPDIR (test_run_cleanup.py),
// and the venv and the raw ASR cache in a per-machine cache outside node_modules (test_locations.py).
// Both are stdlib unittest with synthetic fixtures, so a bare python3 runs them without the skill's venv,
// weights or a GPU — the same shape as engines.test.mjs.
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

for (const [suite, atLeast] of [['test_run_cleanup', 6], ['test_locations', 13]]) {
	test(`${suite} passes under a bare python3`, () => {
		const r = spawnSync(PY, ['-B', '-m', 'unittest', '-v', suite], { cwd: HERE, encoding: 'utf8' });
		assert.ok(!r.error, `${PY} did not start (${r.error?.code}) — these cases need a python3 on PATH`);
		const ran = /Ran (\d+) tests?/.exec(r.stderr);
		assert.equal(r.status, 0, r.stderr);
		assert.ok(ran && Number(ran[1]) >= atLeast, `expected the whole ${suite} suite to run, got: ${ran?.[0] ?? r.stderr.slice(-400)}`);
	});
}
