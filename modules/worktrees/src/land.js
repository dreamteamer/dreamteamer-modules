// `dt land` — landing a linked worktree's commits onto the primary branch.
//
// The PURE half first — which collection a conflicted path belongs to, and what the landing would
// do — each a function over data so it can be asserted without a disk. The git work, the lock and
// the printing live below.
//
// EVERY CONFLICT STOPS THE LANDING. The harness files compile writes at the root (CLAUDE.md,
// AGENTS.md, …) are gitignored build output, so a rebase never meets one; what it does meet is a
// record, a source or a hand-written file two sessions both changed — a disagreement no policy can
// settle. So the rebase aborts, the paths are named by collection, and both trees stay
// byte-identical.
//
// Union merge is deliberately ABSENT: an "append-only" log is corrected in place in practice, and a
// union driver runs once per replayed commit, so two branches each appending keep both copies.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dt } from './engine.js';
import { defaultGit, gitLines, gitZ, parseFlags, logToStderr } from './git.js';
import { findWorktree, removeWorktree } from './worktrees.js';

/** The advisory mutex, a directory under the repo's common dir — every worktree of a repo contends
 *  for one lock, whichever of them `dt land` was run from. */
export const LAND_LOCK = 'dreamteamer-land.lock';

/**
 * Conflicted paths grouped by the collection you know them as. A path under the data path
 * no collection claims groups under `data (no collection)`; anything else under `other files`. The
 * LONGEST `storage.path` wins, so `data/hr` cannot swallow `data/hr/people`. Runtime collections are
 * skipped: `.dreamteamer/` is build output, never a record.
 */
export function groupByCollection(paths, descriptors, dataPath = 'data') {
	const bases = [];
	for (const d of descriptors.values()) {
		const { path: p, runtime } = dt.storageOf(d);
		if (!p || runtime || !(p + '/').startsWith(dataPath + '/')) continue;
		bases.push({ name: d.name, prefix: p + '/' });
	}
	bases.sort((a, b) => b.prefix.length - a.prefix.length);
	const groups = new Map();
	for (const p of paths) {
		const hit = bases.find((b) => p.startsWith(b.prefix));
		const key = hit ? hit.name : (p.startsWith(dataPath + '/') ? 'data (no collection)' : 'other files');
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(p);
	}
	return groups;
}

const age = (s) => (s < 90 ? `${s}s` : `${Math.round(s / 60)}m`);

/**
 * The landing as DATA: everything refused, and — only if nothing is — every step that would run.
 * `--dry-run` prints this object and the runner executes it, so what is shown is what happens.
 * EVERY refusal is reported, not just the first: two problems are one fix list, not two runs.
 */
export function planLand(state) {
	const { name, worktree, branch, primaryBranch, upstream, dirtyPrimaryTouched: touched, range, lock } = state;
	const refusals = [];
	if (worktree.kind === 'primary') refusals.push('it is the primary checkout');
	if (state.detached) refusals.push(`it is DETACHED (no branch) — inside it: git switch -c worktree-${name}, or dt land ${name} --branch ${name} to do that first`);
	if (state.dirtyRecords) refusals.push(`${state.dirtyRecords} dirty record(s) — dt commit them first`);
	if (state.uncommitted) refusals.push(`${state.uncommitted} uncommitted change(s) — commit or discard them first`);
	// a pushed branch is REFUSED rather than rewritten: rebase rewrites hashes someone may have fetched
	if (upstream) refusals.push(`branch ${branch} has an upstream (${upstream}) — a pushed branch is not rebased; land it by hand`);
	// a fast-forward plus a compile in the primary would sweep another session's uncommitted records
	// into this landing's subject, invisibly
	if (state.pendingPrimary) refusals.push(`the primary has ${state.pendingPrimary} pending record write(s) — dt commit them first (a landing would sweep them into someone else's subject)`);
	if (touched.length) refusals.push(`the primary has uncommitted changes to ${touched.length} file(s) this branch also touches: ${touched.slice(0, 5).join(', ')}${touched.length > 5 ? ', …' : ''}`);
	if (lock.held) refusals.push(`another land holds the lock (pid ${lock.pid}, ${age(lock.age_s)}) — wait, or remove ${lock.path} if that process is gone`);
	if (!range.commits) refusals.push(`nothing to land — ${branch ?? '(detached)'} is already on ${primaryBranch}`);
	if (refusals.length) return { refusals, steps: [] };

	const steps = [
		{ id: 'lock', why: `take ${lock.path} — ${LAND_LOCK} serialises every land in this repo, whichever worktree it was run from` },
		{ id: 'copy', why: `create land/${name} from ${branch} — the original branch keeps its hashes until the fast-forward succeeds` },
		{ id: 'rebase', why: `rebase land/${name} onto ${primaryBranch} — ${range.commits} commit(s) replayed, GIT_EDITOR=true` },
	];
	// Unconditional: `.dreamteamer/` is gitignored, so the copy has no runtime and `check` would
	// answer "no compiled runtime" for every landing.
	steps.push({ id: 'recompile-copy', why: `recompile on the copy's tip, with this workspace's extensions — .dreamteamer/ is gitignored, so the copy has no runtime for check to read` });
	steps.push({ id: 'check', why: 'dt check on the copy — a failure stops here, and says the branch is rebased but NOT landed' });
	steps.push({ id: 'ff', why: `git merge --ff-only land/${name} in the primary — ${primaryBranch} moves` });
	if (range.files.includes('package-lock.json')) steps.push({ id: 'npm-ci', why: 'package-lock.json is in the range — npm ci in the primary before it compiles against the new engine' });
	steps.push({ id: 'recompile-primary', why: 'compile the primary — its runtime is per checkout and is now behind its tree' });
	// `-D`, not `-d`: the rebase rewrote the branch's hashes, so git's merged-ness test answers no
	if (!state.keep) steps.push({ id: 'retire', why: `git worktree remove ${worktree.root} and git branch -D ${branch}` });
	return { refusals, steps };
}

// ---- the runner ------------------------------------------------------------------------------
//
// OBSERVE (never mutating), REFUSE (never mutating), then LOCK → COPY → REBASE → CHECK → FF →
// RETIRE, with the copy and the throwaway worktree removed on every exit path. Nothing writes into
// your worktree until the fast-forward has already succeeded.

/** How many times the primary may move under us before we stop trying. */
const FF_ATTEMPTS = 3;
/** Every raw git spawn in the runner is bounded. */
const GIT_TIMEOUT_MS = 5 * 60_000;
const NPM_TIMEOUT_MS = 10 * 60_000;
const spawnGit = (args, env) => spawnSync('git', args, { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, killSignal: 'SIGKILL', ...(env ? { env } : {}) });

/** `git status --porcelain -z` paths. A rename is two records in the `-z` format — the source
 *  follows in its own record and is consumed rather than read as a status line. */
const statusPaths = (git, root) => {
	const parts = gitZ(git, root, ['status', '--porcelain', '-z']);
	const paths = [];
	for (let i = 0; i < parts.length; i++) {
		const xy = parts[i].slice(0, 2);
		paths.push(parts[i].slice(3));
		if (xy.includes('R') || xy.includes('C')) i++;
	}
	return paths;
};

/** Is that pid a process we could signal? EPERM means it exists and is someone else's — alive. */
const alive = (pid) => {
	if (!pid) return false;
	try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

/** The lock as data: whether a LIVE process holds it, and for how long. A dead pid reads as free. */
function readLock(lockPath) {
	const state = { held: false, pid: null, age_s: 0, path: lockPath };
	let st;
	try { st = fs.statSync(lockPath); } catch { return state; }
	try { state.pid = Number(String(fs.readFileSync(path.join(lockPath, 'pid'), 'utf8')).trim()) || null; } catch { /* half-made */ }
	state.age_s = Math.max(0, Math.round((Date.now() - st.mtimeMs) / 1000));
	state.held = alive(state.pid);
	return state;
}

/** Take it, or say who has it. `mkdir` is the mutex (atomic everywhere this runs). A dead holder is
 *  reclaimed OUT LOUD — a lock that silently reclaims itself is a lock nobody can trust. */
function takeLock(lock, log = console.log) {
	try {
		fs.mkdirSync(lock.path);
	} catch (e) {
		if (e.code !== 'EEXIST') throw e;
		const now = readLock(lock.path);
		if (now.held) return { refused: `another land holds the lock (pid ${now.pid}, ${age(now.age_s)}) — wait, or remove ${now.path} if that process is gone` };
		log(`  reclaimed ${now.path} — pid ${now.pid ?? '(none)'} is gone`);
		fs.rmSync(lock.path, { recursive: true, force: true });
		fs.mkdirSync(lock.path);
	}
	fs.writeFileSync(path.join(lock.path, 'pid'), String(process.pid));
	return { refused: null };
}

/** The branch's upstream, or null (git exits non-zero for none). */
function upstreamOf(git, primary, branch) {
	try { return git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`], primary) || null; } catch { return null; }
}

/** The state a landing is planned from. Every field is READ — nothing here writes. */
export function observeLand(ws, ref, { keep = false, assumeBranch = null } = {}, git = defaultGit) {
	const c = dt.describeCheckout(ws.root, git);
	const w = findWorktree(ws, ref, git);
	if (!w) throw new Error(`no worktree "${ref}" — dt worktree list`);
	const primaryBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], c.primary);
	// `assumeBranch` is `--dry-run --branch <n>` asking what would happen AFTER a switch it does not
	// make — the range is measured from the worktree's own HEAD, which is what that branch would be
	const branch = w.primary ? null : (w.branch ?? (assumeBranch ? `worktree-${assumeBranch}` : null));
	const rev = w.primary ? null : (w.branch ?? (branch ? w.head : null));
	const range = { commits: 0, files: [] };
	if (rev) {
		range.commits = Number(gitLines(git, c.primary, ['rev-list', '--count', `${primaryBranch}..${rev}`])[0] ?? 0);
		// `...`: what THIS branch added — a file the primary changed underneath it is not landing
		range.files = gitZ(git, c.primary, ['diff', '--name-only', '-z', '--no-relative', `${primaryBranch}...${rev}`]);
	}
	const dirty = w.primary ? [] : statusPaths(git, w.path);
	// The primary's pending writes are read from the store, not from git status — a landing
	// fast-forwards and compiles there, and an uncommitted record would ride into this subject
	const primaryWs = dt.findWorkspace(c.primary);
	const pending = dt.commitPending(new dt.Store(primaryWs), { dryRun: true });
	const primaryDirty = statusPaths(git, c.primary);
	return {
		name: w.name,
		worktree: { kind: w.primary ? 'primary' : 'linked', root: w.path },
		branch,
		primaryBranch,
		detached: !w.primary && !branch,
		upstream: branch ? upstreamOf(git, c.primary, branch) : null,
		dirtyRecords: w.dirtyRecords,
		uncommitted: Math.max(0, dirty.length - w.dirtyRecords),
		pendingPrimary: pending.reduce((n, r) => n + r.rows.length, 0),
		dirtyPrimaryTouched: range.files.filter((f) => primaryDirty.includes(f)),
		range,
		lock: readLock(path.join(c.commonDir, LAND_LOCK)),
		keep,
	};
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What the range holds, by collection — the conflict report's grouping, counted. */
const recordsIn = (range, descriptors, dataPath) => {
	const groups = groupByCollection(range.files.filter((f) => f.startsWith(dataPath + '/')), descriptors, dataPath);
	return new Map([...groups].map(([k, v]) => [k, v.length]));
};

const summarize = (range, records) =>
	`${plural(range.commits, 'commit')} · ${plural([...records.values()].reduce((a, b) => a + b, 0), 'record file')} in ${plural(records.size, 'collection')}`;

/** Print a refusal on stderr. */
function printRefusal(name, reasons) {
	const block = `✖ cannot land ${name}:\n${reasons.map((r) => `  ${r}`).join('\n')}`;
	console.error(block);
}

/**
 * `dt land <name|path>` — the whole verb, returning `{ code, landed, refused, kept }` so `--json`
 * reports the object that was printed. `kept` is measured on disk after the work — true for
 * every refusal and conflict, after `--keep`, and when the tree changed during the landing; false
 * only when the landing retired it.
 */
export async function landWorktree(ws, ref, { keep = false, dryRun = false, branch = null, npmRun } = {}, git = defaultGit) {
	const c = dt.describeCheckout(ws.root, git);
	// `--branch` names the worktree, it does not choose a branch: `worktree-<name>` is the one
	// spelling every reader keys on, so any other value is refused. It is a mutation, so `--dry-run`
	// reports it as the plan's first line instead of performing it.
	const target = findWorktree(ws, ref, git);
	let switchTo = null;
	if (branch && target && !target.primary) {
		if (branch !== target.name) throw new Error(`--branch must be ${target.name} — the worktree's branch is worktree-${target.name}`);
		if (target.branch) switchTo = null;
		else if (dryRun) switchTo = `would switch ${target.path} to worktree-${target.name}`;
		else git(['-C', target.path, 'switch', '-c', `worktree-${target.name}`], target.path);
	}
	const state = observeLand(ws, ref, { keep, assumeBranch: dryRun && switchTo ? branch : null }, git);
	const plan = planLand(state);
	const dataPath = ws.pkg.dreamteamer?.data_path ?? 'data';
	const descriptors = dt.loadDescriptors(c.primary) ?? new Map();
	// the primary is ONE fact — every other refusal it collects is a consequence of that one
	const refusals = state.worktree.kind === 'primary' ? ['it is the primary checkout'] : plan.refusals;
	const kept = () => fs.existsSync(state.worktree.root);
	if (refusals.length) {
		printRefusal(state.name, refusals);
		return { code: 1, landed: null, refused: refusals, kept: kept() };
	}
	if (dryRun) {
		console.log(`dt land ${state.name} → ${state.primaryBranch} (dry run)`);
		console.log(`  ${summarize(state.range, recordsIn(state.range, descriptors, dataPath))}`);
		if (switchTo) console.log(`  ▶ branch: ${switchTo}`);
		for (const s of plan.steps) console.log(`  ▶ ${s.id}: ${s.why}`);
		return { code: 0, landed: null, refused: null, kept: kept() };
	}
	const taken = takeLock(state.lock);
	if (taken.refused) {
		printRefusal(state.name, [taken.refused]);
		return { code: 1, landed: null, refused: [taken.refused], kept: kept() };
	}
	try {
		return { ...(await runLanding(ws, c, state, { descriptors, dataPath, npmRun }, git)), kept: kept() };
	} finally {
		fs.rmSync(state.lock.path, { recursive: true, force: true });
	}
}

/** Compile a checkout WITH its extensions — `openWorkspace` activates what that checkout's
 *  node_modules declares. A bare `{ root, pkg }` would reject every contributed kind (`proofs/`)
 *  as an unknown folder. */
async function compileAt(root) {
	return dt.compile(await dt.openWorkspace(root));
}

/** The mutating half, under the lock. */
async function runLanding(ws, c, state, { descriptors, dataPath, npmRun }, git) {
	const { name, worktree, branch, primaryBranch, range, keep } = state;
	const copy = `land/${name}`;
	// A leftover copy is evidence, not scratch — it survives exactly one failure (a `check` that
	// refused the rebased tree), and the message that left it there says to inspect it
	if (git(['branch', '--list', copy], c.primary)) {
		const why = `${copy} exists from an earlier landing — inspect or delete it first`;
		printRefusal(name, [why]);
		return { code: 1, landed: null, refused: [why] };
	}
	const holder = path.join(c.primary, '.worktrees');
	const temp = path.join(holder, `.land-${randomBytes(4).toString('hex')}`);
	let keptCopy = false;
	let ffDone = false; // past the fast-forward, a throw is not "nothing happened"
	try {
		git(['branch', '-f', copy, branch], c.primary);
		fs.mkdirSync(holder, { recursive: true });
		// A detached throwaway, never your worktree: a rebase there would leave a session mid-conflict
		// in the tree it is working in
		git(['worktree', 'add', '--detach', temp, copy], c.primary);
		mirrorModules(c.primary, temp);
		for (let attempt = 1; attempt <= FF_ATTEMPTS; attempt++) {
			const conflict = rebaseCopy(temp, primaryBranch, git);
			if (conflict) {
				const groups = groupByCollection(conflict.paths, descriptors, dataPath);
				console.error(`✖ landing ${name} conflicts with ${primaryBranch} at commit ${conflict.at} "${conflict.subject}":`);
				for (const [key, paths] of groups) console.error(`  ${key}: ${paths.join(' · ')}`);
				console.error(`  both trees are exactly as before. Resolve in the worktree (rebase it onto ${primaryBranch} by hand, or edit and commit), then land again.`);
				return { code: 1, landed: null, refused: null };
			}
			// always compiled: a fresh checkout of the copy has no runtime (`.dreamteamer/` is ignored).
			// The harness files it regenerates are gitignored, so nothing it writes reaches the landing.
			await compileAt(temp);
			// the rebase moved the throwaway's detached HEAD, not the branch: the copy is what the
			// fast-forward moves the primary to, so it is pointed at the rebased tip
			git(['-C', temp, 'branch', '-f', copy, 'HEAD'], temp);
			if (dt.check({ root: temp })) {
				keptCopy = true;
				console.error(`✖ rebased as ${copy} but NOT landed — dt check failed on the rebased tree; inspect with git log ${copy}`);
				return { code: 1, landed: null, refused: null };
			}
			const ff = spawnGit(['-C', c.primary, 'merge', '--ff-only', copy]);
			if (ff.status === 0) break;
			// asked of git, not of git's English: if the primary is still an ancestor of the copy the
			// fast-forward was possible, so this failure is something else entirely
			const ancestor = spawnGit(['-C', c.primary, 'merge-base', '--is-ancestor', primaryBranch, copy]).status;
			if (ancestor !== 1) throw new Error(String(ff.stderr).trim().split('\n')[0] || `git merge --ff-only ${copy} exited ${ff.status}`);
			if (attempt === FF_ATTEMPTS) {
				const why = `the primary moved ${FF_ATTEMPTS} times during the landing — try again`;
				printRefusal(name, [why]);
				return { code: 1, landed: null, refused: [why] };
			}
		}
		// ---- landed: the primary is on the branch's commits ------------------------------------
		ffDone = true;
		const primaryWs = dt.findWorkspace(c.primary); // re-read: package.json may be in the range
		if (range.files.includes('package-lock.json')) installDeps(primaryWs, npmRun);
		await compileAt(c.primary);
		// Re-measured as late as possible, a data-loss guard: a session writing into the worktree
		// during the landing would otherwise lose that work to the retire (`--force`) or the `--keep`
		// reset. The landing has succeeded, so this keeps the tree and says why.
		const changed = statusPaths(git, worktree.root);
		let retired;
		if (changed.length) {
			retired = `  worktree kept at ${worktree.root} — it changed during the landing (${plural(changed.length, 'path')}); land again to pick them up`;
		} else if (keep) {
			git(['-C', worktree.root, 'reset', '--hard', copy], worktree.root);
			await compileAt(worktree.root);
			retired = `  worktree kept at ${worktree.root}, branch reset to ${git(['-C', worktree.root, 'rev-parse', '--short=7', 'HEAD'], worktree.root)}`;
		} else {
			// `force` is honest: the refusals `removeWorktree` would make are over work this landing has
			// just published; what it must NOT skip is the re-measurement above
			removeWorktree(primaryWs, worktree.root, { force: true }, git);
			if (git(['branch', '--list', `worktree-${name}`], c.primary)) git(['branch', '-D', `worktree-${name}`], c.primary);
			retired = '  worktree and branch removed';
		}
		const records = recordsIn(range, descriptors, dataPath);
		console.log(`✔ landed ${name} onto ${primaryBranch}: ${plural(range.commits, 'commit')}`);
		for (const [collection, n] of records) console.log(`  ${collection}: ${plural(n, 'record')}`);
		console.log('  primary recompiled');
		console.log(retired);
		return { code: 0, landed: { records, commits: range.commits }, refused: null };
	} catch (e) {
		if (ffDone) {
			console.log(`✔ landed ${name} onto ${primaryBranch}, but the step after the fast-forward failed — ${e.message}`);
			console.log(`  the primary is on the landed commits and its runtime may be behind its tree: run dt compile in ${c.primary}`);
			console.log(`  the worktree at ${worktree.root} was NOT removed`);
		}
		throw e;
	} finally {
		// Every exit path. Prune only when this landing orphaned something itself: `git worktree prune`
		// is repo-wide and would unregister a peer's tree on an unmounted volume
		let orphaned = false;
		if (fs.existsSync(temp)) {
			try { git(['worktree', 'remove', '--force', temp], c.primary); } catch { fs.rmSync(temp, { recursive: true, force: true }); orphaned = true; }
		}
		if (orphaned) { try { git(['worktree', 'prune'], c.primary); } catch { /* nothing to prune */ } }
		if (!keptCopy && git(['branch', '--list', copy], c.primary)) git(['branch', '-D', copy], c.primary);
	}
}

/** Make the copy's compile see what the primary's does — the engine AND every installed module and
 *  extension. One symlink to the whole node_modules (gitignored, so it can never dirty the tree being
 *  landed), plus the same for each shadowing `git_modules/<name>` LINK; a real clone is per-checkout
 *  working state and is never linked. */
export function mirrorModules(primary, temp) {
	const src = path.join(primary, 'node_modules');
	const at = path.join(temp, 'node_modules');
	if (fs.existsSync(src) && !fs.existsSync(at)) {
		try { fs.symlinkSync(fs.realpathSync(src), at, 'dir'); } catch { /* a copy without modules still compiles its inline ones */ }
	}
	const shadows = path.join(primary, 'git_modules');
	for (const name of (fs.existsSync(shadows) ? fs.readdirSync(shadows) : [])) {
		const from = path.join(shadows, name);
		let realPath; try { if (!fs.lstatSync(from).isSymbolicLink()) continue; realPath = fs.realpathSync(from); } catch { continue; }
		try {
			fs.mkdirSync(path.join(temp, 'git_modules'), { recursive: true });
			fs.symlinkSync(realPath, path.join(temp, 'git_modules', name), 'dir');
		} catch { /* the copy compiles with what it has */ }
	}
}

/** Rebase the copy onto the primary branch. Returns null when it lands, or `{ at, subject, paths }`
 *  after ABORTING on the first conflict — nothing is resolved for you. */
function rebaseCopy(temp, onto, git) {
	// GIT_EDITOR=true: a rebase that stops to open an editor would hang
	const step = (...args) => spawnGit(['-C', temp, ...args], { ...process.env, GIT_EDITOR: 'true' });
	const r = step('rebase', onto);
	if (r.status === 0) return null;
	const unmerged = gitZ(git, temp, ['diff', '--name-only', '-z', '--diff-filter=U', '--no-relative']);
	if (!unmerged.length) {
		// a stop with nothing conflicted is reported, never driven
		step('rebase', '--abort');
		throw new Error(`rebase stopped without a conflict: ${String(r.stderr || r.stdout).trim().split('\n')[0]}`);
	}
	const at = git(['-C', temp, 'rev-parse', '--short=7', 'REBASE_HEAD'], temp); // read BEFORE the abort
	const subject = git(['-C', temp, 'log', '-1', '--format=%s', 'REBASE_HEAD'], temp);
	step('rebase', '--abort');
	return { at, subject, paths: unmerged };
}

/** `npm ci` in the primary when the landing moved the lockfile. `!== 0`, not truthiness: a spawn
 *  that never started has `status: null`. */
function installDeps(primaryWs, run = (npm, args, opts) => spawnSync(npm, args, opts)) {
	const npm = dt.resolveNpm();
	if (!npm) return console.warn('⚠ package-lock.json changed and npm is not on PATH — run npm ci in the primary before its next compile');
	const r = run(npm, ['ci', '--prefer-offline', '--no-audit', '--no-fund'], { cwd: primaryWs.root, stdio: ['ignore', 2, 2], env: dt.childEnv(), timeout: NPM_TIMEOUT_MS, killSignal: 'SIGKILL' });
	if (r?.status !== 0) console.warn(`⚠ npm ci ${typeof r?.status === 'number' ? `exited ${r.status}` : `never started (${r?.error?.message ?? 'no exit status'})`} in the primary — the landing stands; re-run it there`);
}

export const LAND_USAGE = `  land <name|path> [--keep] [--dry-run] [--branch <name>] [--json]
              land a worktree's commits onto the primary branch. Refuses while the primary holds
              pending record writes; rebases a COPY of the branch under one lock, checks the rebased
              tree, fast-forwards, recompiles the primary, then removes the worktree and its branch.
              Any conflict aborts and leaves every tree exactly as it was.
              --keep keep the worktree, reset onto what landed · --branch <name> give a DETACHED
              worktree its branch worktree-<name> first · --dry-run print the plan, change nothing`;

/** `dt land …` — the surface. */
export async function landCommand(ws, argv, { npmRun } = {}) {
	const { flags, pos } = parseFlags(argv, { bool: ['keep', 'dry-run', 'json'], value: ['branch'] }, 'dt land <name>');
	const ref = pos[0];
	if (pos.length > 1) throw new Error(`dt land takes ONE worktree — got ${pos.join(', ')}`);
	if (!ref) throw new Error('dt land needs a worktree: dt land <name|path> — dt worktree list');
	dt.warnIfStale(ws.root);
	// under --json stdout carries the payload and NOTHING else — compile, check and the retire step
	// all report through console.log
	const out = await logToStderr(!!flags.json, () => landWorktree(ws, ref, { keep: !!flags.keep, dryRun: !!flags['dry-run'], branch: flags.branch ?? null, npmRun }));
	if (flags.json) dt.emit(JSON.stringify({ ...out, landed: out.landed && { ...out.landed, records: Object.fromEntries(out.landed.records) } }, null, 2));
	return out.code;
}
