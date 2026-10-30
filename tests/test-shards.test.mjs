// THE SHARDS COVER THE SUITE — every test file runs in exactly one CI shard, and a release runs the
// repo-wide checks plus its own module. A file that no shard picks is green in every job and tested
// nowhere, so this is the one place a faster CI could quietly become a smaller one.
import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { ROOT, collect, forModule, needsBrowser, shard } from '../scripts/test-files.mjs';

const all = collect();
const ci = yaml.load(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'));
const job = ci.jobs.verify;
const shards = job.strategy.matrix.shard;
const testStep = job.steps.find((s) => s.name === 'tests');

function assertPartition(n) {
	const seen = new Map();
	for (let i = 1; i <= n; i++) {
		const files = shard(all, i, n);
		assert.ok(files.length > 0, `shard ${i}/${n} is empty — the runner refuses an empty selection, so that job would fail`);
		for (const f of files) {
			assert.ok(!seen.has(f), `${f} is in shard ${seen.get(f)}/${n} AND ${i}/${n}`);
			seen.set(f, i);
		}
	}
	const missed = all.filter((f) => !seen.has(f));
	assert.deepEqual(missed, [], `no shard of ${n} runs these files`);
	assert.equal(seen.size, all.length);
}

test('the collector finds the suite — a partition of nothing would pass vacuously', () => {
	assert.ok(all.length > 100, `only ${all.length} test files collected`);
	assert.ok(all.includes('tests/test-shards.test.mjs'), 'the collector does not see this very file');
});

test('ci.yml shards the run as 1..N, and the test step passes the same N', () => {
	assert.ok(Array.isArray(shards) && shards.length > 0, 'the verify matrix declares no shard list');
	assert.deepEqual(shards, shards.map((_, i) => i + 1), 'a shard index missing from the matrix is a slice of the suite no job runs');
	assert.ok(testStep, 'no step named "tests" in ci.yml');
	const m = /--shard=\$\{\{\s*matrix\.shard\s*\}\}\/(\d+)/.exec(testStep.run);
	assert.ok(m, `the tests step must run --shard=\${{ matrix.shard }}/N, got: ${testStep.run}`);
	assert.equal(Number(m[1]), shards.length, 'the N in --shard must equal the number of shards in the matrix');
});

test('the shards ci.yml declares cover every test file exactly once', () => {
	assertPartition(shards.length);
});

test('any shard count from 1 to 8 is still a partition', () => {
	for (let n = 1; n <= 8; n++) assertPartition(n);
});

test('the runner CLI agrees with the partition', () => {
	const n = shards.length;
	const union = [];
	for (let i = 1; i <= n; i++) {
		const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'test.mjs'), `--shard=${i}/${n}`, '--list'], { cwd: ROOT, encoding: 'utf8' });
		assert.equal(r.status, 0, r.stderr);
		union.push(...r.stdout.trim().split('\n'));
	}
	assert.deepEqual(union.sort(), all);
});

test('every browser file lands in one shard, and only that shard installs Chromium', () => {
	const browser = all.filter((f) => needsBrowser(f));
	assert.ok(browser.length > 0, 'no browser files found — the heuristic is broken, and the Chromium step would never run');
	assert.deepEqual(browser.filter((f) => !f.startsWith('modules/rnd/')), [], 'only rnd drives a browser today — a repo-wide file here would install Chromium in every release job');
	const n = shards.length;
	const holding = [];
	for (let i = 1; i <= n; i++) if (shard(all, i, n).some((f) => browser.includes(f))) holding.push(i);
	assert.equal(holding.length, 1, `browser files are spread over shards ${holding.join(', ')}`);
	const chromium = job.steps.find((s) => /chromium/i.test(s.name ?? ''));
	assert.ok(chromium, 'no Chromium step in ci.yml');
	assert.match(chromium.if ?? '', /needs-browser|browser/, 'the Chromium step must be gated on the shard needing it');
});

test('a module release runs every repo-wide check and its whole module suite, nothing of the others', () => {
	const ids = fs.readdirSync(path.join(ROOT, 'modules')).filter((d) => fs.existsSync(path.join(ROOT, 'modules', d, 'package.json')));
	const shared = all.filter((f) => f.startsWith('tests/'));
	assert.ok(shared.includes('tests/compiles-alone.test.mjs') && shared.includes('tests/structure.test.mjs') && shared.includes('tests/leak-gate.test.mjs'));
	for (const id of ids) {
		const sel = forModule(all, id);
		for (const f of shared) assert.ok(sel.includes(f), `${id}'s release skips ${f}`);
		for (const f of all.filter((f) => f.startsWith(`modules/${id}/`))) assert.ok(sel.includes(f), `${id}'s release skips its own ${f}`);
		assert.deepEqual(sel.filter((f) => !f.startsWith('tests/') && !f.startsWith(`modules/${id}/`)), []);
	}
	const release = yaml.load(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8'));
	const tests = release.jobs.publish.steps.find((s) => s.name === 'tests');
	assert.match(tests.run, /--module=\$\{\{\s*steps\.mod\.outputs\.id\s*\}\}/, 'the release must test the module its tag names');
});
