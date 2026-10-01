// PREVIEW MODE — what a fixture can pin: the state machine at git_modules/extensions, what the
// pre-commit guard refuses, and the shape of a clone we agree to link. The flip itself (symlink +
// recompile + the editor windows noticing) is smoked by hand in a real workspace and quoted.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	HARNESS_FILES, HOOK, LINK_DIR, LINK_NAME,
	guardVerdict, linkPath, linkState, linkTarget, looksLikeClone, refusedPaths,
} from '../lib/link.mjs';

// the repo root — these tests were written at the root of dreamteamer/extensions, whose modules/ layout
// this repo keeps, so every `ROOT/modules/<m>/…` path still names the same file
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ext-link-'));

describe('the link state at git_modules/extensions', () => {
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
		assert.match(msg, /npx dt-setup unlink/, 'the refusal has to carry its own fix');
	});
	test('linked with nothing schema-shaped staged, the commit proceeds', () => {
		assert.equal(guardVerdict({ state: 'link', staged: ['README.md', 'package.json'] }), null);
	});
	// `dreamteamer.data-path` is a workspace's own choice; a guard hard-coding `data/` would wave
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
	// The regression: the first hook was `npx --no-install npx dt-setup guard`, which resolves
	// node_modules — the PUBLISHED copy. During preview that enforced the released rule, and on a
	// workspace whose installed version predated the verb it died `unknown command "guard"` and
	// blocked every commit with a message about the wrong thing.
	test('the hook prefers the LINKED clone\'s guard, exits 0 when nothing is linked, and installs nothing', () => {
		assert.ok(HOOK.includes(`L="${LINK_DIR}/${LINK_NAME}"`), 'the hook must look at the link we install');
		assert.ok(HOOK.includes('exec node "$L/bin/extensions.mjs" guard'), 'must run the clone we are previewing, not node_modules');
		assert.match(HOOK, /exit 0/, 'unlinked must be a true no-op, not a failed lookup');
		assert.match(HOOK, /--no-install/, 'the npx fallback must never install a package inside a commit');
		assert.ok(HOOK.indexOf('exit 0') < HOOK.indexOf('extensions.mjs" guard'), 'the no-op check comes first');
	});
});
