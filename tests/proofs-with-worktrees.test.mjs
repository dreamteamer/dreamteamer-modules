// PROOFS AND WORKTREES, INSTALLED TOGETHER — two separate modules that must still agree.
//
// Neither imports the other. What they share is a promise to the operator: a checkout derived from a
// workspace (a new worktree, a landing's throwaway copy, a proof's sandbox) loads the SAME engine and
// the SAME modules as the tree it came from. A workspace holding `proofs/` compiles only while the
// proofs module is installed, so a worktree that arrived without it would reject the folder as an
// unknown kind. Carried from the tools repo's extension and mixed-install tests (reviews F3, R6),
// where both verbs lived in one package.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as fixture from './helpers/fixture.mjs';

const NPM_TIMEOUT = 300_000;
const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
const dtLong = (cwd, ...args) => {
	const r = spawnSync(process.execPath, [fixture.BIN, ...args], { cwd, encoding: 'utf8', env: fixture.GIT_ENV, timeout: NPM_TIMEOUT, killSignal: 'SIGKILL' });
	return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};
const commitAll = (root, msg) => { fixture.git(root, ['add', '-A']); fixture.git(root, ['commit', '-qm', msg, '--allow-empty']); };
const writeProof = (root, id) => fixture.writeSource(root, `proofs/${id}.proof.yaml`,
	fixture.api.dumpYaml({ name: id, about: ['skills/proving-artifacts'], kind: 'gate', steps: [{ run: 'true' }] }));

describe('LINKED: both modules linked in, the way a developer works', () => {
	const withProof = () => {
		const ws = fixture.workspace({ packages: ['proofs', 'worktrees'] });
		writeProof(ws.root, 'skill-loads');
		assert.equal(ws.dt('compile').code, 0);
		commitAll(ws.root, 'a proof, and the compiled harness files');
		return ws;
	};

	test('dt status lists both, and each brings its own verbs', () => {
		const ws = fixture.workspace({ packages: ['proofs', 'worktrees'] });
		assert.match(ws.dt('status').stdout, /^extensions: @dreamteamer\/proofs@0\.1\.0 · @dreamteamer\/worktrees@0\.1\.0$/m);
		const help = ws.dt('help').stdout;
		for (const verb of ['prove <proof>', 'land <name|path>', 'worktree add --name <n>']) assert.ok(help.includes(verb), verb);
	});

	test('a new worktree mirrors both modules and compiles the proofs kind', () => {
		const ws = withProof();
		const r = ws.dt('worktree', 'add', '--name', 'x');
		assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
		const dir = r.stdout.trim().split('\n').at(-1);
		for (const m of ['proofs', 'worktrees']) assert.ok(isLink(path.join(dir, 'node_modules', '@dreamteamer', m)), `${m} was not mirrored into the new tree`);
		assert.ok(fs.existsSync(path.join(dir, '.dreamteamer', 'proofs', 'skill-loads.proof.yaml')), 'the worktree compiled without the proofs kind');
	});

	test('a landing in a workspace holding proofs/ compiles its copy WITH the proofs module', () => {
		const ws = withProof();
		assert.equal(ws.dt('worktree', 'add', '--name', 'x').code, 0);
		const wt = path.join(ws.root, '.worktrees', 'x');
		writeProof(wt, 'second-proof');
		assert.equal(fixture.dt(wt, 'compile').code, 0);
		commitAll(wt, 'a second proof');
		const r = ws.dt('land', 'x');
		assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
		assert.ok(fs.existsSync(path.join(ws.root, '.dreamteamer', 'proofs', 'second-proof.proof.yaml')), 'the primary did not compile the landed proof');
		const proved = ws.dt('prove', 'second-proof');
		assert.equal(proved.code, 0, proved.stdout + proved.stderr);
	});
});

// Review F3 — a LINKED engine beside ORDINARY installs of both modules. A new worktree mirrored only
// the links, so it got the engine and not the modules; compile then refused `proofs/` as an unknown
// kind while `dt worktree add` exited 0. npm runs for real and OFFLINE, from tarballs of these modules.
describe('ORDINARY: both modules installed by npm from their tarballs, beside a linked engine', () => {
	let ws;
	before(() => {
		ws = fixture.workspace({ compile: false });
		const vendor = path.join(ws.root, 'vendor');
		fs.mkdirSync(vendor);
		const deps = {};
		for (const m of ['proofs', 'worktrees']) {
			const pack = spawnSync('npm', ['pack', '--silent', '--pack-destination', vendor], { cwd: fixture.packageDir(m), encoding: 'utf8', timeout: NPM_TIMEOUT });
			assert.equal(pack.status, 0, pack.stderr);
			deps[`@dreamteamer/${m}`] = `file:./vendor/${pack.stdout.trim().split('\n').pop()}`;
		}
		const pkgFile = path.join(ws.root, 'package.json');
		const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
		pkg.dependencies = deps;
		fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, '\t') + '\n');
		const inst = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--prefer-offline'], { cwd: ws.root, encoding: 'utf8', timeout: NPM_TIMEOUT, env: fixture.GIT_ENV });
		assert.equal(inst.status, 0, inst.stderr);
		const engineLink = path.join(ws.root, 'node_modules', 'dreamteamer');
		if (!isLink(engineLink)) { fs.rmSync(engineLink, { recursive: true, force: true }); fs.symlinkSync(fixture.ENGINE_DIR, engineLink, 'dir'); }
		for (const m of ['proofs', 'worktrees']) assert.ok(!isLink(path.join(ws.root, 'node_modules', '@dreamteamer', m)), `${m} must be an ORDINARY install for this test to mean anything`);
		writeProof(ws.root, 'check-clean');
		ws.git(['add', '-A']);
		ws.git(['commit', '-qm', 'fixture: ordinary installs beside a linked engine']);
		const c = ws.dt('compile');
		assert.equal(c.code, 0, c.stderr);
	});

	test('the child gets both modules, keeps the engine link, compiles the proof and lists it', () => {
		const add = dtLong(ws.root, 'worktree', 'add', '--name', 'mixed', '--json');
		assert.equal(add.code, 0, add.stderr);
		const child = JSON.parse(add.stdout).path;
		for (const m of ['proofs', 'worktrees']) assert.ok(fs.existsSync(path.join(child, 'node_modules', '@dreamteamer', m, 'package.json')), `${m} never reached the worktree`);
		assert.equal(fs.realpathSync(path.join(child, 'node_modules', 'dreamteamer')), fs.realpathSync(fixture.ENGINE_DIR));
		assert.match(fixture.readFile(child, '.dreamteamer/collections/proofs.collection.yaml'), /base: runtime/);
		const list = fixture.dt(child, 'prove', '--list', '--json');
		assert.equal(list.code, 0, list.stderr);
		assert.deepEqual(JSON.parse(list.stdout).proofs.map((p) => p.id ?? p.name), ['check-clean']);
	});

	test('when the child cannot be installed, `dt worktree add` FAILS and says where the tree is', () => {
		const pkgFile = path.join(ws.root, 'package.json');
		const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
		pkg.dependencies['no-such-package'] = 'file:./vendor/no-such-package';
		fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, '\t') + '\n');
		ws.git(['add', 'package.json']); ws.git(['commit', '-qm', 'fixture: an uninstallable dependency']);
		const add = dtLong(ws.root, 'worktree', 'add', '--name', 'broken', '--json');
		assert.equal(add.code, 1, `a child whose install failed was reported as made:\n${add.stdout}`);
		assert.match(add.stderr, /the worktree was cut at .*broken, but its install exited 1/);
	});
});
