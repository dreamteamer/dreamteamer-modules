// held-out cr-modules-001-h7: take-in on hostile refs.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repo, ROOT } from './harness.mjs';

const SCRIPT = path.join(ROOT, 'scripts', 'take-in.sh');
const OUT = { GIT_AUTHOR_NAME: 'outsider', GIT_AUTHOR_EMAIL: 'outsider@harbor.example', GIT_COMMITTER_NAME: 'outsider', GIT_COMMITTER_EMAIL: 'outsider@harbor.example' };

function base() {
	const r = repo();
	r.write('.github/workflows/ci.yml', 'name: ci\n');
	r.write('.github/workflows/leak-scan.yml', 'name: leak-scan\n');
	r.write('.leak-scan-allow', '# allow\n');
	r.write('src/a.txt', 'a\n');
	r.write('src/b.txt', 'b1\nb2\n');
	const first = r.commit(null, null, 'start');
	return { r, first };
}

function fork(r, n, from, edits) {
	r.git(['switch', '-q', '-c', `f${n}`, from]);
	for (const e of edits) {
		e();
		r.git(['add', '-A']);
		r.git(['commit', '-q', '-m', `fork ${n}`], OUT);
	}
	r.git(['update-ref', `refs/remotes/fork/${n}`, 'HEAD']);
	r.git(['switch', '-q', 'main']);
	r.git(['branch', '-q', '-D', `f${n}`]);
}

function check(r, n) {
	const before = r.git(['rev-parse', 'HEAD']);
	const res = spawnSync('bash', [SCRIPT, `fork/${n}`, `take-${n}`], { cwd: r.dir, encoding: 'utf8' });
	assert.notEqual(res.status, 0, `${n}: ${res.stdout}`);
	assert.ok((res.stdout + res.stderr).trim().length > 0, `${n}: no reason given`);
	assert.equal(r.git(['branch', '--list', `take-${n}`]), '');
	assert.equal(r.git(['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
	assert.equal(r.git(['rev-parse', 'HEAD']), before);
	assert.equal(r.git(['status', '--porcelain']), '');
	assert.ok(!fs.existsSync(path.join(r.dir, '.git', 'CHERRY_PICK_HEAD')));
	assert.ok(!fs.existsSync(path.join(r.dir, '.git', 'sequencer')));
}

const plain = (r) => () => r.write('src/a.txt', 'a changed\n');

test('(a) deleting a workflow', () => {
	const { r } = base();
	fork(r, 'a', 'main', [() => { plain(r)(); fs.rmSync(path.join(r.dir, '.github/workflows/ci.yml')); }]);
	check(r, 'a');
});

test('(b) adding an action under .github', () => {
	const { r } = base();
	fork(r, 'b', 'main', [() => { plain(r)(); r.write('.github/actions/x/action.yml', 'runs: {}\n'); }]);
	check(r, 'b');
});

test('(c) moving a workflow out of .github', () => {
	const { r } = base();
	fork(r, 'c', 'main', [() => { plain(r)(); fs.mkdirSync(path.join(r.dir, 'docs'), { recursive: true }); r.git(['mv', '.github/workflows/leak-scan.yml', 'docs/leak-scan.yml'], OUT); }]);
	check(r, 'c');
});

test('(d) moving the allow-list away', () => {
	const { r } = base();
	fork(r, 'd', 'main', [() => { plain(r)(); fs.mkdirSync(path.join(r.dir, 'docs'), { recursive: true }); r.git(['mv', '.leak-scan-allow', 'docs/allow.txt'], OUT); }]);
	check(r, 'd');
});

test('(e) a cherry-pick conflict leaves nothing half-made', () => {
	const { r, first } = base();
	r.write('src/b.txt', 'main b1\nb2\n');
	r.commit(null, null, 'main changes b1');
	fork(r, 'e', first, [plain(r), () => r.write('src/b.txt', 'fork b1\nb2\n')]);
	check(r, 'e');
});
