// PREVIEW MODE — run a consumer workspace against a LOCAL CLONE of dreamteamer-modules instead of the
// published one, so a schema change can be reviewed in a real workspace before it is a release.
//
//   npx dt-setup link <path-to-clone>   symlink git_modules/dreamteamer-modules → the clone, recompile
//   npx dt-setup unlink                 remove it, recompile
//   npx dt-setup link                   say which is live
//
// ── the mechanism is the engine's, not ours ──────────────────────────────────────────────────────
// `discoverModules` scans three channels in precedence order — inline `modules/*`, then
// `git_modules/*`, then declared npm deps — and a name found twice takes the more LOCAL copy
// (npm-link semantics), reporting the loser as a shadow. A `git_modules` entry whose root carries
// `modules/` is UNPACKED, so one symlink delivers every module in the bundle. Nothing here
// implements that; this drives it and closes the three gaps that bite silently:
//
//   1. THE CLONE NEEDS ITS OWN `npm install` — node resolves a symlink to its real path, so the
//      module's scripts load deps from the clone's tree, never from the consumer's node_modules.
//   2. `.dreamteamer/` OUTLIVES THE FLIP. Compiled descriptors from one channel plus a CLI reading
//      the other is a workspace that lies about its own schema, with no error anywhere.
//   3. ⚠ IT IS WORKSPACE-GLOBAL, NOT PROCESS-SCOPED. There is no env override — the engine only
//      does a filesystem walk — so linking for one terminal links it for every session and editor
//      window on that workspace.
//
// ⚠ AND THE ORDERING RULE THE GUARD PROTECTS: the package ships FIRST, then the records that need
// it. A record written against an unreleased collection, or a harness block regenerated from one,
// is committed against a schema no other clone can compile — identical to the right answer right up
// until someone else pulls. So `link` installs a pre-commit hook that REFUSES a commit touching the
// record tree or the regenerated harness files while the link is on. `dt commit` goes through git,
// so it is covered too. Bypass is git's own `--no-verify`, and that is a stop-and-ask.
import fs from 'node:fs';
import path from 'node:path';

export const LINK_DIR = 'git_modules';
export const LINK_NAME = 'dreamteamer-modules';
export const linkPath = (root) => path.join(root, LINK_DIR, LINK_NAME);

/** What is at git_modules/dreamteamer-modules: 'off' | 'link' (ours, safe to remove) | 'real' (a genuine
 *  clone or checkout someone put there — reported, never touched). */
export function linkState(root) {
	const p = linkPath(root);
	let st;
	try { st = fs.lstatSync(p); } catch { return 'off'; }
	return st.isSymbolicLink() ? 'link' : 'real';
}

/** Where the link points, or null. Not resolved through the target — the raw link is what a reader
 *  needs to see, so a stale link reads as a stale path rather than as an error. */
export function linkTarget(root) {
	try { return fs.readlinkSync(linkPath(root)); } catch { return null; }
}

/** Is `dir` a clone of dreamteamer-modules — a bundle root with a `modules/` folder and our name? */
export function looksLikeClone(dir) {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
		if (!('dreamteamer' in pkg)) return 'no "dreamteamer" section in its package.json — not a dreamteamer package';
		if (!fs.existsSync(path.join(dir, 'modules'))) return 'no modules/ folder — a bundle root is what gets unpacked';
		return null;
	} catch { return 'no readable package.json there'; }
}

// ---- the guard ------------------------------------------------------------------------------
// What a commit may NOT carry while the link is on. Records are the obvious half; the harness
// blocks are the half that surprises people, because `compile` rewrites them from the linked
// schema without anyone asking and `git status` then shows three modified files nobody edited.
export const HARNESS_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'];

/** Which of `staged` this guard refuses, given the workspace's data path. Pure, so the rule is
 *  testable without a repo: paths are workspace-relative, forward-slashed, as `git diff` prints. */
export function refusedPaths(staged, dataPath = 'data') {
	const d = `${String(dataPath).replace(/\/+$/, '')}/`;
	return staged.filter((p) => p === dataPath || p.startsWith(d) || HARNESS_FILES.includes(p));
}

/** The whole verdict: null when the commit may proceed, else the message to print and exit 1 on. */
export function guardVerdict({ state, staged, dataPath = 'data' }) {
	if (state === 'off') return null;
	const refused = refusedPaths(staged, dataPath);
	if (!refused.length) return null;
	return [
		`✖ ${LINK_DIR}/${LINK_NAME} is linked to a local clone — this commit may not carry schema-shaped files.`,
		'',
		...refused.slice(0, 10).map((p) => `    ${p}`),
		refused.length > 10 ? `    … and ${refused.length - 10} more` : '',
		'',
		'  The package ships first, then the records that need it. These were written or regenerated',
		'  against an UNRELEASED schema, so any other clone of this workspace would fail to compile them.',
		'',
		`  fix: npx dt-setup unlink   (then recompile, re-check, and commit)`,
	].filter((l) => l !== '').join('\n');
}

// ⚠ THE HOOK RUNS THE LINKED CLONE'S GUARD, NOT THE INSTALLED PACKAGE'S. Measured the hard way: a
// hook spelled `npx --no-install npx dt-setup guard` resolves node_modules, i.e. the PUBLISHED
// copy — so during preview the rule enforced was the released one, and on a workspace whose
// installed version predates this verb the hook died `unknown command "guard"` and blocked every
// commit with a message about the wrong thing. Fails closed, but for a reason nobody could read.
// So: nothing linked ⇒ exit 0 and be a true no-op; linked ⇒ run the clone's own bin.
export const HOOK = `#!/bin/sh
# installed by \`npx dt-setup link\` — see lib/link.mjs. A true no-op once unlinked.
L="${LINK_DIR}/${LINK_NAME}"
[ -L "$L" ] || [ -d "$L" ] || exit 0
[ -f "$L/modules/setup/bin/setup.mjs" ] && exec node "$L/modules/setup/bin/setup.mjs" guard
exec npx --no-install npx dt-setup guard
`;
