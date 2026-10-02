// Review F3 and R6, the proofs half — a LINKED engine beside an ORDINARY installed @dreamteamer/proofs.
// A `writes` proof runs in a throwaway checkout that has to get the proofs module too; when that
// checkout cannot be installed, the proof is UNAVAILABLE and names what failed. The worktrees half,
// and the two modules together, are tests/proofs-with-worktrees.test.mjs at the repo root.
//
// npm runs for real and OFFLINE: the engine is a `file:` link, and proofs is installed from a
// tarball of this very package, so it lands as an ordinary directory, exactly as the registry's would.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as fixture from '../../../../tests/helpers/fixture.mjs';

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
	const pack = spawnSync('npm', ['pack', '--silent', '--pack-destination', vendor], { cwd: fixture.packageDir('proofs'), encoding: 'utf8', timeout: NPM_TIMEOUT });
	assert.equal(pack.status, 0, pack.stderr);
	const tgz = pack.stdout.trim().split('\n').pop();
	const pkgFile = path.join(ws.root, 'package.json');
	const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
	// the engine stays the fixture's development LINK (undeclared, as a dev shadow is) — npm's install
	// would prune it, so it is put back by hand here and must survive the child's npm on its own
	pkg.dependencies = { '@dreamteamer/proofs': `file:./vendor/${tgz}` };
	fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, '\t') + '\n');
	// the peer (`dreamteamer ^0.31.0`) is the engine checkout under test, whatever it calls itself
	fs.writeFileSync(path.join(ws.root, '.npmrc'), 'legacy-peer-deps=true\n');
	const inst = npm(ws.root, 'install');
	assert.equal(inst.status, 0, inst.stderr);
	const engineLink = path.join(ws.root, 'node_modules', 'dreamteamer');
	if (!isLink(engineLink)) { fs.rmSync(engineLink, { recursive: true, force: true }); fs.symlinkSync(fixture.ENGINE_DIR, engineLink, 'dir'); }
	assert.ok(!isLink(path.join(ws.root, 'node_modules', '@dreamteamer', 'proofs')), 'proofs must be an ORDINARY install for this test to mean anything');
	assert.ok(isLink(path.join(ws.root, 'node_modules', 'dreamteamer')), 'and the engine a link');
	// a collection, a command, a gate proof and a writes proof with its fixture — all committed
	fixture.writeCollection(ws.root, 'notes', { ...fixture.simpleCollection(), schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, status: { type: 'string' }, notes: { type: 'string', format: 'markdown', 'x-body': true } } } });
	fixture.writeSource(ws.root, 'commands/close-note.command.md', '---\nname: close-note\ndescription: close a note\n---\n\nSet its status to done.\n');
	fixture.writeSource(ws.root, 'proofs/check-clean.proof.yaml', fixture.api.dumpYaml({ name: 'check-clean', about: ['commands/close-note'], kind: 'gate', steps: [{ run: 'node node_modules/dreamteamer/bin/dreamteamer.js check' }] }));
	fixture.writeSource(ws.root, 'proofs/closes-a-note.proof.yaml', fixture.api.dumpYaml({
		name: 'closes-a-note', about: ['commands/close-note'], kind: 'live',
		given: { collection: 'notes', fixture: true, pick: 'fx-open' },
		steps: [{ run: 'node node_modules/dreamteamer/bin/dreamteamer.js set {record} status=done' }],
		expect: [{ record: '{record}', where: { status: { _eq: 'done' } } }],
	}));
	fixture.writeSource(ws.root, 'proofs/fixtures/closes-a-note/data/notes/fx-open.note.md', '---\nname: fx-open\nstatus: open\n---\n');
	ws.git(['add', '-A']);
	ws.git(['commit', '-qm', 'fixture: an ordinary proofs install beside a linked engine']);
	const c = ws.dt('compile');
	assert.equal(c.code, 0, c.stderr);
});

describe('a writes proof in a workspace with a linked engine and an ORDINARY proofs install', () => {
	test('the writes-proof sandbox shares the same path: it installs, runs and passes', () => {
		const r = dtLong(ws.root, 'prove', 'closes-a-note', '--json');
		assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
		assert.equal(JSON.parse(r.stdout).verdict, 'PASS');
	});

	test('a writes proof whose sandbox cannot be installed is UNAVAILABLE and NAMES what failed — kept or not', (t) => {
		// a declared dependency npm cannot satisfy offline — the sandbox's install must fail, loudly
		const pkgFile = path.join(ws.root, 'package.json');
		const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
		pkg.dependencies['no-such-package'] = 'file:./vendor/no-such-package';
		fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, '\t') + '\n');
		ws.git(['add', 'package.json']); ws.git(['commit', '-qm', 'fixture: an uninstallable dependency']);
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
