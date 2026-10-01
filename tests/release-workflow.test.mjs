// The release workflow's publish step. Two lines were copied from the engine's copy and both turned
// out wrong for a package cut from a private vault: `--access public` (decided per repo, as a
// variable) and `--provenance` (npm refuses it for a private source repo with E422 — measured
// 2026-09-09 on the first tag, after every other gate had passed). This pins the shape so a future
// "align with the engine" edit fails here, by name, before it fails on a tag.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const wf = yaml.load(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8'));
const steps = wf.jobs.publish.steps;
const publish = steps.find((s) => s.name === 'publish');

test('the workflow is tag-only', () => {
	assert.deepEqual(wf.on, { push: { tags: ['v*'] } });
});

test('the access level is a repo variable, gated before anything publishes', () => {
	const gate = steps.find((s) => /access decision/.test(s.name ?? ''));
	assert.ok(gate, 'no access-decision gate step');
	assert.ok(steps.indexOf(gate) < steps.indexOf(publish));
	assert.match(JSON.stringify(publish), /vars\.NPM_ACCESS/);
	assert.doesNotMatch(publish.run, /--access\s+public\b/, 'the access level is never hardcoded');
});

test('provenance is conditional on the source repo being public — npm refuses it for a private one (E422)', () => {
	assert.match(JSON.stringify(publish.env ?? {}), /github\.event\.repository\.private/, 'the step must read the visibility GitHub reports');
	const lines = publish.run.split('\n');
	const withProv = lines.filter((l) => /npm publish/.test(l) && /--provenance/.test(l));
	const without = lines.filter((l) => /npm publish/.test(l) && !/--provenance/.test(l));
	assert.equal(withProv.length, 1, 'exactly one publish line carries --provenance (the public-repo branch)');
	assert.equal(without.length, 1, 'exactly one publish line omits it (the private-repo branch)');
	assert.match(publish.run, /if \[ "\$REPO_PRIVATE" = "false" \]/, 'the branch is on the repo being NOT private');
});

test('the gates run before publish: tag==version, tests, smoke', () => {
	const names = steps.map((s) => s.name ?? s.run ?? '');
	const i = (re) => names.findIndex((n) => re.test(n));
	for (const re of [/tag must match/, /^tests$/, /smoke/]) assert.ok(i(re) >= 0 && i(re) < names.indexOf('publish'), `${re} must precede publish`);
});

// ── the leak gate on the publish path (added 2026-09-10) ────────────────────────────────────────
// `leak-scan.yml` triggers on push-to-main and pull_request; a TAG matches neither, so the release
// path scanned nothing at all, and the scan that did run on main only ever saw ADDED lines. That is
// the gate against the incident that already shipped a private vault name in three npm tarballs.
// These pin the gate's three load-bearing properties: it exists, it runs before anything publishes,
// and it FAILS CLOSED on a missing secret — because on a release a skipped gate looks like a pass.
const leakGate = steps.find((s) => /leak gate/.test(s.name ?? ''));
const ancestry = steps.find((s) => /point at a commit/.test(s.name ?? ''));

test('a leak gate exists on the release path and precedes every step that publishes', () => {
	assert.ok(leakGate, 'no leak-gate step in release.yml — a tag would publish an unscanned tree');
	assert.ok(ancestry, 'no ancestry gate — a tag on an arbitrary commit publishes a tree CI never saw');
	// Judged by what a step RUNS, never by its name: the gate's own name contains "published".
	const publishing = steps.filter((s) => /npm publish|vsce publish|ovsx publish|gh release/.test(s.run ?? ''));
	assert.ok(publishing.length >= 1, 'no publishing step found — this test would pass vacuously');
	for (const p of publishing) {
		assert.ok(steps.indexOf(leakGate) < steps.indexOf(p), `the leak gate must precede "${p.name}"`);
		assert.ok(steps.indexOf(ancestry) < steps.indexOf(p), `the ancestry gate must precede "${p.name}"`);
	}
});

test('the leak gate FAILS CLOSED on an unset secret, unlike its main-branch sibling', () => {
	assert.match(JSON.stringify(leakGate.env ?? {}), /secrets\.LEAK_NAMES/, 'the gate must read the secret');
	assert.match(leakGate.run, /-z "\$\{LEAK_NAMES:-\}"/, 'it must test the secret for emptiness');
	const guard = leakGate.run.slice(leakGate.run.indexOf('-z "${LEAK_NAMES:-}"'));
	assert.match(guard.split('fi')[0], /exit 1/, 'an unset secret must EXIT 1, never warn and continue');
	assert.doesNotMatch(guard.split('fi')[0], /::warning::/, 'a warning is what made the main-branch check a silent no-op');
});

test('the gate scans the whole tree, honours .leak-scan-allow, and never prints content', () => {
	assert.match(leakGate.run, /git grep -I -l/, 'it must enumerate TEXT files — a binary blob decodes to anything');
	assert.match(leakGate.run, /\.leak-scan-allow/, 'the Hebrew rule must honour the per-file allow-list this repo commits');
	assert.match(leakGate.run, /perl -CSD/, 'Hebrew needs perl -CSD; grep -P silently never fires under BSD grep');
	assert.match(leakGate.run, /pass vacuously/, 'an empty file list must fail rather than pass');
	// Paths are printed to help the author; the matched LINES never are, because the log is readable.
	assert.doesNotMatch(leakGate.run, /grep -[a-zA-Z]*n[a-zA-Z]* "\$LEAK_NAMES"/, 'never print matching lines');
});

test('the checkout is deep enough for the ancestry gate to answer', () => {
	assert.equal(steps[0].with?.['fetch-depth'], 0, 'a shallow tip cannot be tested for ancestry of main');
});
