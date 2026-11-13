// Provider-side setup helpers: workspace identity, file fingerprints, confined atomic writes, a
// span-preserving `.env` edit, a Git exposure check and redaction. Each module that ships setup
// actions carries its own byte-identical copy (tests/setup-kit-copies.test.mjs), because a module
// never imports another module's code. Nothing here reaches the network or reads a secret's value;
// the only process it starts is read-only Git, from `gitExposure`, which inspect never calls.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

/** The private provider convention version these helpers implement. Not an engine API. */
export const SETUP_PROTOCOL = 1;

/** Statuses a check reports. `skipped` is never computed: it is a person's decision in the conversation. */
export const STATUSES = ['ready', 'configured', 'unverified', 'missing', 'blocked'];

/** The board state of a check in an optional capability: present facts are ok, everything else warns. */
export const boardState = (status) => (status === 'ready' || status === 'configured' ? 'ok' : 'warn');

export class SetupRefusal extends Error {
	constructor(code, message) { super(message); this.code = code; }
}

/** The workspace an action is scoped to, by real path and package name. */
export function workspaceIdentity(root) {
	const real = fs.realpathSync(root);
	let name = null;
	try { name = JSON.parse(fs.readFileSync(path.join(real, 'package.json'), 'utf8')).name ?? null; } catch { /* unnamed */ }
	return { root: real, name };
}

/** Is `child` the same as, or inside, `parent`? Both must already be real, absolute paths. */
export function within(parent, child) {
	const rel = path.relative(parent, child);
	return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** The real path of `p`, or of its nearest existing ancestor joined with the missing remainder. */
export function realish(p) {
	const missing = [];
	for (let d = path.resolve(p); ; d = path.dirname(d)) {
		try { return path.join(fs.realpathSync(d), ...missing.reverse()); }
		catch (error) {
			if (error.code !== 'ENOENT' || path.dirname(d) === d) throw error;
			missing.push(path.basename(d));
		}
	}
}

/** Resolve `rel` inside the workspace, refusing an escape or any symlinked component below the root. */
export function confine(root, rel) {
	const real = fs.realpathSync(root);
	if (typeof rel !== 'string' || !rel || path.isAbsolute(rel)) throw new SetupRefusal('path', 'Only a workspace-relative path can be written.');
	const target = path.resolve(real, rel);
	if (!within(real, target) || target === real) throw new SetupRefusal('path', 'The path leaves the workspace.');
	let at = real;
	for (const part of path.relative(real, target).split(path.sep)) {
		at = path.join(at, part);
		let st;
		try { st = fs.lstatSync(at); } catch (error) { if (error.code === 'ENOENT') break; throw error; }
		if (st.isSymbolicLink()) throw new SetupRefusal('symlink', 'A symlinked path is never written; replace the link with a regular file first.');
	}
	return target;
}

/** `sha256:<hex>` of a regular file, `absent` when there is none. A symlink or non-file is refused. */
export function fingerprint(file) {
	let st;
	try { st = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return 'absent'; throw error; }
	if (st.isSymbolicLink()) throw new SetupRefusal('symlink', 'A symlinked file is never fingerprinted for writing.');
	if (!st.isFile()) throw new SetupRefusal('not-file', 'The target is not a regular file.');
	return `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

/** The temporary files `writeScoped` makes for `target` while it writes. An interrupted process (a
 *  kill, a power cut) can leave one behind; callers treat any as a reason to stop and ask. */
export const tempPrefix = (target) => { const base = path.basename(target); return `${base.startsWith('.') ? '' : '.'}${base}.setup-`; };
export function leftoverTemps(target) {
	try { return fs.readdirSync(path.dirname(target)).filter((f) => f.startsWith(tempPrefix(target)) && f.endsWith('.tmp')); }
	catch { return []; }
}

/** Write `content` to workspace-relative `rel` by rename, only while it still has fingerprint `expected`.
 *
 *  What this guarantees: the file is replaced whole or not at all; a change made before the last check
 *  (an edit after the preview, a change seen by `recheck`) stops the write with nothing replaced; and
 *  the temporary file is removed on every failure this process survives — a failed write, fsync,
 *  recheck or rename.
 *  What it does NOT guarantee: the last check and the rename are two system calls, not a
 *  compare-and-swap, so another process writing in the instant between them can still be overwritten,
 *  and a process killed outright can leave its temporary file (`leftoverTemps`). Plain files have no
 *  cross-process lock that every editor honours; this is optimistic concurrency, kept as short as it can be.
 *  An existing file keeps its permission bits; a new one is created owner-only. */
export function writeScoped({ root, rel, content, expected, recheck = () => {} }) {
	const target = confine(root, rel);
	const stale = () => new SetupRefusal('stale', 'The file changed after the preview. Nothing was written; inspect and plan again.');
	if (fingerprint(target) !== expected) throw stale();
	let mode = 0o600;
	try { mode = fs.statSync(target).mode & 0o777; } catch { /* new file */ }
	const temp = path.join(path.dirname(target), `${tempPrefix(target)}${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
	const fd = fs.openSync(temp, 'wx', mode);
	try {
		try {
			fs.writeFileSync(fd, content);
			fs.fsyncSync(fd);
		} finally { fs.closeSync(fd); }
		recheck();
		confine(root, rel);
		if (fingerprint(target) !== expected) throw stale();
		fs.renameSync(temp, target);
	} catch (error) {
		fs.rmSync(temp, { force: true });
		throw error;
	}
	return fingerprint(target);
}

// ── is a workspace file kept out of Git? ──────────────────────────────────────────────────────────
// Read-only Git, scoped to the workspace: no optional locks (no index refresh), no fsmonitor hook, and
// an environment carrying no GIT_* variable that could point it at another repository or config.
const GIT_ENV_KEYS = ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'SYSTEMROOT', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'XDG_CONFIG_HOME'];
export function runGit(root, args) {
	const env = { GIT_TERMINAL_PROMPT: '0' };
	for (const k of GIT_ENV_KEYS) if (process.env[k] !== undefined) env[k] = process.env[k];
	const r = spawnSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', root, ...args], { env, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
	return { status: r.error ? null : r.status, stderr: r.stderr ?? '' };
}

/** Could workspace-relative `rel` end up in a commit? `{ safe, vcs, reason }`, failing closed.
 *
 *  In a Git repository Git itself decides: the file must not be tracked and `git check-ignore` must
 *  report it ignored, which covers wildcard negation, nested and global excludes. Outside any
 *  repository nothing can be committed today, but a later `git init` could; the policy there is
 *  static and conservative: the root `.gitignore` must ignore the file by name and contain no negation
 *  (`!`) line at all. If Git cannot be run, the static policy applies only when no `.git` exists at or
 *  above the workspace. */
export function gitExposure(root, rel, { git = runGit } = {}) {
	const top = git(root, ['rev-parse', '--show-toplevel']);
	const notRepo = top.status === 128 && /not a git repository/i.test(top.stderr);
	if (top.status === 0) {
		const tracked = git(root, ['ls-files', '--error-unmatch', '--', rel]).status;
		if (tracked === 0) return { safe: false, vcs: 'git', reason: `${rel} is tracked by Git, so its contents would be committed; untrack it (git rm --cached ${rel}) and ignore it first.` };
		if (tracked !== 1) return { safe: false, vcs: 'git', reason: `Git could not say whether ${rel} is tracked; nothing was changed.` };
		const ignored = git(root, ['check-ignore', '-q', '--', rel]).status;
		if (ignored === 0) return { safe: true, vcs: 'git' };
		if (ignored === 1) return { safe: false, vcs: 'git', reason: `Git does not ignore ${rel} here (check .gitignore, including negated patterns); ignore it first.` };
		return { safe: false, vcs: 'git', reason: `Git could not say whether ${rel} is ignored; nothing was changed.` };
	}
	if (!notRepo) {
		if (top.status !== null) return { safe: false, vcs: 'unknown', reason: 'Git could not inspect this workspace; nothing was changed.' };
		for (let d = fs.realpathSync(root); ; d = path.dirname(d)) {
			if (fs.existsSync(path.join(d, '.git'))) return { safe: false, vcs: 'unknown', reason: 'A Git repository is present but Git cannot be run to check it; nothing was changed.' };
			if (path.dirname(d) === d) break;
		}
	}
	let lines = [];
	try { lines = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim()); } catch { /* none */ }
	const named = [rel, `/${rel}`];
	if (lines.some((l) => named.includes(l)) && !lines.some((l) => l.startsWith('!'))) return { safe: true, vcs: 'none' };
	return { safe: false, vcs: 'none', reason: `This workspace is not a Git repository; before ${rel} is written, the root .gitignore must name it on a line of its own (${rel}) and hold no negation (!) line, so a later git init cannot commit it.` };
}

/** Remove what a diagnostic must never carry: addresses, absolute paths and long token-like strings. */
export function redact(text) {
	return String(text ?? '')
		.replace(/[^\s@"'<>()]+@[^\s@"'<>()]+\.[A-Za-z]{2,}/g, '<email>')
		.replace(/(^|[\s"'=(:])(?:~|[A-Za-z]:)?[\\/][^\s"')]+/g, '$1<path>')
		.replace(/[A-Za-z0-9_\-.]{32,}/g, '<redacted>');
}

// ── .env ─────────────────────────────────────────────────────────────────────────────────────────
// The same assignment shape the setup board reads: KEY=value, KEY="multi-line value" or KEY='value'.
const ASSIGNMENT = /^[ \t]*([A-Z_][A-Z0-9_]*)[ \t]*=[ \t]*(?:"([^"]*)"|'([^']*)'|([^\r\n]*))/gm;

/** Every assignment of `key` in `.env` text, with its exact span and parsed value. */
export function envAssignments(text, key) {
	const out = [];
	for (const m of String(text).matchAll(ASSIGNMENT)) {
		if (m[1] !== key) continue;
		const value = (m[2] ?? m[3] ?? m[4].replace(/\s+#.*$/, '')).trim();
		out.push({ start: m.index, end: m.index + m[0].length, value });
	}
	return out;
}

/** A value that can be written double-quoted without any `.env` reader expanding or ending it early. */
export function safeEnvValue(value) {
	return typeof value === 'string' && !/["\\$`\r\0]/.test(value);
}

/** `.env` text with `key` set to `value`, every other byte unchanged. Refuses a key assigned twice. */
export function setEnvValue(text, key, value) {
	if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new SetupRefusal('input', 'Invalid configuration key.');
	if (!safeEnvValue(value)) throw new SetupRefusal('input', 'The value contains a quote, backslash, dollar sign, backtick or control character.');
	const line = `${key}="${value}"`;
	const found = envAssignments(text, key);
	if (found.length > 1) throw new SetupRefusal('conflict', `${key} is assigned more than once in .env; resolve that by hand first.`);
	if (found.length === 1) return text.slice(0, found[0].start) + line + text.slice(found[0].end);
	return `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
}
