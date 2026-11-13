// PREVIEW MODE — what a fixture can pin: the state machine at git_modules/dreamteamer-modules, what the
// pre-commit guard refuses, and the shape of a clone we agree to link. The flip itself (symlink +
// recompile + the editor windows noticing) is smoked by hand in a real workspace and quoted.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main as linkMain } from '../scripts/preview/link-cli.mjs';
import {
	HARNESS_FILES, HOOK, HOOK_MARKER, LINK_DIR, LINK_NAME,
	guardVerdict, linkPath, linkState, linkTarget, looksLikeClone, refusedPaths, OLD_HOOK_MARKERS,
} from '../scripts/preview/link.mjs';

// the repo root
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ext-link-'));

describe('the link state at git_modules/dreamteamer-modules', () => {
	test('absent is off', () => {
		assert.equal(linkState(tmp()), 'off');
	});
	test('a symlink is ours, and its raw target is what a reader is shown', () => {
		const ws = tmp();
		fs.mkdirSync(path.join(ws, LINK_DIR));
		fs.symlinkSync(ROOT, linkPath(ws), 'dir');
		assert.equal(linkState(ws), 'link');
		assert.equal(linkTarget(ws), ROOT);
	});
	// The one case that must never be deleted for you: someone with a genuine clone checked out
	// there, which `unlink` would otherwise remove along with whatever was uncommitted in it.
	test('a real directory is reported as real, never as ours', () => {
		const ws = tmp();
		fs.mkdirSync(path.join(ws, LINK_DIR, LINK_NAME), { recursive: true });
		assert.equal(linkState(ws), 'real');
	});
});

describe('what we agree to link', () => {
	test('this package is a clone we would link', () => {
		assert.equal(looksLikeClone(ROOT), null);
	});
	test('a folder with no package.json is refused by name', () => {
		assert.match(looksLikeClone(tmp()), /package\.json/);
	});
	test('a package with no dreamteamer section is refused', () => {
		const d = tmp();
		fs.writeFileSync(path.join(d, 'package.json'), '{"name":"x"}');
		assert.match(looksLikeClone(d), /dreamteamer/);
	});
	// A single module, not a bundle: linking it would work, but it is not what this verb is for and
	// the silent half-install is worse than a refusal that names modules/.
	test('a dreamteamer package with no modules/ folder is refused, naming modules/', () => {
		const d = tmp();
		fs.writeFileSync(path.join(d, 'package.json'), '{"name":"x","dreamteamer":{}}');
		assert.match(looksLikeClone(d), /modules\//);
	});
});

describe('the pre-commit guard', () => {
	const staged = ['data/rnd/projects/x.project.md', 'README.md', 'CLAUDE.md', 'modules/default/collections/notes.collection.yaml'];

	test('unlinked, nothing is ever refused', () => {
		assert.equal(guardVerdict({ state: 'off', staged }), null);
	});
	test('linked, records and the regenerated harness blocks are refused and named', () => {
		const msg = guardVerdict({ state: 'link', staged });
		assert.match(msg, /data\/rnd\/projects\/x\.project\.md/);
		assert.match(msg, /CLAUDE\.md/);
		assert.doesNotMatch(msg, /README\.md/, 'ordinary source work stays committable while previewing');
		assert.match(msg, /scripts\/preview\.mjs unlink/, 'the refusal has to carry its own fix');
	});
	test('linked with nothing schema-shaped staged, the commit proceeds', () => {
		assert.equal(guardVerdict({ state: 'link', staged: ['README.md', 'package.json'] }), null);
	});
	// `dreamteamer.data_path` is a workspace's own choice; a guard hard-coding `data/` would wave
	// through every record in a workspace that moved it.
	test('a workspace that renamed its data path is still guarded', () => {
		const msg = guardVerdict({ state: 'link', staged: ['records/notes/a.note.md'], dataPath: 'records' });
		assert.match(msg, /records\/notes\/a\.note\.md/);
		assert.equal(guardVerdict({ state: 'link', staged: ['records-of-something-else/a.md'], dataPath: 'records' }), null);
	});
	test('a real checked-out directory is guarded exactly like a symlink', () => {
		assert.ok(guardVerdict({ state: 'real', staged: ['data/x.md'] }));
	});
	test('refusedPaths is the whole rule, and it keeps the three harness files', () => {
		assert.deepEqual(refusedPaths(['data/a.md', 'src/b.js', ...HARNESS_FILES]), ['data/a.md', ...HARNESS_FILES]);
		assert.deepEqual(HARNESS_FILES, ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']);
	});
	test('the hook is ours by its marker line and never names npx', () => {
		assert.ok(HOOK.includes(HOOK_MARKER));
		assert.doesNotMatch(HOOK, /\bnpx\b[^\n]*guard/);
	});
});

// The generated hook, run by a real `git commit` in a temp repo, with the registry unreachable and
// an `npx` on PATH that records any call — so a fallback that fetches a package fails the test.
describe('the installed hook, run by git', () => {
	const isolated = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', NO_COLOR: '1' };
	const git = (cwd, args, env = isolated) => spawnSync('git', ['-c', 'user.name=Dana Oren', '-c', 'user.email=dana@northwind.example', ...args], { cwd, env, encoding: 'utf8', timeout: 30_000 });

	async function quietly(fn) {
		const out = [];
		const log = console.log;
		console.log = (...a) => out.push(a.join(' '));
		try { await fn(); } finally { console.log = log; }
		return out.join('\n');
	}

	/** A workspace linked to a bundle clone; the clone carries this repo's preview script on request. */
	async function linkedRepo({ cloneGuard = false, hook = null } = {}) {
		const ws = tmp();
		assert.equal(git(ws, ['init', '-q']).status, 0);
		fs.writeFileSync(path.join(ws, 'package.json'), '{"name":"ws","dreamteamer":{}}');
		fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}');
		fs.mkdirSync(path.join(ws, 'data'));
		fs.writeFileSync(path.join(ws, 'data', 'a.md'), 'a\n');
		fs.writeFileSync(path.join(ws, 'README.md'), 'r\n');
		const clone = tmp();
		fs.writeFileSync(path.join(clone, 'package.json'), '{"name":"bundle","dreamteamer":{}}');
		fs.mkdirSync(path.join(clone, 'modules'));
		if (cloneGuard) fs.symlinkSync(path.join(ROOT, 'scripts'), path.join(clone, 'scripts'), 'dir');
		const hookFile = path.join(ws, '.git', 'hooks', 'pre-commit');
		if (hook) { fs.mkdirSync(path.dirname(hookFile), { recursive: true }); fs.writeFileSync(hookFile, hook, { mode: 0o755 }); }
		const out = await quietly(() => linkMain([clone], ws, 'link'));
		return { ws, hookFile, out };
	}

	/** `git commit` with a recording `npx`/`npm` first on PATH and the registry pointed at a closed port. */
	function commit(ws, paths) {
		const fake = tmp();
		const calls = path.join(fake, 'calls');
		for (const bin of ['npx', 'npm']) fs.writeFileSync(path.join(fake, bin), `#!/bin/sh\necho "${bin} $*" >> "${calls}"\nexit 97\n`, { mode: 0o755 });
		assert.equal(git(ws, ['add', '--', ...paths]).status, 0);
		const env = { ...isolated, PATH: `${fake}${path.delimiter}${process.env.PATH}`, npm_config_registry: 'http://127.0.0.1:9' };
		const r = git(ws, ['-c', `core.hooksPath=${path.join(ws, '.git', 'hooks')}`, 'commit', '-q', '-m', 'x'], env);
		return { status: r.status, stderr: r.stderr, npx: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '' };
	}

	test('a linked bundle with no preview script refuses the commit without calling npx', async () => {
		const { ws } = await linkedRepo();
		const r = commit(ws, ['README.md']);
		assert.equal(r.npx, '', 'the hook must never call npx or npm');
		assert.equal(r.status, 1);
		assert.match(r.stderr, /linked bundle has no guard — unlink or update it/);
	});
	test('the linked clone\'s own guard runs', async () => {
		const { ws } = await linkedRepo({ cloneGuard: true });
		const r = commit(ws, ['data/a.md']);
		assert.equal(r.npx, '');
		assert.equal(r.status, 1);
		assert.match(r.stderr, /may not carry schema-shaped files/);
	});
	test('with nothing linked the hook is a no-op', async () => {
		const { ws } = await linkedRepo();
		fs.rmSync(linkPath(ws));
		const r = commit(ws, ['data/a.md']);
		assert.equal(r.npx, '');
		assert.equal(r.status, 0, r.stderr);
	});
	test('link rewrites an earlier hook of ours, so its npx line is gone', async () => {
		const old = `#!/bin/sh\n${OLD_HOOK_MARKERS[0]} — see lib/link.mjs.\nexec npx --no-install npx dt-setup guard\n`;
		const { hookFile } = await linkedRepo({ hook: old });
		assert.equal(fs.readFileSync(hookFile, 'utf8'), HOOK);
	});
	test('link leaves a foreign hook alone and offers lines that never call npx', async () => {
		const mine = '#!/bin/sh\necho mine\n';
		const { hookFile, out } = await linkedRepo({ hook: mine });
		assert.equal(fs.readFileSync(hookFile, 'utf8'), mine);
		assert.match(out, /append these lines/);
		assert.match(out, /scripts\/preview\.mjs/);
		assert.doesNotMatch(out, /\bnpx\b[^\n]*guard/);
	});
});
