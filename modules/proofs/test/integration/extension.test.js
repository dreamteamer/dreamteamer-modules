// tier 2: the module AS AN EXTENSION — what the engine loads, prints and compiles because the
// workspace depends on @dreamteamer/proofs, and what it does NOT carry: the worktree verbs and hooks
// belong to @dreamteamer/worktrees, a separate module.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { workspace, api } from '../helpers.mjs';

describe('the contribution, as the engine sees it', () => {
	test('dt status names the extension, and dt help carries prove and nothing of worktrees', () => {
		const ws = workspace();
		const status = ws.dt('status');
		assert.equal(status.code, 0, status.stderr);
		assert.match(status.stdout, /^extensions: @dreamteamer\/proofs@0\.1\.0$/m);
		const help = ws.dt('help');
		assert.equal(help.code, 0, help.stderr);
		assert.ok(help.stdout.includes('prove <proof>'), 'prove usage missing');
		for (const verb of ['land <name|path>', 'worktree add --name <n>']) assert.ok(!help.stdout.includes(verb), `${verb} came with proofs`);
	});

	test('install --print-adapters carries no worktree hook', () => {
		const ws = workspace();
		const r = ws.dt('install', '--print-adapters');
		assert.equal(r.code, 0, r.stderr);
		assert.deepEqual(Object.keys(JSON.parse(r.stdout).hooks).sort(), ['SessionStart']);
	});

	test('the manifest records the proofs kind with its excluded fixtures subtree', () => {
		const ws = workspace();
		const m = api.readManifest(ws.root);
		assert.deepEqual(m['source-kinds'], [{ kind: 'proofs', exclude: ['fixtures'], extension: '@dreamteamer/proofs' }]);
		assert.ok(api.loadDescriptors(ws.root).has('proofs'), 'the proofs collection travelled in the content module');
	});

	test('its skill reaches the harness, and the worktrees skill does not', () => {
		const ws = workspace();
		assert.ok(fs.existsSync(path.join(ws.root, '.claude', 'skills', 'proving-artifacts', 'SKILL.md')));
		assert.ok(!fs.existsSync(path.join(ws.root, '.claude', 'skills', 'working-in-worktrees')));
	});
});
