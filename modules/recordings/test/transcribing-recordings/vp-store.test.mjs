// The per-user voice-print store (cr-modules-019 task 2): its default location per platform, the
// refusals (a git tree, the workspace, a files or inbox folder, a cloud or sync folder — with a team or
// account suffix too — through a symlink too, and a sub-folder or lock file linked out of the store),
// the layout, atomic writes, the advisory lock across two processes, and the model pin
// (test_vp_store.py). Standard-library unittest in temp folders with HOME pointed at a temp folder,
// so a bare python3 runs it and the real store is never touched — the same shape as
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

for (const [suite, atLeast] of [['test_vp_store', 58]]) {
	test(`${suite} passes under a bare python3`, () => {
		const r = spawnSync(PY, ['-B', '-m', 'unittest', '-v', suite], { cwd: HERE, encoding: 'utf8' });
		assert.ok(!r.error, `${PY} did not start (${r.error?.code}) — these cases need a python3 on PATH`);
		const ran = /Ran (\d+) tests?/.exec(r.stderr);
		assert.equal(r.status, 0, r.stderr);
		assert.ok(ran && Number(ran[1]) >= atLeast, `expected the whole ${suite} suite to run, got: ${ran?.[0] ?? r.stderr.slice(-400)}`);
	});
}
