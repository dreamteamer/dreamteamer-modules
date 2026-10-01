// `dt worktree` — linked checkouts of this workspace, as an OBSERVED entity.
//
// There is no `worktrees` collection and no record. `git worktree list` is the authority, and a
// stored copy of it could only ever drift — a worktree removed by hand, a branch deleted, a
// directory moved. So every row is DERIVED: git's porcelain plus two cheap reads per row (the dirty
// records under the data path, and whether a manifest is there).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dt } from './engine.js';
import { defaultGit, real, resolves, isLink, parseFlags } from './git.js';

/** How long the `dt install` inside a new tree may take — it can run `npm ci`. */
const INSTALL_TIMEOUT_MS = 10 * 60_000;

/** Every checkout of this repo, primary first, as git reports it.
 *
 *  ⚠ `ahead` IS NULL FOR A DETACHED WORKTREE, not 0 — there is no branch to count against, and
 *  `--detach` is ordinary (every --temp sandbox is detached). `dirtyRecords` is scoped to the DATA
 *  path: uncommitted records are the thing the primary cannot see and cannot recover. */
export function listWorktrees(ws, git = defaultGit) {
	const c = dt.describeCheckout(ws.root, git);
	const primaryBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], c.primary);
	const dataPath = ws.pkg.dreamteamer?.['data-path'] ?? 'data';
	const rows = [];
	let cur = null;
	for (const line of git(['worktree', 'list', '--porcelain'], c.primary).split('\n')) {
		if (line.startsWith('worktree ')) { cur = { path: line.slice(9), branch: null, head: null }; rows.push(cur); }
		else if (line.startsWith('HEAD ')) cur.head = line.slice(5, 12);
		else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
	}
	return rows.map((w) => {
		const primary = real(w.path) === real(c.primary);
		// ⚠ THE NAME IS WHAT WAS TYPED, not the directory it landed in — `--path` lets the two differ,
		// so it is recovered from the `worktree-<name>` branch this verb creates. A worktree on someone
		// else's branch, or a detached one, has nothing but its basename.
		const name = !primary && w.branch?.startsWith('worktree-') ? w.branch.slice('worktree-'.length) : path.basename(w.path);
		let ahead = null;
		if (w.branch && !primary) {
			try { ahead = Number(git(['rev-list', '--count', `${primaryBranch}..${w.branch}`], c.primary)); } catch { ahead = null; }
		}
		let dirtyRecords = 0;
		try { dirtyRecords = git(['status', '--porcelain', '--', dataPath], w.path).split('\n').filter(Boolean).length; } catch { /* a moved or deleted directory */ }
		return {
			name, path: w.path, branch: w.branch, head: w.head, primary, ahead, dirtyRecords,
			bootstrapped: resolves(path.join(w.path, '.dreamteamer', 'manifest.yaml')),
		};
	});
}

/** A worktree by name or by path — the name is what an operator types, the path is what a creation
 *  hook echoes. The PATH is tried first, since it is unique by construction and a name is not.
 *
 *  ⚠ AN AMBIGUOUS NAME IS REFUSED, never resolved to whichever row git listed first: two --temp
 *  sandboxes may share a name, and a removal landing on the wrong one takes work with it. */
export function findWorktree(ws, ref, git = defaultGit) {
	if (!ref) return null;
	const rows = listWorktrees(ws, git);
	const byPath = rows.find((w) => real(w.path) === real(path.resolve(ws.root, ref)));
	if (byPath) return byPath;
	const byName = rows.filter((w) => w.name === ref);
	if (byName.length > 1) throw new Error(`"${ref}" names ${byName.length} worktrees — address one by path:\n  ${byName.map((w) => w.path).join('\n  ')}`);
	return byName[0] ?? null;
}

/**
 * Make the new tree load the SAME engine and the SAME extensions as this one.
 *
 * Every DIRECT dependency that is a SYMLINK here (a dev shadow, `npm link`, a test fixture) is
 * mirrored as the same link — never the node_modules directory itself, which is a real folder
 * holding them. A real install is left to `dt install` in the new tree. Then the same for a
 * shadowing `git_modules/<name>` link: without it the copy falls back to the pinned engine and
 * compiles against a different compiler. LINKS ONLY — a real clone is per-checkout working state.
 */
export function mirrorLinkedDeps(fromRoot, pkg, toRoot) {
	const deps = new Set(['dreamteamer', ...Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies })]);
	for (const dep of deps) {
		const from = path.join(fromRoot, 'node_modules', dep);
		const to = path.join(toRoot, 'node_modules', dep);
		if (!isLink(from) || fs.existsSync(to)) continue;
		fs.mkdirSync(path.dirname(to), { recursive: true });
		fs.symlinkSync(fs.realpathSync(from), to, 'dir');
	}
	const shadows = path.join(fromRoot, 'git_modules');
	for (const name of (fs.existsSync(shadows) ? fs.readdirSync(shadows) : [])) {
		const from = path.join(shadows, name);
		const to = path.join(toRoot, 'git_modules', name);
		if (!isLink(from) || fs.existsSync(to)) continue;
		fs.mkdirSync(path.dirname(to), { recursive: true });
		fs.symlinkSync(fs.realpathSync(from), to, 'dir');
	}
}

/**
 * The worktree, MADE, and its path returned — everything `addWorktree` does except printing it.
 * `dt prove` cuts its `writes` sandbox with it (`temp: true, quiet: true`).
 *
 * ⚠ `quiet` is not cosmetic: the install inside inherits stdio, and a caller printing one JSON
 * object on stdout would have a compile transcript spliced in ahead of it.
 */
export function createWorktree(ws, { name, dir, base = 'HEAD', temp = false, quiet = false }, git = defaultGit) {
	if (!name) throw new Error('dt worktree add needs --name <name>');
	const c = dt.describeCheckout(ws.root, git);
	// a --temp sandbox MAY reuse a name — its random holder keeps the paths apart, and the ambiguous
	// name is refused at the READ instead (findWorktree)
	if (!temp && findWorktree(ws, name, git)) throw new Error(`worktree "${name}" already exists — dt worktree get ${name}`);
	if (!temp && git(['branch', '--list', `worktree-${name}`], c.primary)) {
		throw new Error(`branch worktree-${name} already exists — pick another name or delete the branch`);
	}
	// ⚠ --temp LIVES INSIDE THE PRIMARY ROOT: `.worktrees/.tmp-<rand>/<name>`. `.env` is linked only
	// under the primary root, and an os.tmpdir() sandbox compares unequal to its own `git worktree
	// list` row on macOS (/var vs /private/var). And --path beside --temp names a directory that
	// would silently not be the one made, so the pair is refused.
	if (temp && dir) throw new Error('--temp places the sandbox itself (.worktrees/.tmp-<rand>/<name>) — pass either --temp or --path <dir>, not both');
	const holder = path.join(c.primary, '.worktrees');
	if (temp) fs.mkdirSync(holder, { recursive: true });
	// ⚠ NEVER pre-create `target` — `git worktree add` creates it, and an empty pre-created folder is
	// swept by compile's empty-directory pass.
	const sandbox = temp ? fs.mkdtempSync(path.join(holder, '.tmp-')) : null;
	const target = sandbox ? path.join(sandbox, name) : path.resolve(ws.root, dir ?? path.join(holder, name));
	try {
		git(temp ? ['worktree', 'add', '--detach', target, base] : ['worktree', 'add', '-b', `worktree-${name}`, target, base], c.primary);
	} catch (e) {
		if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true }); // a bad --base leaves nothing behind
		throw e;
	}
	mirrorLinkedDeps(ws.root, ws.pkg, target);
	// the RUNNING engine makes the new tree ready — never whatever it would resolve itself
	// (dependencies it does NOT find mirrored — an ordinary installed package — the engine's install
	// restores with npm, keeping the mirrored development links)
	const r = spawnSync(process.execPath, [dt.engineBin, 'install'], { cwd: target, stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8', timeout: INSTALL_TIMEOUT_MS, killSignal: 'SIGKILL' });
	if (r.status !== 0) {
		// ⚠ A FAILURE, NOT A WARNING. The tree exists but cannot run what the primary runs — an
		// extension missing there makes its compile refuse the extension's own folders — and a green
		// exit sent the caller into it anyway (review F3).
		const diagnosis = quiet ? installDiagnosis(`${r.stdout ?? ''}\n${r.stderr ?? ''}`) : [];
		const e = new Error([`the worktree was cut at ${target}, but its install exited ${r.status ?? r.signal} — fix what it names, then run \`dt install\` there`, ...diagnosis].join('\n  '));
		Object.assign(e, { worktree: target, installExit: r.status ?? r.signal, diagnosis });
		throw e;
	}
	return target;
}

/** What a failed `dt install` said that NAMES the failure: its ✖ lines and npm's error lines, in
 *  order, bounded — the board around them is noise to someone reading one reason string. Falls back to
 *  the last lines when neither form appears. */
export function installDiagnosis(output, { lines = 12, width = 300 } = {}) {
	const all = String(output).split('\n').map((l) => l.trimEnd()).filter(Boolean);
	// npm follows a usage error with its whole help text — every line of it `npm error …`
	let usage = false;
	const named = all.filter((l) => {
		if (/^npm (error|ERR!) (Usage:|Clean install)/.test(l)) usage = true;
		else if (!/^npm /.test(l)) usage = false;
		return /^\s*✖/.test(l) || (!usage && /^npm (error|ERR!) \S/.test(l));
	});
	return [...new Set(named.length ? named : all.slice(-6))].slice(0, lines).map((l) => (l.length > width ? `${l.slice(0, width)}…` : l));
}

/** `dt worktree add`. Contract: the PATH is the LAST line (a creation hook echoes it), code 0.
 *  Under `--json` stdout carries ONE object and nothing else. */
export function addWorktree(ws, opts, git = defaultGit) {
	const json = !!opts.json;
	const target = createWorktree(ws, { ...opts, quiet: json }, git);
	(json ? dt.emit(JSON.stringify({ path: target })) : console.log(target));
	return 0;
}

/** ⚠ IT REFUSES BY DEFAULT, AND NAMES WHY. A worktree holds two things the primary cannot see:
 *  records written but not committed, and commits not yet landed. `git worktree remove` checks a
 *  dirty tree and stops there — the records are exactly what a bare remove would take with it. */
export function removeWorktree(ws, ref, { force = false } = {}, git = defaultGit) {
	const w = findWorktree(ws, ref, git);
	if (!w) throw new Error(`no worktree "${ref}" — dt worktree list`);
	if (w.primary) throw new Error('refusing to remove the primary checkout');
	const c = dt.describeCheckout(ws.root, git);
	const primaryBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], c.primary);
	// ⚠ A DETACHED HEAD'S WORK IS HELD BY NOTHING BUT THE HEAD ABOUT TO BE DELETED — so the measure
	// is "reachable from no ref at all" (`--branches --tags --remotes`; `--all` would count this very
	// worktree's HEAD and answer 0). And it FAILS CLOSED: an empty or non-numeric answer is a
	// refusal, never "nothing ahead" (`Number('')` is 0).
	let ahead = w.ahead;
	let unmeasured = null;
	const orphaned = w.ahead === null && !w.primary && w.head;
	if (orphaned) {
		try {
			const out = String(git(['rev-list', '--count', w.head, '--not', '--branches', '--tags', '--remotes'], c.primary) ?? '').trim();
			if (/^\d+$/.test(out)) ahead = Number(out);
			else unmeasured = out ? `git rev-list answered "${out}", which is not a count` : 'git rev-list answered nothing';
		} catch (e) { unmeasured = String(e.message ?? e).split('\n')[0]; }
	}
	if (!force) {
		if (unmeasured) {
			throw new Error(`refusing to remove worktree "${w.name}": whether its commits are reachable from anything else could not be measured — ${unmeasured}\n  ${w.head} is held by nothing but this worktree unless a ref names it: git branch <name> ${w.head} to keep it, or --force to remove without the check`);
		}
		// the directory can be gone while git still lists it — nothing to lose, and reading its dirty
		// state in a missing cwd would die as a message about the wrong thing
		if (!resolves(w.path)) throw new Error(`worktree "${w.name}" is registered but its directory is gone (${w.path}) — nothing to lose: dt worktree rm ${w.name} --force drops the registration`);
		const dirty = git(['status', '--porcelain'], w.path).split('\n').filter(Boolean).length;
		const why = [];
		if (w.dirtyRecords) why.push(`${w.dirtyRecords} dirty record(s) — dt commit them, or --force to discard`);
		else if (dirty) why.push(`${dirty} uncommitted change(s) — commit or --force`);
		if (ahead && orphaned) why.push(`${ahead} commit(s) reachable from NOTHING but this worktree — git branch <name> ${w.head} to keep them, or --force to discard`);
		else if (ahead) why.push(`${ahead} commit(s) not on ${primaryBranch} — dt land ${w.name}, or --force to discard`);
		if (why.length) throw new Error(`refusing to remove worktree "${w.name}":\n  ${why.join('\n  ')}`);
	}
	git(['worktree', 'remove', ...(force ? ['--force'] : []), w.path], c.primary);
	// only a branch this verb CREATED goes with the worktree; any other is kept and SAID to be kept,
	// because once the worktree is gone `list` can no longer show it
	if (w.branch === `worktree-${w.name}`) {
		try { git(['branch', force ? '-D' : '-d', w.branch], c.primary); } catch { console.warn(`⚠ branch ${w.branch} kept (not merged)`); }
	} else if (w.branch) {
		console.log(`  branch ${w.branch} kept — it is not the worktree-${w.name} this verb creates`);
	}
	// a sandbox lives alone in its `.tmp-<rand>` holder, and `.worktrees/` is ignored — an empty
	// holder left behind would accumulate unseen
	const holder = path.dirname(w.path);
	if (path.basename(holder).startsWith('.tmp-') && real(path.dirname(holder)) === real(path.join(c.primary, '.worktrees'))) {
		try { fs.rmdirSync(holder); } catch { /* not empty — something else is in there */ }
	}
	console.log(`✔ removed worktree ${w.name}`);
	return 0;
}

export const WORKTREE_USAGE = `  worktree add --name <n> [--path <dir>] [--base <ref>] [--temp] [--json]
              cut a linked git worktree on branch worktree-<n> and \`dt install\` it; its absolute
              path is the LAST line printed (what a creation hook echoes). --temp: detached, no
              branch, under .worktrees/.tmp-*/<n> inside this root — a sandbox for a caller that
              removes it
  worktree add --hook [--json]
              take the name from a WorktreeCreate payload on stdin; placed at .worktrees/<n>
  worktree list [--json] · worktree get <name|path> [--json]
              observed from \`git worktree list\`, never stored: branch, head, commits ahead of the
              primary branch, dirty records, installed or not
  worktree rm <name|path> [--force]
              refuses a worktree holding dirty records or commits nothing else holds`;

/** `dt worktree <sub> …` — the surface. Returns the exit code; a refusal throws. */
export function worktreeCommand(ws, argv) {
	const [sub, ...rest] = argv;
	switch (sub) {
		case 'list': {
			const { flags, pos } = parseFlags(rest, { bool: ['json'] }, 'dt worktree list');
			if (pos.length) throw new Error(`dt worktree list takes no target — got "${pos[0]}"`);
			const rows = listWorktrees(ws);
			if (flags.json) { dt.emit(JSON.stringify(rows, null, 2)); return 0; }
			for (const w of rows) {
				console.log(`${w.primary ? '●' : '○'} ${w.name.padEnd(24)} ${(w.branch ?? '(detached)').padEnd(28)} ${w.head}  ahead ${w.ahead ?? '—'}  dirty records ${w.dirtyRecords}  ${w.bootstrapped ? 'installed' : 'NOT installed'}  ${w.path}`);
			}
			return 0;
		}
		case 'get': {
			const { flags, pos } = parseFlags(rest, { bool: ['json'] }, 'dt worktree get');
			if (pos.length !== 1) throw new Error('dt worktree get <name|path> [--json]');
			const w = findWorktree(ws, pos[0]);
			if (!w) throw new Error(`no worktree "${pos[0]}" — dt worktree list`);
			console.log(flags.json ? JSON.stringify(w, null, 2) : Object.entries(w).map(([k, v]) => `${k}: ${v}`).join('\n'));
			return 0;
		}
		case 'add': {
			// ⚠ `--hook` IS A FORM, so it refuses the other form's vocabulary: `--hook --temp` would cut
			// a PERMANENT branch worktree and `--hook --base x` would cut from HEAD, both at exit 0.
			if (rest.includes('--hook')) {
				const { pos } = parseFlags(rest, { bool: ['hook', 'json'] }, 'dt worktree add --hook');
				if (pos.length) throw new Error(`--hook reads the worktree name from stdin — drop "${pos[0]}"`);
				const input = dt.readHookInput(dt.readStdin());
				if (!input.name) throw new Error(`hook input carries no worktree_name — keys received: ${Object.keys(input.raw).join(', ')}`);
				// ⚠ `.worktrees/`, never `.claude/worktrees/`: every workspace `init` writes ignores it,
				// while anything under `.claude` sits inside compile's empty-directory sweep
				return addWorktree(ws, { name: input.name, dir: path.join('.worktrees', input.name), json: rest.includes('--json') });
			}
			const { flags, pos } = parseFlags(rest, { bool: ['temp', 'json'], value: ['name', 'path', 'base'] }, 'dt worktree add');
			if (pos.length) throw new Error(`dt worktree add takes --name <n>, not a positional ("${pos[0]}")`);
			return addWorktree(ws, { name: flags.name, dir: flags.path, base: flags.base, temp: !!flags.temp, json: !!flags.json });
		}
		case 'rm': {
			const { flags, pos } = parseFlags(rest, { bool: ['force'] }, 'dt worktree rm');
			if (pos.length !== 1) throw new Error('dt worktree rm <name|path> [--force]');
			return removeWorktree(ws, pos[0], { force: !!flags.force });
		}
		default:
			throw new Error(`dt worktree ${sub ? `"${sub}" is not a subcommand` : 'needs a subcommand'} — add · list · get · rm\n${WORKTREE_USAGE}`);
	}
}
