// A GIT MODULE IS NOT A WORKSPACE. The resolver walks up for `package-lock.json` — the rule being
// that `package.json` alone is not enough, because a module folder carries one. But `npm install` in
// a module clone produces a LOCKFILE too, and a reader running from `git_modules/perspective/skills/…`
// would resolve the CLONE as the workspace and write records into it — invisible to `check`, and
// destroyed by the next git pull.
//
// The fix is structural, not a special case: nothing directly inside a `git_modules/` folder is ever
// a workspace root. This pins both directions, because a resolver that skipped too much would find
// no workspace at all.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const probe = (fromDir) =>
	execFileSync(process.execPath, ['--input-type=module', '-e',
		`import { WORKSPACE_ROOT } from ${JSON.stringify(path.join(fromDir, 'lib', 'workspace.mjs'))}; process.stdout.write(WORKSPACE_ROOT);`,
	], { encoding: 'utf8' });

const LIB = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'skills', 'running-retrospectives', 'lib', 'workspace.mjs');

/** A workspace with a lockfile, holding a clone that ALSO has one. */
function tree() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-root-'));
	const ws = path.join(root, 'workspace-dana');
	const clone = path.join(ws, 'git_modules', 'perspective', 'skills', 'running-retrospectives');
	fs.mkdirSync(path.join(clone, 'lib'), { recursive: true });
	fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}');
	fs.writeFileSync(path.join(ws, 'git_modules', 'perspective', 'package-lock.json'), '{}');
	fs.copyFileSync(LIB, path.join(clone, 'lib', 'workspace.mjs'));
	return { ws, clone };
}

test('a reader inside git_modules resolves the WORKSPACE, not the clone that also has a lockfile', () => {
	const { ws, clone } = tree();
	assert.equal(probe(clone), fs.realpathSync(ws), 'the clone is skipped even though it carries a lockfile');
});

test('the same resolver still finds a plain workspace with no clone involved', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-plain-'));
	const inner = path.join(root, 'modules', 'perspective', 'skills', 'running-retrospectives');
	fs.mkdirSync(path.join(inner, 'lib'), { recursive: true });
	fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
	fs.copyFileSync(LIB, path.join(inner, 'lib', 'workspace.mjs'));
	assert.equal(probe(inner), fs.realpathSync(root), 'an inline module still walks up to its workspace');
});
