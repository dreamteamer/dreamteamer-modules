// held-out cr-modules-001-h2: the collect step on edge pushes.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { repo, collect, leakStep, runStep } from './harness.mjs';

const ZERO = '0'.repeat(40);
const lines = (s) => s.split('\n').filter(Boolean).length;
const letters = 'abcdefghijklmnopqrstuvwxyz';
const literals = Array.from({ length: 120 }, (_, i) => `qq${letters[Math.floor(i / 26)]}${letters[i % 26]}zz`);
const PATTERN = `northwind|harbor-mutual|\\b(${literals.join('|')})\\b`;

test('(a) a new branch with zero commits over main collects nothing, and the names step passes', () => {
	const r = repo();
	r.commit('a.txt', 'clean\n', 'start');
	r.git(['update-ref', 'refs/remotes/origin/main', 'main']);
	r.git(['switch', '-q', '-c', 'new']);
	const c = collect(r, { REF: 'refs/heads/new', BEFORE: ZERO });
	assert.equal(c.status, 0, c.stderr);
	assert.equal(lines(c.added), 0);
	const n = runStep(leakStep('private names').run, { env: { RUNNER_TEMP: c.tmp, LEAK_NAMES: PATTERN } });
	assert.equal(n.status, 0, n.stdout + n.stderr);
});

test('(b) a token commit behind a later main change to the same file', () => {
	const r = repo();
	r.commit('f.txt', 'one\ntwo\n', 'F');
	r.git(['switch', '-q', '-c', 'br']);
	r.commit('f.txt', 'one\ntwo\nqqtokenzz\n', 'add line');
	r.git(['switch', '-q', 'main']);
	r.commit('f.txt', 'ONE\ntwo\n', 'main edit qqmainmsgzz');
	r.git(['update-ref', 'refs/remotes/origin/main', 'main']);
	r.git(['switch', '-q', 'br']);
	const c = collect(r, { REF: 'refs/heads/br', BEFORE: ZERO });
	assert.equal(c.status, 0, c.stderr);
	assert.match(c.added, /qqtokenzz/);
	assert.doesNotMatch(c.added, /qqmainmsgzz/);
});

test('(c) an orphan branch falls back to the tree and HEAD\'s message, without aborting', () => {
	const r = repo();
	r.commit('a.txt', 'clean\n', 'start');
	r.git(['update-ref', 'refs/remotes/origin/main', 'main']);
	r.git(['switch', '-q', '--orphan', 'lone']); // an empty index and tree
	if (fs.existsSync(path.join(r.dir, 'a.txt'))) fs.rmSync(path.join(r.dir, 'a.txt'));
	r.commit('old.txt', 'qqoldzz\n', 'old one');
	r.commit('old.txt', null, 'old gone');
	r.commit('z.txt', 'qqlonezz\n', 'lone qqlonemsgzz');
	const c = collect(r, { REF: 'refs/heads/lone', BEFORE: ZERO });
	assert.equal(c.status, 0, c.stderr);
	assert.match(c.stdout, /::warning::base unknown/);
	assert.match(c.added, /qqlonezz/);
	assert.match(c.added, /qqlonemsgzz/);
	assert.doesNotMatch(c.added, /qqoldzz/);
	assert.doesNotMatch(c.added, /old one|old gone|\+start/);
});

test('(d) a push to main with an empty range collects nothing', () => {
	const r = repo();
	r.commit('a.txt', 'clean\n', 'start');
	const head = r.commit('b.txt', 'more\n', 'more');
	const c = collect(r, { REF: 'refs/heads/main', BEFORE: head });
	assert.equal(c.status, 0, c.stderr);
	assert.equal(lines(c.added), 0);
});
