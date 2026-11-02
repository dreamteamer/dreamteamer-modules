// held-out cr-modules-001-h5: release.yml's publish step picks a branch only on exactly 'false' or 'true'.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { releaseStep, runStep } from './harness.mjs';

const publish = releaseStep(/^publish$/);

function go(answer, rc = 0, shell = ['-e'], silent = false) {
	const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'stub-'));
	const npmLog = path.join(bin, 'npm.log');
	fs.writeFileSync(path.join(bin, 'gh'), silent ? '#!/bin/sh\nexit "$STUB_RC"\n' : '#!/bin/sh\nprintf \'%s\\n\' "$STUB_ANSWER"\nexit "$STUB_RC"\n', { mode: 0o755 });
	fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\necho "$@" >> "$NPM_LOG"\nexit 0\n', { mode: 0o755 });
	const r = runStep(publish.run, {
		shell,
		env: { PATH: `${bin}:${process.env.PATH}`, STUB_ANSWER: answer, STUB_RC: String(rc), NPM_LOG: npmLog, GITHUB_REPOSITORY: 'dreamteamer/dreamteamer-modules', NPM_ACCESS: 'public', GH_TOKEN: 'x' },
	});
	return { ...r, npm: fs.existsSync(npmLog) ? fs.readFileSync(npmLog, 'utf8') : null };
}

for (const shell of [['-e'], ['-eo', 'pipefail']]) {
	test(`exactly false and true choose a branch (${shell.join(' ')})`, () => {
		const f = go('false', 0, shell);
		assert.equal(f.status, 0, f.stderr);
		assert.match(f.stdout, /public source repo — publishing with provenance/);
		const fl = f.npm.trim().split('\n');
		assert.equal(fl.length, 1);
		assert.match(fl[0], /publish/);
		assert.match(fl[0], /--provenance/);
		assert.match(fl[0], /--access public/);
		const t = go('true', 0, shell);
		assert.equal(t.status, 0, t.stderr);
		assert.match(t.stdout, /publishing without/);
		assert.doesNotMatch(t.npm, /--provenance/);
	});

	test(`every other answer and every gh failure stops before npm (${shell.join(' ')})`, () => {
		const cases = [['"false"'], ['False'], ['FALSE'], [''], ['false '], [' false'], ['null'], ['true\nfalse'], ['false', 1], ['', 22, true]];
		for (const [answer, rc = 0, silent = false] of cases) {
			const r = go(answer, rc, shell, silent);
			assert.notEqual(r.status, 0, `answer ${JSON.stringify(answer)} rc ${rc} must fail`);
			assert.equal(r.npm, null, `npm ran on answer ${JSON.stringify(answer)} rc ${rc}`);
		}
	});
}
