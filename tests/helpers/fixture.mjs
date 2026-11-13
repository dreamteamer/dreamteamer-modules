// Tier-2 fixtures for the modules that run code (proofs, worktrees, http, …): a REAL workspace made by the engine's own `init`,
// with the engine and the packages under test installed the way a workspace installs them — as
// dependencies under node_modules, so discovery, the extension loader and module content all run
// exactly as they would for a stranger.
//
// The engine is this repo's devDependency (node_modules/dreamteamer), or whatever checkout
// DT_ENGINE_DIR names — set it to test against an engine that is not released yet. Every package receives the engine as `activate(dt)`, so the
// ONLY place this repo reaches into an engine by path is here, in test support.
//
// SPEED: `init` + `git init` is paid once per engine into `.tmp/base-<key>` and copied per test.
import { execFileSync } from 'node:child_process';
import { createWorkspace, run as engineRun } from 'dreamteamer/testing';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// the engine under test is the one tests/helpers/workspace.mjs resolves — DT_ENGINE_DIR (a checkout), else the
// engine `dreamteamer/testing` belongs to (the candidate, before a release) — one resolution everywhere
import { ENGINE } from './workspace.mjs';
export const ENGINE_DIR = fs.realpathSync(ENGINE);
export const BIN = path.join(ENGINE_DIR, 'bin', 'dreamteamer.js');
/** The engine's public API — what `activate(dt)` is handed in a real workspace. */
export const api = await import(pathToFileURL(path.join(ENGINE_DIR, 'src', 'api.js')).href);

/** Every spawn is bounded: a hung command fails its test instead of hanging the suite. */
export const SPAWN_TIMEOUT_MS = 60_000;
// outside the repo, so a fixture never sits inside the tree a scan walks
// realpath'd: on macOS the temp dir is reached through the /var → /private/var symlink, and a git
// worktree reports the resolved path, so an unresolved root makes every path comparison disagree
const TMP = path.join(fs.realpathSync(os.tmpdir()), 'dreamteamer-modules-tests');

export const GIT_ENV = {
	...process.env,
	GIT_AUTHOR_NAME: 'dreamteamer test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
	GIT_COMMITTER_NAME: 'dreamteamer test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

export function git(root, args) {
	return execFileSync('git', args, { cwd: root, env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

/** The folder of one module in this repo, e.g. `packageDir('proofs')`. */
export const packageDir = (name) => path.join(ROOT, 'modules', name);

function baseKey() {
	const h = createHash('sha256');
	h.update(ENGINE_DIR);
	h.update(fs.readFileSync(path.join(ENGINE_DIR, 'src', 'init.js')));
	h.update(fs.readFileSync(fileURLToPath(import.meta.url)));
	for (const f of fs.readdirSync(path.join(ENGINE_DIR, 'collections')).sort()) h.update(fs.readFileSync(path.join(ENGINE_DIR, 'collections', f)));
	return h.digest('hex').slice(0, 12);
}

function baseWorkspace() {
	fs.mkdirSync(TMP, { recursive: true });
	const holder = path.join(TMP, `base-${baseKey()}`);
	if (!fs.existsSync(path.join(holder, 'ready'))) {
		// built in a staging dir and RENAMED into place: test files run as concurrent processes
		const staging = fs.mkdtempSync(path.join(TMP, 'staging-'));
		const dir = path.join(staging, 'ws');
		// made by `dreamteamer/testing` (cr-dt-007): the engine declared as a file: dependency and linked before
		// the engine's own bootstrap, so it runs no npm and stays offline; moved here and named `ws`
		fs.renameSync(createWorkspace({ engine: ENGINE_DIR }).root, dir);
		const wsPkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
		fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ ...wsPkg, name: 'ws', version: '0.0.1' }, null, '\t') + '\n');
		git(dir, ['config', 'user.email', 'test@example.invalid']);
		git(dir, ['config', 'user.name', 'dreamteamer test']);
		git(dir, ['add', '-A']);
		if (git(dir, ['status', '--porcelain'])) git(dir, ['commit', '-qm', 'fixture: init']);
		fs.writeFileSync(path.join(staging, 'ready'), 'ok');
		try { fs.renameSync(staging, holder); } catch (e) {
			if (!['ENOTEMPTY', 'EEXIST', 'EPERM'].includes(e.code)) throw e;
			fs.rmSync(staging, { recursive: true, force: true });
		}
	}
	return path.join(holder, 'ws');
}

const created = [];
process.on('exit', () => {
	if (process.env.DT_KEEP_FIXTURES) return;
	for (const d of created) fs.rmSync(d, { recursive: true, force: true });
});

/**
 * A fresh workspace with the named packages of this repo INSTALLED (linked under
 * node_modules/@dreamteamer/<name>, and declared as dependencies — which is what activates an
 * extension and makes its content a module).
 *
 * @param {object}   opts
 * @param {string[]} [opts.packages]  e.g. ['proofs']
 * @param {object}   [opts.pkg]       keys merged into the workspace's `dreamteamer` section
 * @param {boolean}  [opts.compile]   false → leave it uncompiled
 */
export function workspace({ packages = [], pkg: extra = {}, compile = true } = {}) {
	const base = baseWorkspace();
	const root = fs.mkdtempSync(path.join(TMP, 'ws-'));
	created.push(root);
	fs.cpSync(base, root, { recursive: true, dereference: false, verbatimSymlinks: true });
	const pkgFile = path.join(root, 'package.json');
	const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
	Object.assign(pkg.dreamteamer, extra);
	for (const name of packages) {
		const at = path.join(root, 'node_modules', '@dreamteamer', name);
		fs.mkdirSync(path.dirname(at), { recursive: true });
		fs.symlinkSync(packageDir(name), at, 'dir');
		pkg.dependencies = { ...pkg.dependencies, [`@dreamteamer/${name}`]: '*' };
	}
	fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, '\t') + '\n');
	git(root, ['add', '--', 'package.json']);
	git(root, ['commit', '-qm', 'fixture: packages', '--allow-empty']);
	const handle = { root, pkg, dt: (...a) => dt(root, ...a), dtStdin: (input, ...a) => dtStdin(root, input, ...a), git: (a) => git(root, a), open: () => api.openWorkspace(root) };
	if (compile) {
		const r = handle.dt('compile');
		if (r.code !== 0) throw new Error(`fixture compile failed:\n${r.stdout}\n${r.stderr}`);
	}
	return handle;
}

/** The real CLI in a workspace. Never throws on a non-zero exit. */
export function dt(cwd, ...args) {
	const r = engineRun({ root: cwd, engine: ENGINE_DIR }, args, { timeoutMs: SPAWN_TIMEOUT_MS });
	return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** The CLI with a JSON payload on stdin — what a harness hook does. */
export function dtStdin(cwd, input, ...args) {
	const r = engineRun({ root: cwd, engine: ENGINE_DIR }, args, { input, timeoutMs: SPAWN_TIMEOUT_MS });
	return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** A file in a workspace as text, or null. */
export function readFile(root, rel) {
	try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; }
}

/** Write a module source file under the workspace module (`modules/default/<rel>`). */
export function writeSource(root, rel, text) {
	const file = path.join(root, 'modules', 'default', rel);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text);
	return file;
}

/** The CLI with extra environment variables — e.g. a PATH whose only `notebooklm` is a test stub.
 *  Bounded like every other spawn here. */
export function dtEnv(cwd, env, ...args) {
	const r = engineRun({ root: cwd, engine: ENGINE_DIR }, args, { env, timeoutMs: SPAWN_TIMEOUT_MS });
	return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/**
 * The CLI run from a DIRECTORY of the caller's choosing rather than the workspace root. `dt` finds
 * its workspace by walking UP, so anything the engine (or a package) resolves against
 * `process.cwd()` instead of the workspace root answers correctly by accident under `dt()` — this
 * is how a test catches that.
 */
export function dtIn(cwd, ...args) {
	return dt(cwd, ...args);
}

/** Write a collection descriptor into the workspace module (`modules/default/collections/`). */
export function writeCollection(root, name, descriptor) {
	const file = path.join(root, 'modules', 'default', 'collections', `${name}.collection.yaml`);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, api.dumpYaml({ name, ...descriptor }));
	return file;
}

/** A minimal valid v2 descriptor, so a test states only the part it is about. `notes` is a `body`
 *  field because compile refuses to stamp a relation mirror onto a body-less `md` collection. */
export function simpleCollection(extra = {}) {
	return {
		description: 'A test collection.',
		ids: { from: '{{ name | slug }}' },
		fields: { name: { type: 'string', required: true }, notes: { type: 'markdown', body: true } },
		...extra,
	};
}

/** The compile error for a workspace expected NOT to compile (stderr of a real `dt compile`), or null
 *  when it compiled. */
export function compileError(root) {
	const r = dt(root, 'compile');
	return r.code === 0 ? null : `${r.stderr}${r.stdout}`;
}
