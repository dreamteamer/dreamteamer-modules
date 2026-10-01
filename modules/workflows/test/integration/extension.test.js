// tier 2: the package AS AN EXTENSION — what the engine loads, prints and compiles because this
// package is a dependency of the workspace, and what every checkout derived from that workspace
// (a new worktree, a landing's throwaway copy) must load too.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { workspace, git, dt, api, writeProof } from '../helpers.mjs';

const commitAll = (root, msg) => {
	git(root, ['add', '-A']);
	git(root, ['commit', '-qm', msg, '--allow-empty']);
};

describe('the contribution, as the engine sees it', () => {
	test('dt status names the extension, and dt help carries its three verbs', () => {
		const ws = workspace();
		const status = ws.dt('status');
		assert.equal(status.code, 0, status.stderr);
		assert.match(status.stdout, /^extensions: @dreamteamer\/workflows@0\.1\.0$/m);
		const help = ws.dt('help');
		assert.equal(help.code, 0, help.stderr);
		for (const verb of ['prove <proof>', 'land <name|path>', 'worktree add --name <n>']) assert.ok(help.stdout.includes(verb), verb);
	});

	test('install --print-adapters carries the two worktree hooks beside core\'s SessionStart', () => {
		const ws = workspace();
		const r = ws.dt('install', '--print-adapters');
		assert.equal(r.code, 0, r.stderr);
		const snippet = JSON.parse(r.stdout);
		assert.deepEqual(Object.keys(snippet.hooks).sort(), ['SessionStart', 'WorktreeCreate', 'WorktreeRemove']);
		assert.match(snippet.hooks.WorktreeCreate[0].hooks[0].command, / worktree add --hook$/);
		assert.match(snippet.hooks.WorktreeRemove[0].hooks[0].command, / land --hook --dry-run$/);
	});

	test('the manifest records the proofs kind with its excluded fixtures subtree', () => {
		const ws = workspace();
		const m = api.readManifest(ws.root);
		assert.deepEqual(m['source-kinds'], [{ kind: 'proofs', exclude: ['fixtures'], extension: '@dreamteamer/workflows' }]);
		assert.ok(api.loadDescriptors(ws.root).has('proofs'), 'the proofs collection travelled in the content module');
	});

	// the package is ALSO a content module: its collection and its two skills compile into the harness
	test('the two skills reach the harness', () => {
		const ws = workspace();
		for (const skill of ['proving-artifacts', 'working-in-worktrees']) {
			assert.ok(fs.existsSync(path.join(ws.root, '.claude', 'skills', skill, 'SKILL.md')), skill);
		}
	});
});

// ⚠ A DERIVED CHECKOUT MUST LOAD THE SAME EXTENSIONS. A workspace holding `proofs/` compiles only
// while something installed contributes that kind — so a worktree or a landing copy that compiled
// with the engine alone (a raw { root, pkg }, or a node_modules missing this package) would reject
// the folder as unknown and fail, or silently compile a different workspace.
describe('derived checkouts load the same extensions', () => {
	const withProof = () => {
		const ws = workspace();
		writeProof(ws.root, 'skill-loads');
		assert.equal(ws.dt('compile').code, 0);
		commitAll(ws.root, 'a proof, and the compiled harness files');
		return ws;
	};

	test('a new worktree mirrors the linked package and compiles the proofs kind', () => {
		const ws = withProof();
		const r = ws.dt('worktree', 'add', '--name', 'x');
		assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
		const dir = r.stdout.trim().split('\n').at(-1);
		const link = path.join(dir, 'node_modules', '@dreamteamer', 'workflows');
		assert.ok(fs.lstatSync(link).isSymbolicLink(), 'the extension was not mirrored into the new tree');
		assert.ok(fs.existsSync(path.join(dir, '.dreamteamer', 'proofs', 'skill-loads.proof.yaml')), 'the worktree compiled without the proofs kind');
		const status = dt(dir, 'status');
		assert.match(status.stdout, /^extensions: @dreamteamer\/workflows@/m);
	});

	test('a landing in a workspace holding proofs/ compiles its copy WITH the extension', () => {
		const ws = withProof();
		assert.equal(ws.dt('worktree', 'add', '--name', 'x').code, 0);
		const wt = path.join(ws.root, '.worktrees', 'x');
		// a second proof in the worktree: the copy's compile has to stage it, and check has to read it
		writeProof(wt, 'second-proof');
		assert.equal(dt(wt, 'compile').code, 0);
		commitAll(wt, 'a second proof');

		const r = ws.land('x');
		assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
		assert.ok(fs.existsSync(path.join(ws.root, '.dreamteamer', 'proofs', 'second-proof.proof.yaml')), 'the primary did not compile the landed proof');
		const proved = ws.dt('prove', 'second-proof');
		assert.equal(proved.code, 0, proved.stdout + proved.stderr);
	});
});
