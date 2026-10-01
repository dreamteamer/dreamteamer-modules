// Small pure helpers every verb in this package shares: a git runner, path probes, and the one
// strict flag parser. Kept local on purpose — each is a few lines, and none is an engine concept.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

/** `git <args>` in `cwd`, trimmed stdout. On failure GIT'S REASON LEADS the message: execFileSync
 *  puts `Command failed: git <argv>` first, and every summary here reads the first line. */
export const defaultGit = (args, cwd) => {
	try {
		return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
	} catch (e) {
		const why = String(e.stderr ?? '').trim().split('\n').filter(Boolean);
		if (why.length) e.message = [...why, `(git ${args.join(' ')})`].join('\n  ');
		throw e;
	}
};

/** Git answers paths as REALPATHS (macOS /var → /private/var), so both sides of a comparison are
 *  spelled that way. A path that cannot be resolved keeps the spelling it came with. */
export const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
/** Present means it RESOLVES — a dangling link is absent. */
export const resolves = (p) => fs.existsSync(p);
/** A symlink that resolves. */
export const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink() && fs.existsSync(p); } catch { return false; } };

/** Root-relative paths out of a path-producing git call. `-C <root>` (and `--no-relative` at the
 *  call site) because `diff.relative=true` in a user's gitconfig answers relative to the CWD. */
export const gitLines = (git, root, args) => git(['-C', root, ...args], root).split('\n').filter(Boolean);
/** The same for a `-z` command — NUL-separated and UNQUOTED, so a path with an accent, a space or a
 *  quote reads the same out of every command. */
export const gitZ = (git, root, args) => git(['-C', root, ...args], root).split('\0').filter(Boolean);

/**
 * Parse `argv` against a CLOSED vocabulary: `bool` flags take no value, `value` flags take exactly
 * one (`--x v` or `--x=v`). Anything else is REFUSED, every unknown flag named at once — a flag accepted and dropped is a silent wrong
 * answer (`--tmep` would turn a throwaway sandbox into a permanent branch worktree).
 *
 * @returns {{ flags: Record<string, true|string>, pos: string[] }}
 */
export function parseFlags(argv, { bool = [], value = [] }, form) {
	const flags = {};
	const pos = [];
	const all = [...bool, ...value];
	const unknown = argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')[0]).filter((n) => !all.includes(n));
	if (unknown.length) {
		const hint = unknown.length === 1 ? nearest(unknown[0], all) : null;
		throw new Error(`${unknown.map((n) => `--${n}`).join(' ')} ${unknown.length > 1 ? 'are not flags' : 'is not a flag'} of \`${form}\` — that form takes ${all.map((f) => `--${f}`).join(' ') || 'no flags'}${hint ? ` (did you mean --${hint}?)` : ''}`);
	}
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) { pos.push(a); continue; }
		const eq = a.indexOf('=');
		const name = eq > -1 ? a.slice(2, eq) : a.slice(2);
		if (name in flags) throw new Error(`--${name} was given twice on \`${form}\` and takes ONE value`);
		if (bool.includes(name)) {
			if (eq > -1) throw new Error(`--${name} takes no value on \`${form}\``);
			flags[name] = true;
			continue;
		}
		const v = eq > -1 ? a.slice(eq + 1) : argv[++i];
		if (v === undefined || v === '' || v.startsWith('--')) throw new Error(`--${name} takes a value on \`${form}\``);
		flags[name] = v;
	}
	return { flags, pos };
}

/** The known flag within edit distance 2 of a typo, or null — `--tmep` → `temp`. */
function nearest(word, candidates) {
	let best = null; let bestD = 3;
	for (const c of candidates) {
		const d = Array.from({ length: word.length + 1 }, (_, i) => [i, ...Array(c.length).fill(0)]);
		for (let j = 1; j <= c.length; j++) d[0][j] = j;
		for (let i = 1; i <= word.length; i++) for (let j = 1; j <= c.length; j++) {
			d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (word[i - 1] === c[j - 1] ? 0 : 1));
			if (i > 1 && j > 1 && word[i - 1] === c[j - 2] && word[i - 2] === c[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
		}
		if (d[word.length][c.length] < bestD) { bestD = d[word.length][c.length]; best = c; }
	}
	return best;
}

/** Run `fn` with console.log pointed at stderr — how a `--json` form keeps stdout for ONE object
 *  while compile, check and git reporting still reach a human. */
export async function logToStderr(on, fn) {
	if (!on) return fn();
	const log = console.log;
	console.log = console.error;
	try { return await fn(); } finally { console.log = log; }
}
