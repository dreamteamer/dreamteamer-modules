// EVERY FLAG THE SKILL TELLS YOU TO PASS MUST BE A FLAG THE SCRIPT ACCEPTS.
//
// ⚠ SKILL.md is not prose about the tools, it IS the procedure an agent follows verbatim — so a flag
// named there that a script rejects is a stage that cannot run. The v3 rename moved every script from
// `--session` to `--retrospective` and updated the descriptors, the scripts and their tests; SKILL.md
// kept saying `--session` in four places, including a sentence explaining the split as though it were
// still real ("v1 scripts take `--session <ref>`, v2 scripts `--retrospective`"). Following it gives
//     usage: --retrospective perspective/retrospective-sessions/<id> is required
// which is how it surfaced — on the stage that owns every number on an activity and a project
// (a client workspace, 2026-09-10).
//
// A doc is testable when it names commands. This reads the commands out of the table and asks each
// script whether it knows the flag.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

// the repo root — these tests were written at the root of dreamteamer/extensions, whose modules/ layout
// this repo keeps, so every `ROOT/modules/<m>/…` path still names the same file
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const SKILLS = path.join(ROOT, 'modules', 'perspective', 'skills', 'running-retrospectives');
const BIN = path.join(SKILLS, 'bin');

/** Flags a script parses: `opt('x')` / `flag('x')`, plus the positional-only scripts' own note. */
function flagsOf(script) {
	const src = fs.readFileSync(path.join(BIN, script), 'utf8');
	const found = new Set();
	for (const m of src.matchAll(/\b(?:opt|flag)\(\s*'([a-z0-9-]+)'/g)) found.add(m[1]);
	return found;
}

/** Every `bin/<script>.mjs … --flag` the skill and its references tell a reader to run. */
function documentedCalls() {
	const docs = [path.join(SKILLS, 'SKILL.md')];
	const refs = path.join(SKILLS, 'references');
	if (fs.existsSync(refs)) for (const f of fs.readdirSync(refs).filter((x) => x.endsWith('.md'))) docs.push(path.join(refs, f));

	const calls = [];
	for (const doc of docs) {
		const body = fs.readFileSync(doc, 'utf8');
		// `bin/thing.mjs` followed by whatever precedes the next backtick-fenced boundary or newline.
		for (const m of body.matchAll(/bin\/([a-z-]+)\.mjs((?:\s+(?:--[a-z0-9-]+|<[^>]*>|\[[^\]]*\]|[^\s`|]+))*)/g)) {
			const script = `${m[1]}.mjs`;
			if (!fs.existsSync(path.join(BIN, script))) continue;   // a script named in prose that does not exist is a different test
			const flags = [...m[2].matchAll(/--([a-z0-9-]+)/g)].map((x) => x[1]);
			if (flags.length) calls.push({ doc: path.relative(SKILLS, doc), script, flags });
		}
	}
	return calls;
}

const calls = documentedCalls();

test('the skill documents runnable commands at all', () => {
	assert.ok(calls.length >= 8, `only ${calls.length} documented invocations found — this gate is not reading the skill`);
});

test('every flag the skill names is one the script parses', () => {
	const offenders = [];
	for (const c of calls) {
		const known = flagsOf(c.script);
		for (const f of c.flags) {
			if (!known.has(f)) offenders.push(`${c.doc}: \`${c.script} --${f}\` — that script parses: ${[...known].sort().join(', ') || '(nothing)'}`);
		}
	}
	assert.deepEqual([...new Set(offenders)], [],
		`the skill IS the procedure — a flag a script rejects is a stage that cannot run:\n  ${[...new Set(offenders)].join('\n  ')}`);
});
