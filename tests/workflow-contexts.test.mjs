// The two status contexts branch protection on `main` requires by name, `ci` and `leak-scan`, and the
// triggers that make them report on every pushed branch (cr-modules-001, design D-a and D-b). A renamed
// job would leave protection waiting for a context that never reports, which blocks every push to main
// until someone edits the rule — so the names are pinned here, before they can orphan a required check.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const load = (name) => yaml.load(fs.readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8'));
const ci = load('ci.yml');
const leakScan = load('leak-scan.yml');

for (const [label, wf] of [['ci.yml', ci], ['leak-scan.yml', leakScan]]) {
	test(`${label} runs on a push to every branch and on pull requests, never on tags`, () => {
		assert.deepStrictEqual(wf.on.push.branches, ['**']);
		assert.ok('pull_request' in wf.on, 'pull_request trigger missing');
		assert.equal(wf.on.push.tags, undefined, 'tags belong to release.yml');
	});
}

test("leak-scan's job reports the context 'leak-scan'", () => {
	assert.equal(leakScan.jobs.scan.name, 'leak-scan');
});

test("ci.yml has a job 'ci' that needs verify, always runs, and passes only when verify succeeded", () => {
	const job = ci.jobs.ci;
	assert.ok(job, "no job 'ci'");
	assert.equal(job.name ?? 'ci', 'ci');
	assert.deepStrictEqual([job.needs].flat(), ['verify']);
	assert.equal(job.if, 'always()');
	const run = job.steps.map((s) => s.run).filter(Boolean).join('\n');
	const go = (result) => spawnSync('bash', ['-e', '-c', run], { env: { ...process.env, VERIFY_RESULT: result }, encoding: 'utf8' });
	assert.equal(go('success').status, 0);
	for (const bad of ['failure', 'cancelled', 'skipped', '']) {
		const r = go(bad);
		assert.equal(r.status, 1, `verify result "${bad}" must fail the ci context`);
		assert.match(r.stdout, /::error::/);
	}
});
