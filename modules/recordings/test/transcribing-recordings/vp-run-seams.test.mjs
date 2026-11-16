// The seams `run` leaves (cr-modules-019 task 4): what was forced and what fell back is on the record,
// the diarisation has an id the ASR cache is matched on, voice signatures go to the user's store with
// the active speaker model (and a refused, unwritable or link-swapped store, a missing speaker model or
// no context leave the transcript written and say signatures were not kept), earlier names move to
// previous_speakers mapped by time and a forgotten person's label keeps no windows, and run writes no
// name (test_vp_run_seams.py; acceptance line 21 is its class Line21). Standard-library unittest with
// diarisation, recognition, the embedder and the record I/O replaced and synthetic voices generated at
// run time, every file in a temp folder — the same shape as run-cleanup.test.mjs.
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

for (const [suite, atLeast] of [['test_vp_run_seams', 53]]) {
	test(`${suite} passes under a bare python3`, () => {
		const r = spawnSync(PY, ['-B', '-m', 'unittest', '-v', suite], { cwd: HERE, encoding: 'utf8' });
		assert.ok(!r.error, `${PY} did not start (${r.error?.code}) — these cases need a python3 on PATH`);
		const ran = /Ran (\d+) tests?/.exec(r.stderr);
		assert.equal(r.status, 0, r.stderr);
		assert.ok(ran && Number(ran[1]) >= atLeast, `expected the whole ${suite} suite to run, got: ${ran?.[0] ?? r.stderr.slice(-400)}`);
	});
}
