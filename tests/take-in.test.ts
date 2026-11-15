// scripts/take-in.sh — how an outside pull request reaches main (cr-modules-001, design D-f and D7).
// A fork's own workflow can report contexts named `ci` and `leak-scan` on its head sha, so its change is
// never taken in AT that sha: it is cherry-picked onto a branch here (new shas, the local committer), where
// only this repo's push-event run reports. And its code is not trusted with this repo's secrets: a change
// that touches the workflows, the leak allow-list or an npm lifecycle script is refused, and such an edit
// lands as the operator's own commit instead (plan review p1-04, p1-05; round-3 r3-01, r3-02).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'take-in.sh');
const ME = { GIT_AUTHOR_NAME: 'Dana Oren', GIT_AUTHOR_EMAIL: 'dana@northwind.example', GIT_COMMITTER_NAME: 'Dana Oren', GIT_COMMITTER_EMAIL: 'dana@northwind.example' };
const FORK = { GIT_AUTHOR_NAME: 'Sam Diaz', GIT_AUTHOR_EMAIL: 'sam@harbor.example', GIT_COMMITTER_NAME: 'Sam Diaz', GIT_COMMITTER_EMAIL: 'sam@harbor.example' };

function setup() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'take-in-'));
	const git = (args, env = ME) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...env }, encoding: 'utf8' }).trim();
	git(['init', '-q', '-b', 'main']);
	git(['config', 'commit.gpgsign', 'false']);
	const write = (file, text) => {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	};
	write('a.txt', 'one\n');
	write('.github/workflows/ci.yml', 'name: ci\n');
	write('.leak-scan-allow', '# allow-list\n');
	write('package.json', JSON.stringify({ name: 'x', scripts: { test: 'node t.mjs' } }, null, 2));
	git(['add', '-A']);
	git(['commit', '-q', '-m', 'start']);
	git(['switch', '-q', '-c', 'fork']);
	const commit = (msg, fn) => {
		fn();
		git(['add', '-A']);
		git(['commit', '-q', '-m', msg], FORK);
		return git(['rev-parse', 'HEAD'], FORK);
	};
	return { dir, git, write, commit };
}
const takeIn = (r, ref = 'fork', branch = 'taken') => {
	r.git(['switch', '-q', 'main']);
	return spawnSync('bash', [SCRIPT, ref, branch], { cwd: r.dir, env: { ...process.env, ...ME }, encoding: 'utf8' });
};
const branchExists = (r, b) => spawnSync('git', ['rev-parse', '--verify', '-q', `refs/heads/${b}`], { cwd: r.dir }).status === 0;

test("a fork based on main's tip is taken in at NEW shas, committed by the local identity", () => {
	const r = setup();
	const a = r.commit('first', () => r.write('a.txt', 'one\ntwo\n'));
	const b = r.commit('second', () => r.write('b.txt', 'b\n'));
	const res = takeIn(r);
	assert.equal(res.status, 0, res.stdout + res.stderr);
	const shas = r.git(['rev-list', 'main..taken']).split('\n');
	assert.equal(shas.length, 2);
	for (const s of shas) assert.ok(s !== a && s !== b, 'a fork sha survived');
	assert.deepStrictEqual(r.git(['log', '--format=%ce', 'main..taken']).split('\n'), ['dana@northwind.example', 'dana@northwind.example']);
	assert.equal(r.git(['diff', 'fork', 'taken']), '', 'the content is the fork\'s');
	assert.match(res.stdout, /git push origin taken:main/);
});

for (const [label, fn] of [
	['edits a workflow', (r) => r.write('.github/workflows/ci.yml', 'name: ci\non: push\n')],
	['adds a workflow in a nested path', (r) => r.write('.github/workflows/sub/x.yml', 'name: x\n')],
	['edits the leak allow-list', (r) => r.write('.leak-scan-allow', '# allow-list\nsome/file\thebrew\twhy\n')],
	['renames a workflow out of .github', (r) => r.git(['mv', '.github/workflows/ci.yml', 'ci.yml'], FORK)],
	['renames a file into .github', (r) => r.git(['mv', 'a.txt', '.github/a.txt'], FORK)],
	['changes an npm lifecycle script', (r) => r.write('package.json', JSON.stringify({ name: 'x', scripts: { test: 'node t.mjs', postinstall: 'node steal.mjs' } }, null, 2))],
]) {
	test(`a change that ${label} is refused, and no branch is left behind`, () => {
		const r = setup();
		r.commit('looks ordinary', () => fn(r));
		const res = takeIn(r);
		assert.equal(res.status, 1, res.stdout + res.stderr);
		assert.ok(!branchExists(r, 'taken'));
	});
}

test('a change hidden by a later commit of the same range is still refused', () => {
	const r = setup();
	r.commit('touch', () => r.write('.leak-scan-allow', '# allow-list\nx\thebrew\ty\n'));
	r.commit('untouch', () => r.write('.leak-scan-allow', '# allow-list\n'));
	assert.equal(takeIn(r).status, 1);
});

test('a range with a merge commit, or no commits over main, is refused', () => {
	const r = setup();
	r.commit('side', () => r.write('b.txt', 'b\n'));
	r.git(['switch', '-q', '-c', 'other', 'main']);
	r.write('c.txt', 'c\n');
	r.git(['add', '-A']);
	r.git(['commit', '-q', '-m', 'other'], FORK);
	r.git(['switch', '-q', 'fork']);
	r.git(['merge', '-q', '--no-edit', 'other'], FORK);
	assert.equal(takeIn(r).status, 1);
	assert.equal(takeIn(r, 'main').status, 1);
});

test('a package.json change that leaves scripts alone is taken in', () => {
	const r = setup();
	r.commit('version', () => r.write('package.json', JSON.stringify({ name: 'x', version: '1.0.1', scripts: { test: 'node t.mjs' } }, null, 2)));
	assert.equal(takeIn(r).status, 0);
});
