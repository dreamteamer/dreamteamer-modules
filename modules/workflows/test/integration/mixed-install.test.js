// Review F3 — a LINKED engine beside an ORDINARY installed @dreamteamer/workflows. A new worktree
// mirrored only the links, so it got the engine and not the extension; the engine's install then read
// "node_modules/dreamteamer resolves" as ready, never ran npm, and compile refused the `proofs/`
// folder as an unknown kind — while `dt worktree add` exited 0 with a warning.
//
// npm runs for real and OFFLINE: the engine is a `file:` link, and workflows is installed from a
// tarball of this very package, so it lands as an ordinary directory, exactly as the registry's would.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as fixture from '../../../../test-support/fixture.mjs';

const NPM_TIMEOUT = 300_000;
const npm = (cwd, ...args) => spawnSync('npm', [...args, '--no-audit', '--no-fund', '--prefer-offline'], { cwd, encoding: 'utf8', timeout: NPM_TIMEOUT, env: fixture.GIT_ENV });
const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
const dtLong = (cwd, ...args) => {
	const r = spawnSync(process.execPath, [fixture.BIN, ...args], { cwd, encoding: 'utf8', env: fixture.GIT_ENV, timeout: NPM_TIMEOUT, killSignal: 'SIGKILL' });
	return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

let ws;
before(() => {
	ws = fixture.workspace({ compile: false });
	const vendor = path.join(ws.root, 'vendor');
	fs.mkdirSync(vendor);
	const pack = spawnSync('npm', ['pack', '--silent', '--pack-destination', vendor], { cwd: fixture.packageDir('workflows'), encoding: 'utf8', timeout: NPM_TIMEOUT });
	assert.equal(pack.status, 0, pack.stderr);
	const tgz = pack.stdout.trim().split('\n').pop();
	const pkgFile = path.join(ws.root, 'package.json');
	const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
	// the engine stays the fixture's development LINK (undeclared, as a dev shadow is) — npm's install
	// would prune it, so it is put back by hand here and must survive the child's npm on its own
	pkg.dependencies = { '@dreamteamer/workflows': `file:./vendor/${tgz}` };
	fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, '\t') + '\n');
	// the peer (`dreamteamer ^0.31.0`) is the engine checkout under test, whatever it calls itself
	fs.writeFileSync(path.join(ws.root, '.npmrc'), 'legacy-peer-deps=true\n');
	const inst = npm(ws.root, 'install');
	assert.equal(inst.status, 0, inst.stderr);
	const engineLink = path.join(ws.root, 'node_modules', 'dreamteamer');
	if (!isLink(engineLink)) { fs.rmSync(engineLink, { recursive: true, force: true }); fs.symlinkSync(fixture.ENGINE_DIR, engineLink, 'dir'); }
	assert.ok(!isLink(path.join(ws.root, 'node_modules', '@dreamteamer', 'workflows')), 'workflows must be an ORDINARY install for this test to mean anything');
	assert.ok(isLink(path.join(ws.root, 'node_modules', 'dreamteamer')), 'and the engine a link');
	// a collection, a command, a gate proof and a writes proof with its fixture — all committed
	fixture.writeCollection(ws.root, 'notes', { ...fixture.simpleCollection(), schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, status: { type: 'string' }, notes: { type: 'string', format: 'markdown', 'x-body': true } } } });
	fixture.writeSource(ws.root, 'commands/close-note.command.md', '---\nname: close-note\ndescription: close a note\n---\n\nSet its status to done.\n');
	fixture.writeSource(ws.root, 'proofs/check-clean.proof.yaml', fixture.api.dumpYaml({ name: 'check-clean', about: ['commands/close-note'], kind: 'gate', steps: [{ run: 'node node_modules/dreamteamer/bin/dreamteamer.js check' }] }));
	fixture.writeSource(ws.root, 'proofs/closes-a-note.proof.yaml', fixture.api.dumpYaml({
		name: 'closes-a-note', about: ['commands/close-note'], kind: 'live', mode: 'writes',
		given: { collection: 'notes', fixture: true, pick: 'fx-open' },
		steps: [{ run: 'node node_modules/dreamteamer/bin/dreamteamer.js set {record} status=done' }],
		expect: [{ record: '{record}', where: { status: { _eq: 'done' } } }],
	}));
	fixture.writeSource(ws.root, 'proofs/fixtures/closes-a-note/data/notes/fx-open.note.md', '---\nname: fx-open\nstatus: open\n---\n');
	ws.git(['add', '-A']);
	ws.git(['commit', '-qm', 'fixture: an ordinary workflows install beside a linked engine']);
	const c = ws.dt('compile');
	assert.equal(c.code, 0, c.stderr);
});

describe('a worktree of a workspace with a linked engine and an ORDINARY workflows install', () => {
	test('the child gets workflows, compiles the proof as a runtime kind, lists it, and re-installs clean', () => {
		const add = dtLong(ws.root, 'worktree', 'add', '--name', 'mixed', '--json');
		assert.equal(add.code, 0, add.stderr);
		const child = JSON.parse(add.stdout).path;
		assert.ok(fs.existsSync(path.join(child, 'node_modules', '@dreamteamer', 'workflows', 'package.json')), 'the ordinary workflows install never reached the worktree');
		assert.ok(isLink(path.join(child, 'node_modules', 'dreamteamer')), 'the development engine link was not kept');
		assert.equal(fs.realpathSync(path.join(child, 'node_modules', 'dreamteamer')), fs.realpathSync(fixture.ENGINE_DIR));
		assert.match(fixture.readFile(child, '.dreamteamer/manifest.yaml') ?? '', /extensions:\n {2}- name: '?@dreamteamer\/workflows/);
		assert.match(fixture.readFile(child, '.dreamteamer/collections/proofs.collection.yaml'), /base: runtime/);
		const list = fixture.dt(child, 'prove', '--list', '--json');
		assert.equal(list.code, 0, list.stderr);
		assert.deepEqual(JSON.parse(list.stdout).proofs.map((p) => p.id ?? p.name).sort(), ['check-clean', 'closes-a-note']);
		const again = dtLong(child, 'install', '--json');
		assert.equal(again.code, 0, again.stderr);
	});

	test('the writes-proof sandbox shares the same path: it installs, runs and passes', () => {
		const r = dtLong(ws.root, 'prove', 'closes-a-note', '--json');
		assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
		assert.equal(JSON.parse(r.stdout).verdict, 'PASS');
	});

	test('when the child cannot be installed, `dt worktree add` FAILS and says where the tree is', () => {
		// a declared dependency npm cannot satisfy offline — the child's install must fail, loudly
		const pkgFile = path.join(ws.root, 'package.json');
		const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
		pkg.dependencies['no-such-package'] = 'file:./vendor/no-such-package';
		fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, '\t') + '\n');
		ws.git(['add', 'package.json']); ws.git(['commit', '-qm', 'fixture: an uninstallable dependency']);
		const add = dtLong(ws.root, 'worktree', 'add', '--name', 'broken', '--json');
		assert.equal(add.code, 1, `a child whose install failed was reported as made:\n${add.stdout}`);
		assert.match(add.stderr, /the worktree was cut at .*broken, but its install exited 1/);
	});

	test('a writes proof whose sandbox cannot be installed is UNAVAILABLE and NAMES what failed — kept or not (review R6)', (t) => {
		// the previous test committed the uninstallable `no-such-package`
		const r = dtLong(ws.root, 'prove', 'closes-a-note', '--json');
		assert.equal(r.code, 3, `${r.stdout}\n${r.stderr}`);
		const row = JSON.parse(r.stdout);
		assert.equal(row.verdict ?? row.state, 'UNAVAILABLE');
		t.diagnostic(row.failure_reason);
		assert.match(row.failure_reason, /no-such-package/, 'the installer\'s diagnosis was dropped');
		assert.ok(!fs.existsSync(row.sandbox), 'the failed sandbox was left behind without --keep');
		assert.doesNotMatch(row.failure_reason, /run `?dt install`? there/, 'the reason sends the operator into a directory that was just removed');
		assert.match(row.failure_reason, /--keep/);

		const k = dtLong(ws.root, 'prove', 'closes-a-note', '--keep', '--json');
		assert.equal(k.code, 3, `${k.stdout}\n${k.stderr}`);
		const kept = JSON.parse(k.stdout);
		assert.match(kept.failure_reason, /no-such-package/);
		assert.ok(fs.existsSync(kept.sandbox), '--keep did not keep the failed sandbox');
		assert.ok(kept.failure_reason.includes(kept.sandbox), 'the kept sandbox is not named in the reason');
		fs.rmSync(path.dirname(kept.sandbox), { recursive: true, force: true });
		ws.git(['worktree', 'prune']);
	});
});
