// held-out cr-modules-001-h1: the collect step over merge commits.
import { test } from 'node:test';
import assert from 'node:assert';
import { repo, collect } from './harness.mjs';

const ZERO = '0'.repeat(40);

function caseA({ resolution = false } = {}) {
	const r = repo();
	r.commit('m0.txt', 'm0\n', 'M0 qqm0msgzz');
	r.git(['switch', '-q', '-c', 'br']);
	r.commit('b.txt', 'qqbranchzz\n', 'B1 qqbranchmsgzz');
	r.git(['switch', '-q', 'main']);
	r.commit('m.txt', 'qqmainzz\n', 'M1 qqmainmsgzz');
	r.git(['switch', '-q', 'br']);
	if (resolution) {
		r.git(['merge', '--no-ff', '--no-commit', 'main']);
		r.write('e.txt', 'qqevilzz\n');
		r.git(['add', '-A']);
		r.git(['commit', '-q', '-m', 'merge main']);
	} else {
		r.git(['merge', '-q', '--no-ff', '-m', 'merge main', 'main']);
	}
	r.git(['update-ref', 'refs/remotes/origin/main', 'main']);
	return r;
}

test('A: a branch that merged main in', () => {
	const r = caseA();
	const c = collect(r, { EVENT_NAME: 'push', REF: 'refs/heads/br', BEFORE: ZERO });
	assert.equal(c.status, 0, c.stderr);
	assert.match(c.added, /qqbranchzz/);
	assert.match(c.added, /qqbranchmsgzz/);
	assert.doesNotMatch(c.added, /qqmainmsgzz/);
	const headers = c.added.split('\n').filter((l) => l === '+++ b/(commit metadata)').length;
	const expected = Number(r.git(['rev-list', '--count', `${r.git(['merge-base', 'origin/main', 'HEAD'])}..HEAD`]));
	assert.equal(headers, expected);
});

test('B: a merge resolution with its own line', () => {
	const r = caseA({ resolution: true });
	const c = collect(r, { EVENT_NAME: 'push', REF: 'refs/heads/br', BEFORE: ZERO });
	assert.equal(c.status, 0, c.stderr);
	assert.match(c.added, /qqevilzz/);
});

function prRef(r) {
	const br = r.git(['rev-parse', 'br']);
	r.git(['checkout', '-q', 'main^0']);
	r.git(['merge', '-q', '--no-ff', '-m', 'Merge br into main', br]);
	return r.git(['rev-parse', 'main']);
}

test('C: a pull-request merge ref', () => {
	const r = repo();
	r.commit('m0.txt', 'm0\n', 'M0 qqm0msgzz');
	r.git(['switch', '-q', '-c', 'br']);
	r.commit('b.txt', 'qqbranchzz\n', 'B1 qqbranchmsgzz');
	r.git(['switch', '-q', 'main']);
	r.commit('m.txt', 'qqmainzz\n', 'M1 qqmainmsgzz');
	r.git(['update-ref', 'refs/remotes/origin/main', 'main']);
	const base = prRef(r);
	const c = collect(r, { EVENT_NAME: 'pull_request', PR_BASE: base, REF: 'refs/pull/1/merge' });
	assert.equal(c.status, 0, c.stderr);
	assert.match(c.added, /qqbranchzz/);
	assert.match(c.added, /qqbranchmsgzz/);
	assert.doesNotMatch(c.added, /qqm0msgzz|qqmainmsgzz/);
});

test('D: a pull-request merge ref whose branch already merged main', () => {
	const r = caseA();
	const base = prRef(r);
	const c = collect(r, { EVENT_NAME: 'pull_request', PR_BASE: base, REF: 'refs/pull/1/merge' });
	assert.equal(c.status, 0, c.stderr);
	assert.match(c.added, /qqbranchzz/);
	assert.match(c.added, /qqbranchmsgzz/);
	assert.doesNotMatch(c.added, /qqm0msgzz|qqmainmsgzz/);
});
