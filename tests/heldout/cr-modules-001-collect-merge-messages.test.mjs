// held-out cr-modules-001-h10: a merge commit's message, in a branch range and in a pull-request merge ref.
import { test } from 'node:test';
import assert from 'node:assert';
import { repo, collect, leakStep, runStep } from './harness.mjs';

const HE = '\u05e9\u05dc\u05d5\u05dd'; // escaped, never a literal
const hebrew = leakStep('Hebrew codepoints');

function setup() {
	const r = repo();
	r.commit('.leak-scan-allow', 'allowed.txt\thebrew\ta parser\n', 'start');
	r.git(['switch', '-q', '-c', 'feature']);
	r.commit('allowed.txt', 'b1\n', 'B1 plain');
	r.git(['switch', '-q', 'main']);
	r.commit('m.txt', 'm1\n', 'M1 plain');
	r.git(['update-ref', 'refs/remotes/origin/main', 'main']);
	r.git(['switch', '-q', 'feature']);
	r.git(['merge', '-q', '--no-ff', '-m', `merge main ${HE}`, 'main']);
	return r;
}
function headers(c, expected) {
	const lines = c.added.split('\n');
	const idx = lines.map((l, i) => (l === '+++ b/(commit metadata)' ? i : -1)).filter((i) => i >= 0);
	assert.equal(idx.length, expected);
	for (const i of idx) assert.equal(lines[i - 1], 'diff --git (commit metadata)');
}

test('(1) a branch push whose range holds a Hebrew merge message', () => {
	const r = setup();
	const c = collect(r, { EVENT_NAME: 'push', REF: 'refs/heads/feature', BEFORE: '0'.repeat(40) });
	assert.equal(c.status, 0, c.stderr);
	headers(c, Number(r.git(['rev-list', '--count', `${r.git(['merge-base', 'origin/main', 'HEAD'])}..HEAD`])));
	assert.equal(runStep(hebrew.run, { cwd: r.dir, env: { RUNNER_TEMP: c.tmp } }).status, 1);
});

test('(2) a pull-request merge ref', () => {
	const r = setup();
	const feature = r.git(['rev-parse', 'feature']);
	r.git(['checkout', '-q', 'main^0']);
	r.git(['merge', '-q', '--no-ff', '-m', 'Merge br into main', feature]);
	const base = r.git(['rev-parse', 'main']);
	const c = collect(r, { EVENT_NAME: 'pull_request', PR_BASE: base, REF: 'refs/pull/1/merge' });
	assert.equal(c.status, 0, c.stderr);
	headers(c, Number(r.git(['rev-list', '--count', `${base}..HEAD`])));
	assert.equal(runStep(hebrew.run, { cwd: r.dir, env: { RUNNER_TEMP: c.tmp } }).status, 1);
});
