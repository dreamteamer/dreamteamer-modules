// held-out cr-modules-001-h6: the release leak gate across several xargs batches.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { repo, releaseStep, runStep } from './harness.mjs';

const gate = releaseStep(/leak gate/);
const realXargs = execFileSync('bash', ['-c', 'command -v xargs'], { encoding: 'utf8' }).trim();

function tree(where) {
	const r = repo();
	for (let i = 0; i < 400; i++) r.write(`dir-${String(i).padStart(3, '0')}/file-${String(i).padStart(3, '0')}.txt`, 'one clean line\n');
	r.write('aaa-first.txt', where === 'first' ? 'qqtokenzz\n' : 'clean\n');
	r.write('zzz-last.txt', where === 'last' ? 'qqtokenzz\n' : 'clean\n');
	r.commit(null, null, 'tree');
	return r;
}

function run(r) {
	const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-'));
	fs.writeFileSync(path.join(shim, 'xargs'), `#!/bin/sh\nexec ${realXargs} -n 50 "$@"\n`, { mode: 0o755 });
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-'));
	return runStep(gate.run, { cwd: r.dir, env: { PATH: `${shim}:${process.env.PATH}`, RUNNER_TEMP: tmp, LEAK_NAMES: '\\b(qqtokenzz)\\b' } });
}

for (const where of ['last', 'first']) {
	test(`the token in the ${where} file is found across batches`, () => {
		const r = run(tree(where));
		assert.equal(r.status, 1, r.stdout);
		assert.match(r.stdout, /::error::.*private name/);
		assert.match(r.stdout, where === 'last' ? /zzz-last\.txt/ : /aaa-first\.txt/);
		assert.doesNotMatch(r.stdout, /the published tree is clean/);
	});
}

test('with the token in no file the gate passes', () => {
	const r = run(tree('none'));
	assert.equal(r.status, 0, r.stdout);
});
