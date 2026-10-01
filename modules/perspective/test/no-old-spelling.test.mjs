// The rename is total: no alias, no compat read, no deprecation window. This gate is what makes
// that true a year from now, when someone reaches for the old word out of muscle memory. Every
// exemption below must NAME the old spelling to do its job: the changelog records what the release
// renamed, the migration matches the old shape on disk, and the design note is evidence of what was
// decided on the day it was decided — a document edited to agree with the present proves nothing.
//
// ⚠ README.md is exempt DIFFERENTLY, and the difference is the point. A person upgrading has a
// workspace full of the old spelling and will search the readme for it; refusing to print the word
// there would be the rename hiding from the only reader who needs it. So the readme is allowed the
// word, but ONLY inside the upgrade section — a blanket exemption over the front page of the
// package would be a hole rather than a gate, and the second test below is what closes it.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

// the repo root — these tests were written at the root of dreamteamer/extensions, whose modules/ layout
// this repo keeps, so every `ROOT/modules/<m>/…` path still names the same file
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const EXEMPT = new Set(['CHANGELOG.md', 'bin/migrate.mjs', 'tests/migrate.test.mjs', 'tests/no-old-spelling.test.mjs', 'docs/2026-09-09-extensions-module-design.md']);
/** Exempt only within one named section, which the second test pins. */
const README = 'README.md';
const UPGRADE_HEADING = '### coming from 0.1.x with records already written';
// ⚠ `.claude` HOLDS AGENT WORKTREES — a whole second checkout of this repo, gitignored, at
// `.claude/worktrees/<agent>/`. Walking into it makes every tree-scanning gate here grade another
// branch's files as if they were this one's: on 2026-09-11 this test failed with six offenders that
// were all one subagent's in-progress worktree, none of them on HEAD. A gate that reads files git
// does not track is reporting on the wrong repo.
const SKIP_DIR = new Set(['node_modules', '.git', '.venv', '__pycache__', 'dist', '.models', '.claude', '.worktrees']);

function* walk(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (SKIP_DIR.has(e.name)) continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) yield* walk(p);
		else yield p;
	}
}

const offenders = [];
for (const f of walk(ROOT)) {
	const rel = path.relative(ROOT, f);
	if (EXEMPT.has(rel) || rel === README) continue;
	if (/introspect/i.test(rel)) { offenders.push(`${rel} (path)`); continue; }
	// ⚠ NEVER skip a file for looking binary. `modules/perspective/bin/check-records.mjs` carried two
	// literal NUL bytes as a Map key separator, so `grep -I`, this gate and the repo's leak scan all
	// classified 24 KB of live JavaScript as binary and read none of it — the rename missed the file
	// entirely and only a broken import revealed it (2026-09-09). NULs are stripped, not respected.
	let body;
	try { body = fs.readFileSync(f, 'utf8').replaceAll('\0', ''); } catch { continue; }
	const hits = body.match(/introspect\w*/gi);
	if (hits) offenders.push(`${rel} (${hits.length})`);
}

test('no file path or file content carries the old spelling', () => {
	assert.deepEqual(offenders, [], `still spelled "introspect" in ${offenders.length} place(s):\n  ${offenders.slice(0, 30).join('\n  ')}`);
});

test('the readme says the old name only where an upgrader is looking for it', () => {
	const body = fs.readFileSync(path.join(ROOT, README), 'utf8');
	const at = body.indexOf(UPGRADE_HEADING);
	assert.notEqual(at, -1, `${README} has no "${UPGRADE_HEADING}" section, so nothing here is scoped`);
	// The section runs to the next heading of the same level or above.
	const after = body.slice(at + UPGRADE_HEADING.length);
	const end = after.search(/\n#{1,3} /);
	const section = end === -1 ? after : after.slice(0, end);
	const outside = (body.slice(0, at) + (end === -1 ? '' : after.slice(end))).match(/introspect\w*/gi) ?? [];
	assert.deepEqual(outside, [], `the old spelling belongs in the upgrade section and nowhere else in ${README}: ${outside.join(', ')}`);
	assert.ok(/introspect/i.test(section), 'the upgrade section must NAME the old module — that is the whole reason it is exempt');
});
