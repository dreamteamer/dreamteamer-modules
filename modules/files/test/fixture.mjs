// Tier-2 fixtures for this module: a REAL workspace made by the engine's own `init`, with this module
// copied in as `modules/files` — an inline module carrying an extension entry, exactly the shape
// it has in this repo — so discovery, the extension loader and module content all run for real.
//
// The engine is this repo's installed one (node_modules/dreamteamer), or whatever checkout
// DT_ENGINE_DIR names. The module receives it as `activate(dt)`, so the ONLY place it reaches into an
// engine by path is here, in test support.
//
// SPEED: `init` + `git init` is paid once per engine into `<tmp>/base-<key>` and copied per test.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The repo root: the directory carrying package-lock.json (a module folder carries a package.json). */
const vaultRoot = () => {
	for (let d = ROOT; d !== path.dirname(d); d = path.dirname(d)) if (fs.existsSync(path.join(d, 'package-lock.json'))) return d;
	throw new Error(`no package-lock.json above ${ROOT}`);
};
export const ENGINE_DIR = fs.realpathSync(process.env.DT_ENGINE_DIR
	? path.resolve(process.env.DT_ENGINE_DIR)
	: path.join(vaultRoot(), 'node_modules', 'dreamteamer'));
export const BIN = path.join(ENGINE_DIR, 'bin', 'dreamteamer.js');
/** The engine's public API — what `activate(dt)` is handed in a real workspace. */
export const api = await import(pathToFileURL(path.join(ENGINE_DIR, 'src', 'api.js')).href);

/** Every spawn is bounded: a hung command fails its test instead of hanging the suite. */
export const SPAWN_TIMEOUT_MS = 60_000;
// outside the module, so a fixture never sits inside the folder it copies
const TMP = path.join(os.tmpdir(), 'dt-files-tests');

export const GIT_ENV = {
	...process.env,
	GIT_AUTHOR_NAME: 'dreamteamer test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
	GIT_COMMITTER_NAME: 'dreamteamer test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

export function git(root, args) {
	return execFileSync('git', args, { cwd: root, env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}


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
		fs.mkdirSync(dir);
		git(dir, ['init', '-q']);
		git(dir, ['config', 'user.email', 'test@example.invalid']);
		git(dir, ['config', 'user.name', 'dreamteamer test']);
		const r = spawnSync(process.execPath, [BIN, 'init'], { cwd: dir, env: GIT_ENV, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, killSignal: 'SIGKILL' });
		if (r.status !== 0) throw new Error(`fixture init failed:\n${r.stdout}\n${r.stderr}`);
		fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
		fs.symlinkSync(ENGINE_DIR, path.join(dir, 'node_modules', 'dreamteamer'), 'dir');
		const pkgFile = path.join(dir, 'package.json');
		const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
		pkg.dependencies = { ...pkg.dependencies, dreamteamer: '*' };
		fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, '\t') + '\n');
		git(dir, ['add', '-A']);
		git(dir, ['commit', '-qm', 'fixture: init']);
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
 * A fresh workspace, with this module copied in as `modules/files` unless `module: false`.
 *
 * @param {object}   opts
 * @param {boolean}  [opts.module]   false → the workspace without this module
 * @param {object}   [opts.pkg]      keys merged into the workspace's `dreamteamer` section
 * @param {boolean}  [opts.compile]  false → leave it uncompiled
 */
export function workspace({ module = true, pkg: extra = {}, compile = true } = {}) {
	const base = baseWorkspace();
	const root = fs.mkdtempSync(path.join(TMP, 'ws-'));
	created.push(root);
	fs.cpSync(base, root, { recursive: true, dereference: false, verbatimSymlinks: true });
	const pkgFile = path.join(root, 'package.json');
	const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
	Object.assign(pkg.dreamteamer, extra);
	if (module) {
		const at = path.join(root, 'modules', 'files');
		for (const part of ['package.json', 'src', 'collections', 'ui-views', 'skills', 'commands', 'command-bindings']) {
			if (fs.existsSync(path.join(ROOT, part))) fs.cpSync(path.join(ROOT, part), path.join(at, part), { recursive: true });
		}
	}
	fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, '\t') + '\n');
	git(root, ['add', '-A']);
	git(root, ['commit', '-qm', 'fixture: module', '--allow-empty']);
	const handle = { root, pkg, dt: (...a) => dt(root, ...a), dtStdin: (input, ...a) => dtStdin(root, input, ...a), git: (a) => git(root, a), open: () => api.openWorkspace(root) };
	if (compile) {
		const r = handle.dt('compile');
		if (r.code !== 0) throw new Error(`fixture compile failed:\n${r.stdout}\n${r.stderr}`);
	}
	return handle;
}

/** The real CLI in a workspace. Never throws on a non-zero exit. */
export function dt(cwd, ...args) {
	const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env: GIT_ENV, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, killSignal: 'SIGKILL' });
	return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** The CLI with a JSON payload on stdin — what a harness hook does. */
export function dtStdin(cwd, input, ...args) {
	const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env: GIT_ENV, encoding: 'utf8', input, timeout: SPAWN_TIMEOUT_MS, killSignal: 'SIGKILL' });
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

/** The CLI with extra environment variables — e.g. a PATH whose only copy of a binary is a test stub.
 *  Bounded like every other spawn here. */
export function dtEnv(cwd, env, ...args) {
	const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env: { ...GIT_ENV, ...env }, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, killSignal: 'SIGKILL' });
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
