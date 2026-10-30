// The GPU pass's pure half — engine selection, whisper.cpp's JSON to timed words, the bidi strip, the
// whisper-cli invocation and the verified ggml download — run by `npm test` and so by CI. The cases
// live in test_engines.py beside this file (stdlib unittest, synthetic fixtures); engines.py is stdlib
// only on purpose, so a bare python3 runs them without the skill's venv, weights or a GPU.
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

test('the engine cases pass under a bare python3', () => {
	const r = spawnSync(PY, ['-B', '-m', 'unittest', '-v', 'test_engines'], { cwd: HERE, encoding: 'utf8' });
	assert.ok(!r.error, `${PY} did not start (${r.error?.code}) — the GPU-pass cases need a python3 on PATH`);
	const ran = /Ran (\d+) tests?/.exec(r.stderr);
	assert.equal(r.status, 0, r.stderr);
	assert.ok(ran && Number(ran[1]) >= 20, `expected the whole engine suite to run, got: ${ran?.[0] ?? r.stderr.slice(-400)}`);
});
