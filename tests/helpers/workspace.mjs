// A VIRGIN WORKSPACE ON A REAL ENGINE — the instrument every behaviour test here measures with.
//
// ⚠ Carried from dreamteamer/extensions, where a fully green suite proved nothing four times running:
// a fixture and the script it exercised drifted together, so they agreed and neither matched the
// descriptors. Run the real engine instead.
//
// Two ways a module reaches a workspace, and both are tested, because they are different code paths in
// the engine and a consumer uses either:
//   npm   the module PACKED with `npm pack` (so its `files` list is what is tested — a folder left out
//         of it fails here, not in a stranger's install), unpacked under node_modules/@dreamteamer/<id>,
//         and declared as a direct dependency.
//   copy  the module folder copied into the workspace's `modules/` — an ejected or inlined copy.
//
// The engine is this repo's devDependency, or the checkout named by DT_ENGINE_DIR — set that to test
// a module against an engine that is not published yet.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
export const MODULES = path.join(ROOT, 'modules');
export const ENGINE = process.env.DT_ENGINE_DIR ? path.resolve(process.env.DT_ENGINE_DIR) : path.join(ROOT, 'node_modules', 'dreamteamer');
export const BIN = path.join(ENGINE, 'bin', 'dreamteamer.js');
export const SCOPE = '@dreamteamer';

const GIT_ENV = {
	...process.env,
	GIT_AUTHOR_NAME: 'probe', GIT_AUTHOR_EMAIL: 'probe@example.invalid',
	GIT_COMMITTER_NAME: 'probe', GIT_COMMITTER_EMAIL: 'probe@example.invalid',
};

/** Run the engine in `cwd`, with a hard timer: a hang is a failure with a message, never a stuck suite. */
export const run = (cwd, args) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: GIT_ENV, timeout: 60_000 });

export const moduleIds = () => fs.readdirSync(MODULES).filter((m) => fs.existsSync(path.join(MODULES, m, 'package.json'))).sort();
export const pkgOf = (m) => JSON.parse(fs.readFileSync(path.join(MODULES, m, 'package.json'), 'utf8'));

/** The folder a dependency lives in. The ENGINE keys a module by its full package name
 *  (`@dreamteamer/assets`) for `dependencies` and `extends`, so that is how a manifest spells one. */
export const folderOf = (dep) => dep.replace(/^@dreamteamer\//, '');

/** A module plus everything it transitively declares as a hard dependency, as folder names. */
export function closure(m, acc = new Set()) {
	if (acc.has(m)) return acc;
	acc.add(m);
	for (const d of pkgOf(m).dreamteamer.dependencies ?? []) closure(folderOf(d), acc);
	return acc;
}

const made = [];
/** Remove every temporary directory this process made. Call from an `after` hook. */
export const cleanup = () => { for (const r of made.splice(0)) fs.rmSync(r, { recursive: true, force: true }); };

/** A fresh `dreamteamer init` workspace with the three template variables declared and set. */
export function virginWorkspace() {
	assert.ok(fs.existsSync(BIN), `no engine at ${ENGINE} — run npm install, or point DT_ENGINE_DIR at a checkout`);
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-ws-')); made.push(root);
	execFileSync('git', ['init', '-q'], { cwd: root });
	fs.mkdirSync(path.join(root, 'node_modules'));
	fs.symlinkSync(ENGINE, path.join(root, 'node_modules', 'dreamteamer'), 'dir');
	fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'probe', private: true, dependencies: { dreamteamer: '*' } }, null, '\t'));
	const init = run(root, ['init', '--name', 'probe']);
	assert.equal(init.status, 0, init.stderr + init.stdout);
	editPkg(root, (pkg) => { pkg.dreamteamer.vars = ['FILES_FOLDER', 'INBOX_FOLDERS', 'REPOS_FOLDER']; });
	fs.writeFileSync(path.join(root, '.env'), `FILES_FOLDER=${root}/files\nINBOX_FOLDERS=${root}/inbox\nREPOS_FOLDER=${root}\n`);
	return root;
}

export function editPkg(root, fn) {
	const f = path.join(root, 'package.json');
	const pkg = JSON.parse(fs.readFileSync(f, 'utf8'));
	fn(pkg);
	fs.writeFileSync(f, JSON.stringify(pkg, null, '\t') + '\n');
}

const tarballs = new Map();
/** `npm pack` one module once per process; returns the tarball path. */
export function packed(m) {
	if (tarballs.has(m)) return tarballs.get(m);
	const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-pack-')); made.push(dest);
	const out = execFileSync('npm', ['pack', path.join(MODULES, m), '--pack-destination', dest, '--json', '--silent'], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
	const file = path.join(dest, JSON.parse(out)[0].filename);
	tarballs.set(m, file);
	return file;
}

/** The files a module's tarball ships, as paths relative to the package root. */
export function packedFiles(m) {
	return execFileSync('tar', ['-tzf', packed(m)], { encoding: 'utf8' }).split('\n').filter(Boolean).map((f) => f.replace(/^package\//, ''));
}

/** Install modules the npm way: unpack each tarball and declare it as a direct dependency. A
 *  module's own npm `dependencies` (express, for http) are linked from this repo's install, where npm
 *  put them — offline, and enough to prove the declared list is the whole list the code needs. */
export function installPacked(root, names) {
	for (const m of names) {
		const dir = path.join(root, 'node_modules', SCOPE, m);
		fs.mkdirSync(dir, { recursive: true });
		execFileSync('tar', ['-xzf', packed(m), '-C', dir, '--strip-components', '1']);
		linkNpmDeps(root, m);
	}
	editPkg(root, (pkg) => { for (const m of names) pkg.dependencies[`${SCOPE}/${m}`] = pkgOf(m).version; });
}

/** A module's own npm `dependencies`, linked into the workspace from this repo's install. Either
 *  channel needs them: a copy under modules/ resolves `express` from the workspace's node_modules too. */
function linkNpmDeps(root, m) {
	for (const dep of Object.keys(pkgOf(m).dependencies ?? {})) {
		const at = path.join(root, 'node_modules', dep);
		if (fs.existsSync(at)) continue;
		const from = path.join(ROOT, 'node_modules', dep);
		assert.ok(fs.existsSync(from), `${m} depends on ${dep}, which this repo's npm install does not hold — run npm install`);
		fs.mkdirSync(path.dirname(at), { recursive: true });
		fs.symlinkSync(from, at, 'dir');
	}
}

const NEVER_COPY = /node_modules|__pycache__|\.venv|\.pytest_cache/;
/** Install modules the copy way: each folder under the workspace's `modules/`. */
export function installCopied(root, names) {
	for (const m of names) {
		fs.cpSync(path.join(MODULES, m), path.join(root, 'modules', m), { recursive: true, filter: (src) => !NEVER_COPY.test(src) });
		linkNpmDeps(root, m);
	}
}

export const CHANNELS = { npm: installPacked, copy: installCopied };

/** The version of the engine under test. */
export const ENGINE_VERSION = JSON.parse(fs.readFileSync(path.join(ENGINE, 'package.json'), 'utf8')).version;

/** Does the engine under test meet a module's `dreamteamer.engine` floor (`>=x.y.z`)? */
export function engineMeets(m) {
	const floor = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(pkgOf(m).dreamteamer.engine ?? '');
	if (!floor) return true;
	const have = ENGINE_VERSION.split('.').map(Number), want = floor.slice(1).map(Number);
	for (let i = 0; i < 3; i++) if (have[i] !== want[i]) return have[i] > want[i];
	return true;
}

/** compile, then check — asserting both exit 0 and that nothing printed is an error. */
export function compileAndCheck(root) {
	const compiled = run(root, ['compile']);
	assert.equal(compiled.status, 0, `compile failed:\n${compiled.stderr}\n${compiled.stdout}`);
	const hard = compiled.stderr.split('\n').filter((l) => l.startsWith('✖') || /error/i.test(l));
	assert.deepEqual(hard, [], compiled.stderr);
	const checked = run(root, ['check']);
	assert.equal(checked.status, 0, `check failed:\n${checked.stderr}\n${checked.stdout}`);
	assert.match(checked.stdout + checked.stderr, /0 violations/);
	return { compiled, checked };
}

/** A compiled descriptor, read back from the workspace's runtime. */
export function compiledDescriptor(root, collection) {
	const f = path.join(root, '.dreamteamer', 'collections', `${collection}.collection.yaml`);
	return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}
