// A SCRIPT MUST STILL RUN WHEN IT IS REACHED THROUGH A SYMLINK.
//
// Every executable in this package decides whether to run `main()` by comparing `process.argv[1]`
// with its own `import.meta.url`. The two are the path as INVOKED and the path as RESOLVED, and they
// are the same string only when nothing in between is a symlink.
//
// Preview mode puts a symlink in between, by design: `git_modules/extensions` points into a clone
// somewhere else entirely, which is the whole mechanism that lets a consumer review this package
// before it is published. So under exactly the conditions these scripts are most needed, a naive
// `===` is false and the guard never fires.
//
// ⚠ AND THE FAILURE IS SILENT — no output, exit 0. Measured 2026-09-11 on a linked consumer holding
// 52 activities, 35 decisions and 8 phases: `modules/projects/bin/check-records.mjs` printed nothing
// and exited 0, which reads on a terminal exactly like a clean run. Four other scripts in the package
// carried the same pattern. This file pins BOTH halves: the shape, over every script, so a new one
// cannot reintroduce it; and the behaviour, by actually invoking one through a symlink.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SKIP = new Set(['node_modules', '.git', 'git_modules', '.dreamteamer', '.claude', 'tests']);

/** Every `.mjs` in the package that could be run as a script. */
function scripts(dir = ROOT, out = []) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (SKIP.has(e.name)) continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) scripts(p, out);
		else if (e.name.endsWith('.mjs') && !e.name.endsWith('.test.mjs')) out.push(p);
	}
	return out;
}

const ALL = scripts();

describe('the entry guard survives a symlink', () => {
	test('the scan is not vacuous', () => {
		assert.ok(ALL.length >= 5, `expected the modules' scripts, saw ${ALL.length}`);
	});

	// The shape check. A guard that compares the two paths WITHOUT resolving both is the defect; the
	// only sanctioned form is one that realpaths each side.
	test('no script compares argv[1] to import.meta.url without resolving both through realpath', () => {
		const bad = [];
		for (const f of ALL) {
			const src = fs.readFileSync(f, 'utf8');
			// The dangerous shape: argv[1] and fileURLToPath compared on one line, with no realpath
			// anywhere in the file to undo the symlink.
			const compares = /process\.argv\[1\][^\n]*===[^\n]*fileURLToPath|fileURLToPath[^\n]*===[^\n]*process\.argv\[1\]/.test(src);
			if (compares && !/realpathSync/.test(src)) bad.push(path.relative(ROOT, f));
		}
		assert.deepEqual(bad, [],
			`these never run when reached through a symlink — silently, exit 0:\n  ${bad.join('\n  ')}\n`
			+ 'Resolve BOTH sides: `const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };`');
	});
});

describe('and it actually runs, through a real symlink', () => {
	// The shape check above is a grep and could be satisfied by a file that mentions `realpathSync`
	// in a comment. This one invokes the guard the way preview mode does and reads what comes back.
	test('the users guard reports through a symlink, rather than exiting 0 in silence', () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-'));
		// A workspace with one user, reached through a link that stands in for `git_modules/` or `npm link`.
		const rec = path.join(tmp, 'data', 'users', 'dana-oren.user.md');
		fs.mkdirSync(path.dirname(rec), { recursive: true });
		fs.writeFileSync(rec, '---\nname: Dana Oren\nkind: human\n---\n');
		const link = path.join(tmp, 'linked-package');
		fs.symlinkSync(ROOT, link);

		const r = spawnSync(process.execPath,
			[path.join(link, 'modules/users/bin/check-records.mjs')],
			{ cwd: tmp, encoding: 'utf8' });

		assert.equal(r.status, 0, r.stderr);
		// THE ASSERTION THAT WOULD HAVE CAUGHT IT. Silence is not a pass.
		assert.notEqual(r.stdout.trim(), '', 'the guard produced NO output through the symlink — that is the defect, not a clean run');
		assert.match(r.stdout, /1 checked, 0 violations/,
			'and it must have actually read the workspace it was pointed at');
	});
});
