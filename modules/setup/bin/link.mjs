// The `link` / `unlink` / `guard` verbs — preview mode's side effects. The RULE lives in
// lib/link.mjs, which is pure and tested; this file is the part that touches disk, and it is
// deliberately the only place that does.
//
// ⚠ EVERYTHING HERE RUNS ONLY THROUGH bin/extensions.mjs. There is no main guard because there is
// no script path — importing this file defines functions and runs nothing.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
	HARNESS_FILES, HOOK, LINK_DIR, LINK_NAME,
	guardVerdict, linkPath, linkState, linkTarget, looksLikeClone,
} from '../lib/link.mjs';

const C = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (s, code) => (C ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => paint(s, '2');
const say = (...a) => console.log(...a);
const die = (m) => { console.error(paint('✖', '31'), m); return 1; };

const readPkg = (root) => { try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { return {}; } };
const dataPathOf = (root) => readPkg(root)?.dreamteamer?.['data-path'] ?? 'data';

/** The engine as this workspace has it — never a global `dreamteamer`, which may be a different
 *  version than the one the workspace pinned. Absent is a real answer, not a crash. */
function recompile(root) {
	const bin = path.join(root, 'node_modules', '.bin', 'dreamteamer');
	if (!fs.existsSync(bin)) {
		say(dim('  ▲ no node_modules/.bin/dreamteamer here — run `npm install`, then `npx dreamteamer compile`'));
		return;
	}
	const r = spawnSync(bin, ['compile'], { cwd: root, encoding: 'utf8' });
	const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('✔ compiled'));
	say(line ? `  ${line}` : dim(`  ▲ compile exited ${r.status} — run \`npx dreamteamer compile\` and read it`));
}

/** git_modules/ must be ignored, or the symlink itself gets staged into someone's commit. */
function ensureIgnored(root) {
	const f = path.join(root, '.gitignore');
	const body = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
	if (body.split('\n').some((l) => l.trim().replace(/\/$/, '') === LINK_DIR)) return false;
	fs.writeFileSync(f, `${body}${body.endsWith('\n') || !body ? '' : '\n'}${LINK_DIR}/\n`);
	return true;
}

function installHook(root) {
	// --git-dir, not .git/: a worktree's .git is a FILE pointing elsewhere, and writing a hook into
	// a path that does not exist would fail silently on exactly the setup most likely to need it.
	let gitDir;
	try { gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
	catch { return 'not a git repo — no guard installed, so nothing stops a commit against the linked schema'; }
	const f = path.join(gitDir, 'hooks', 'pre-commit');
	if (fs.existsSync(f) && !fs.readFileSync(f, 'utf8').includes('dt-extensions guard')) {
		return `a pre-commit hook already exists at ${f} — left alone; add \`npx --no-install dt-extensions guard\` to it yourself`;
	}
	fs.mkdirSync(path.dirname(f), { recursive: true });
	fs.writeFileSync(f, HOOK);
	fs.chmodSync(f, 0o755);
	return null;
}

function status(root) {
	const state = linkState(root);
	if (state === 'off') {
		const v = readPkg(root)?.dependencies?.['@dreamteamer/extensions'];
		say(`  published   ${v ? `@dreamteamer/extensions ${v}` : dim('not a declared dependency here')}`);
		say(dim(`  preview off · npx dt-extensions link <path-to-clone>`));
		return 0;
	}
	const target = state === 'link' ? linkTarget(root) : linkPath(root);
	say(`  ${paint('PREVIEW', '33')}     ${LINK_DIR}/${LINK_NAME} → ${target}`);
	if (state === 'real') say(dim('  a real directory, not a symlink — left alone; `unlink` will not delete it'));
	if (!fs.existsSync(path.join(target ?? '', 'node_modules'))) {
		say(`  ${paint('✖', '31')} no node_modules in the clone — its scripts will die ERR_MODULE_NOT_FOUND`);
		say(dim(`      fix: (cd ${target} && npm install)`));
	}
	say(dim('  workspace-global: every session and editor window on this workspace sees it'));
	return 0;
}

export async function main(argv, root, verb) {
	if (verb === 'guard') {
		let staged = [];
		try { staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean); }
		catch { return 0; } // not a repo, or nothing to read — never block a commit on our own failure
		const msg = guardVerdict({ state: linkState(root), staged, dataPath: dataPathOf(root) });
		if (!msg) return 0;
		console.error(msg);
		return 1;
	}

	if (verb === 'unlink') {
		const state = linkState(root);
		if (state === 'off') { say(dim('  already published — nothing linked')); return 0; }
		if (state === 'real') return die(`${LINK_DIR}/${LINK_NAME} is a real directory, not a symlink — remove it yourself if you meant to`);
		fs.rmSync(linkPath(root));
		say(`  ${paint('✔', '32')} unlinked — the published package is live again`);
		recompile(root);
		say(dim('  the guard hook stays; it is a no-op with nothing linked'));
		return 0;
	}

	// link
	const target = argv.find((a) => !a.startsWith('-'));
	if (!target) return status(root);
	const abs = path.resolve(target);
	if (!fs.existsSync(abs)) return die(`no such folder: ${abs}`);
	const why = looksLikeClone(abs);
	if (why) return die(`${abs} is not a clone of a module package — ${why}`);
	if (linkState(root) === 'real') return die(`${LINK_DIR}/${LINK_NAME} is a real directory — remove it yourself if you meant to replace it`);

	fs.mkdirSync(path.join(root, LINK_DIR), { recursive: true });
	fs.rmSync(linkPath(root), { force: true });
	fs.symlinkSync(abs, linkPath(root), 'dir');
	say(`  ${paint('✔', '32')} ${LINK_DIR}/${LINK_NAME} → ${abs}`);
	if (ensureIgnored(root)) say(dim(`  added ${LINK_DIR}/ to .gitignore`));
	const hookProblem = installHook(root);
	say(hookProblem ? `  ${paint('▲', '33')} ${hookProblem}` : dim(`  pre-commit guard installed — a commit touching ${dataPathOf(root)}/ or ${HARNESS_FILES.join('/')} is refused while linked`));
	recompile(root);
	return status(root);
}
