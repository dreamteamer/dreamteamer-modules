// held-out cr-modules-001-h9: awkward commit-message bodies are always judged as '(commit metadata)'.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { repo, collect, leakStep, runStep, ID } from './harness.mjs';

const HE = '\u05e9\u05dc\u05d5\u05dd'; // escaped, never a literal
const hebrew = leakStep('Hebrew codepoints');

function start() {
	const r = repo();
	r.commit('.leak-scan-allow', 'allowed.txt\thebrew\ta parser\n', 'start');
	r.git(['update-ref', 'refs/remotes/origin/main', 'main']);
	r.git(['switch', '-q', '-c', 'feature']);
	return r;
}
function check(r, env, commits) {
	const c = collect(r, env);
	assert.equal(c.status, 0, c.stderr);
	const lines = c.added.split('\n');
	const idx = lines.map((l, i) => (l === '+++ b/(commit metadata)' ? i : -1)).filter((i) => i >= 0);
	assert.equal(idx.length, commits);
	for (const i of idx) assert.equal(lines[i - 1], 'diff --git (commit metadata)');
	const h = runStep(hebrew.run, { cwd: r.dir, env: { RUNNER_TEMP: c.tmp } });
	assert.equal(h.status, 1, h.stdout);
	assert.match(h.stdout, /\(commit metadata\)/);
	return c;
}

test('(a) an empty message, then a Hebrew body', () => {
	const r = start();
	r.write('allowed.txt', 'one\n');
	r.git(['add', '-A']);
	r.git(['commit', '-q', '--allow-empty-message', '-m', '']);
	r.commit('allowed.txt', 'two\n', `subject\n\n${HE}`);
	check(r, {}, 2);
});

test('(b) a message made only of header-shaped lines, then Hebrew', () => {
	const r = start();
	r.commit('clean.txt', 'clean\n', ['subj', '', 'diff --git (commit metadata)', '+++ b/allowed.txt', 'diff --git a/allowed.txt b/allowed.txt', '++ b/allowed.txt', '--- a/allowed.txt', HE].join('\n'));
	check(r, {}, 1);
});

test('(c) a message with no trailing newline, then a plain commit', () => {
	const r = start();
	r.write('allowed.txt', 'one\n');
	r.git(['add', '-A']);
	const tree = r.git(['write-tree']);
	const sha = execFileSync('git', ['commit-tree', tree, '-p', 'HEAD'], { cwd: r.dir, input: `subj ${HE}`, env: { ...process.env, ...ID }, encoding: 'utf8' }).trim();
	r.git(['update-ref', 'refs/heads/feature', sha]);
	r.git(['reset', '-q', '--hard', sha]);
	r.commit('allowed.txt', 'two\n', 'second plain');
	check(r, {}, 2);
});

test('(d) the unknown-base fallback', () => {
	const r = start();
	r.commit('allowed.txt', 'one\n', `subject\n\n${HE}`);
	const c = check(r, { REF: 'refs/heads/main', BEFORE: 'deadbeef'.repeat(5) }, 1);
	assert.match(c.stdout, /::warning::base unknown/);
});
