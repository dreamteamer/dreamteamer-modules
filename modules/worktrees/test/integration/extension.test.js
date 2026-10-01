// tier 2: the module AS AN EXTENSION — what the engine loads, prints and compiles because the
// workspace depends on @dreamteamer/worktrees, and what it does NOT carry: proofs are a separate module.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { workspace, api } from '../helpers.mjs';

describe('the contribution, as the engine sees it', () => {
	test('dt status names the extension, and dt help carries land and worktree but not prove', () => {
		const ws = workspace();
		const status = ws.dt('status');
		assert.equal(status.code, 0, status.stderr);
		assert.match(status.stdout, /^extensions: @dreamteamer\/worktrees@0\.1\.0$/m);
		const help = ws.dt('help');
		assert.equal(help.code, 0, help.stderr);
		for (const verb of ['land <name|path>', 'worktree add --name <n>']) assert.ok(help.stdout.includes(verb), verb);
		assert.ok(!help.stdout.includes('prove <proof>'), 'prove came with worktrees');
	});

	test('install --print-adapters carries the two worktree hooks beside core\'s SessionStart', () => {
		const ws = workspace();
		const r = ws.dt('install', '--print-adapters');
		assert.equal(r.code, 0, r.stderr);
		const snippet = JSON.parse(r.stdout);
		assert.deepEqual(Object.keys(snippet.hooks).sort(), ['SessionStart', 'WorktreeCreate', 'WorktreeRemove']);
		assert.match(snippet.hooks.WorktreeCreate[0].hooks[0].command, / worktree add --hook$/);
		assert.match(snippet.hooks.WorktreeRemove[0].hooks[0].command, / worktree rm --hook$/);
	});

	test('it adds no source kind and no collection', () => {
		const ws = workspace();
		const m = api.readManifest(ws.root);
		assert.deepEqual(m['source-kinds'] ?? [], []);
		assert.ok(!api.loadDescriptors(ws.root).has('proofs'));
	});

	test('its skill reaches the harness, and the proofs skill does not', () => {
		const ws = workspace();
		assert.ok(fs.existsSync(path.join(ws.root, '.claude', 'skills', 'working-in-worktrees', 'SKILL.md')));
		assert.ok(!fs.existsSync(path.join(ws.root, '.claude', 'skills', 'proving-artifacts')));
	});
});
