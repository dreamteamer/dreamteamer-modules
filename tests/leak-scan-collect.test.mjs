// leak-scan's "collect added lines" step, run for real under bash against scratch git repos
// (cr-modules-001, design D-a). It must collect the added lines of EVERY commit a push or a pull request
// brings over its base — so a later commit cannot hide an earlier one — and every one of those commits'
// MESSAGES, because a message is published with the commit (round-2 finding d2-01). It must never widen
// an unknown base to the whole history (d2-02), and it does not collect author or committer identities
// (round-3 r3-03: an identity is the committer's own). The token below is synthetic.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const wf = yaml.load(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'leak-scan.yml'), 'utf8'));
const step = wf.jobs.scan.steps.find((s) => s.name === 'collect added lines');
const TOKEN = 'qqtokenzz';
const ID = { GIT_AUTHOR_NAME: 'Dana Oren', GIT_AUTHOR_EMAIL: 'dana@northwind.example', GIT_COMMITTER_NAME: 'Dana Oren', GIT_COMMITTER_EMAIL: 'dana@northwind.example' };

function repo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collect-'));
	const git = (args, env = {}) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...ID, ...env }, encoding: 'utf8' }).trim();
	git(['init', '-q', '-b', 'main']);
	git(['config', 'commit.gpgsign', 'false']);
	const commit = (file, text, message = `edit ${file}`, env = {}) => {
		if (text === null) fs.rmSync(path.join(dir, file));
		else fs.writeFileSync(path.join(dir, file), text);
		git(['add', '-A']);
		git(['commit', '-q', '-m', message], env);
		return git(['rev-parse', 'HEAD']);
	};
	return { dir, git, commit };
}

/** Run the step's own `run` as the runner does (`bash -e {0}`, no pipefail — read from a live run's log) and return stdout and the collected file. */
function collect(r, env) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-'));
	const res = spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', step.run], {
		cwd: r.dir,
		env: { ...process.env, RUNNER_TEMP: tmp, EVENT_NAME: 'push', REF: 'refs/heads/feature', BEFORE: '', PR_BASE: '', ...env },
		encoding: 'utf8',
	});
	assert.equal(res.status, 0, `collect step failed: ${res.stderr}`);
	return { stdout: res.stdout, added: fs.readFileSync(path.join(tmp, 'added.txt'), 'utf8') };
}

/** main with one clean commit, a fake origin/main, and a feature branch off it. */
function forked() {
	const r = repo();
	r.commit('a.txt', 'clean\n', 'start');
	r.git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
	r.git(['switch', '-q', '-c', 'feature']);
	return r;
}

test('the step reads only env, never a ${{ }} expression inside run', () => {
	assert.ok(step, "no step named 'collect added lines'");
	assert.doesNotMatch(step.run, /\$\{\{/);
	for (const k of ['EVENT_NAME', 'REF', 'BEFORE', 'PR_BASE']) assert.ok(k in step.env, `env ${k} missing`);
});

test('a token added by one commit and deleted by the next is still collected (the net diff would hide it)', () => {
	const r = forked();
	r.commit('b.txt', `line ${TOKEN}\n`);
	r.commit('b.txt', 'line\n');
	const { added } = collect(r, {});
	assert.match(added, new RegExp(TOKEN));
	const net = r.git(['diff', 'origin/main', 'HEAD', '-U0']);
	assert.doesNotMatch(net, new RegExp(`^\\+.*${TOKEN}`, 'm'), 'the old net diff is the hole this closes');
});

test('a deleted line is not collected', () => {
	const r = repo();
	r.commit('a.txt', `keep\n${TOKEN}\n`, 'start');
	r.git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
	r.git(['switch', '-q', '-c', 'feature']);
	r.commit('a.txt', 'keep\n', 'drop a line');
	assert.doesNotMatch(collect(r, {}).added, new RegExp(TOKEN));
});

test("a token only in a commit message is collected, under the '(commit metadata)' header", () => {
	const r = forked();
	r.commit('b.txt', 'clean\n', `fix the import ${TOKEN} reported`);
	const { added } = collect(r, {});
	const lines = added.split('\n');
	const hit = lines.findIndex((l) => l.includes(TOKEN));
	assert.ok(hit > 0, 'message not collected');
	assert.match(lines[hit], /^\+/);
	const header = lines.slice(0, hit).reverse().find((l) => l.startsWith('+++ b/'));
	assert.equal(header, '+++ b/(commit metadata)');
});

test('author and committer identities are not collected (decision r3-03)', () => {
	const r = forked();
	r.commit('b.txt', 'clean\n', 'clean message', { GIT_AUTHOR_NAME: TOKEN, GIT_COMMITTER_EMAIL: `${TOKEN}@example.com` });
	assert.doesNotMatch(collect(r, {}).added, new RegExp(TOKEN));
});

test('a push to a branch other than main is scanned over its merge-base with origin/main', () => {
	const r = forked();
	r.commit('b.txt', 'feature line\n', 'feature work');
	r.git(['switch', '-q', 'main']);
	r.commit('c.txt', `main line ${TOKEN}\n`, `main moved ${TOKEN}`);
	r.git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
	r.git(['switch', '-q', 'feature']);
	const { added } = collect(r, {});
	assert.match(added, /feature line/);
	assert.doesNotMatch(added, new RegExp(TOKEN), "main's own later commit is not this branch's");
});

test('a push to main scans the commits since the previous tip', () => {
	const r = repo();
	const before = r.commit('a.txt', `old ${TOKEN}\n`, 'old');
	r.commit('a.txt', 'new\n', 'new');
	r.commit('b.txt', 'pushed line\n', 'pushed');
	const { added } = collect(r, { REF: 'refs/heads/main', BEFORE: before });
	assert.match(added, /pushed line/);
	assert.doesNotMatch(added, new RegExp(TOKEN), 'the commit before BEFORE is not in this push');
});

test('an unknown base scans the tree and HEAD\'s message only — never the whole history', () => {
	const r = repo();
	r.commit('a.txt', `old ${TOKEN}\n`, 'old');
	r.commit('a.txt', 'now clean\n', 'cleaned');
	r.commit('b.txt', 'head line\n', 'the head message');
	for (const before of ['0000000000000000000000000000000000000000', 'deadbeef'.repeat(5), '']) {
		const { stdout, added } = collect(r, { REF: 'refs/heads/main', BEFORE: before });
		assert.match(stdout, /::warning::base unknown/);
		assert.doesNotMatch(added, new RegExp(TOKEN));
		assert.match(added, /now clean/);
		assert.match(added, /\+the head message/);
		assert.doesNotMatch(added, /\+cleaned/, "an older commit's message is not collected");
	}
});

test('a pull request is scanned over its base sha', () => {
	const r = forked();
	const base = r.git(['rev-parse', 'origin/main']);
	r.commit('b.txt', 'pr line\n', `pr message ${TOKEN}`);
	const { added } = collect(r, { EVENT_NAME: 'pull_request', PR_BASE: base });
	assert.match(added, /pr line/);
	assert.match(added, new RegExp(`\\+pr message ${TOKEN}`));
	assert.doesNotMatch(added, /\+start$/m, "the base's own message is not collected");
});

// ── a file header cannot be forged by an added line or a message line (code review c1-03) ─────────
// The Hebrew rule exempts files by the `+++ b/<path>` header before their lines. A message line or a
// content line `++ b/<allow-listed path>` becomes `+++ b/<path>` once prefixed, so a header is honoured
// only right after the `diff --git` line git writes before every file's own header.
const hebrew = wf.jobs.scan.steps.find((s) => s.name === 'Hebrew codepoints');
function collectAndHebrew(r, env) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-'));
	const base = { ...process.env, RUNNER_TEMP: tmp, EVENT_NAME: 'push', REF: 'refs/heads/feature', BEFORE: '', PR_BASE: '', ...env };
	const c = spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', step.run], { cwd: r.dir, env: base, encoding: 'utf8' });
	assert.equal(c.status, 0, c.stderr);
	return spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', hebrew.run], { cwd: r.dir, env: base, encoding: 'utf8' });
}
function allowListed() {
	const r = repo();
	r.commit('.leak-scan-allow', 'allowed.txt\thebrew\ta parser whose subject is Hebrew\n', 'start');
	r.git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
	r.git(['switch', '-q', '-c', 'feature']);
	return r;
}
const HE = '\u05e9\u05dc\u05d5\u05dd'; // escaped: a literal would trip the tree-wide Hebrew rule this test is about

test('Hebrew in an allow-listed file passes; in another file it fails', () => {
	const ok = allowListed();
	ok.commit('allowed.txt', `${HE}\n`);
	assert.equal(collectAndHebrew(ok, {}).status, 0);
	const bad = allowListed();
	bad.commit('other.txt', `${HE}\n`);
	assert.equal(collectAndHebrew(bad, {}).status, 1);
});

test('a commit message cannot forge an allow-listed file header', () => {
	const r = allowListed();
	r.commit('clean.txt', 'clean\n', `subject\n\n++ b/allowed.txt\n${HE}`);
	assert.equal(collectAndHebrew(r, {}).status, 1);
});

test('an added content line cannot forge an allow-listed file header', () => {
	const r = allowListed();
	r.commit('other.txt', `++ b/allowed.txt\n${HE}\n`);
	assert.equal(collectAndHebrew(r, {}).status, 1);
});
