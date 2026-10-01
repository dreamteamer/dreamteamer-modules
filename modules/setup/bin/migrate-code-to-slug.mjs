#!/usr/bin/env node
// migrate-code-to-slug — `code` becomes `slug` on the four collections where it was never a code.
//
//   npx dt-extensions migrate-code-to-slug [--dry-run] [--allow-dirty] [--data-root <dir>]
//
// WHY THE RENAME. This module used ONE field name for two different things. `activities.code`
// (`a-01`, `g-03`) and `risks.code` (`rk-01`) are identifiers a room says out loud and reads in
// ORDER — they are codes, they stay required, and they are not touched here. On `tasks`,
// `decisions`, `goals` and `deliverables` the same field existed for one reason only: a name in any
// script has to produce a readable, typeable id, and the engine's `slug` filter returns a hash when
// a value has no latin characters in it. That is a SLUG. Calling it a code made a workaround look
// like a domain concept, and made it required on every record of four collections.
//
// WHY IT COULD ONLY HAPPEN NOW. `slug` is OPTIONAL, which is only expressible because engine 0.25.0
// let `id.generate` take an ORDERED LIST — slug when a record carries one, the name otherwise.
// Before that a missing field threw before any fallback could run, so the only way to guarantee a
// latin id was to force the field onto every write. The module's engine floor moved to >=0.25.0 in
// the same change.
//
// WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT.
//   - It renames the frontmatter KEY on every record of the four collections. Nothing else.
//   - IDS DO NOT CHANGE. The new template renders `{{ slug }}` where the old one rendered
//     `{{ code }}`, from the same value, so every existing id is reproduced exactly and not one
//     reference anywhere needs rewriting. That is the whole reason this is a key rename and not a
//     `dt rename` sweep.
//   - It does not touch `activities` or `risks`, and it refuses to run if it finds `code` on them
//     looking like something it should have converted — better to stop than to flatten a real code.
//   - It does not invent a slug for a record that had no code. The field is optional now; an absent
//     value is correct, and the id already exists on disk either way.
//
// ⚠ RUN IT BEFORE `dreamteamer check`, NOT AFTER. The moment the descriptor drops `code`, a record
// still carrying that key fails validation as an unknown field — hard, not as a warning. There is no
// gradual path: the key either matches the schema or it does not.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findWorkspace } from '../lib/capabilities.mjs';

/** The four that were never codes. `activities` and `risks` are codes and are NOT here. */
export const RENAMED = ['tasks', 'decisions', 'goals', 'deliverables'];
export const KEPT_AS_CODE = ['activities', 'risks'];

const SUFFIX = { tasks: 'task', decisions: 'decision', goals: 'goal', deliverables: 'deliverable' };

/** Rewrite the first top-level `code:` key inside the frontmatter block, and nothing else.
 *
 *  ⚠ FRONTMATTER ONLY, AND ONLY AT THE TOP LEVEL. A body can legitimately contain a line starting
 *  with `code:` — a decision's rationale quoting a config, a deliverable describing a field — and a
 *  whole-file replace would corrupt it silently. An indented `code:` is a key of some nested map,
 *  not this field. Returns null when there is nothing to do, so the caller can count honestly. */
export function renameKey(text, from = 'code', to = 'slug') {
	if (!text.startsWith('---\n')) return null;
	const end = text.indexOf('\n---', 4);
	if (end === -1) return null;
	const head = text.slice(4, end);
	const rest = text.slice(end);
	const lines = head.split('\n');
	let found = false;
	const out = lines.map((line) => {
		if (found) return line;
		const m = new RegExp(`^${from}:(\\s|$)`).exec(line);
		if (!m) return line;
		found = true;
		return `${to}:${line.slice(from.length + 1)}`;
	});
	return found ? `---\n${out.join('\n')}${rest}` : null;
}

const walk = (d) => (fs.existsSync(d)
	? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
		const p = path.join(d, e.name);
		return e.isDirectory() ? walk(p) : [p];
	})
	: []);

const isDirty = (root) => {
	try { return execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0; }
	catch { return false; }
};

export function plan(root, dataRoot) {
	const base = dataRoot ?? path.join(root, 'data');
	const todo = [];
	const refusals = [];

	for (const coll of RENAMED) {
		for (const file of walk(path.join(base, coll))) {
			if (!file.endsWith(`.${SUFFIX[coll]}.md`)) continue;
			const text = fs.readFileSync(file, 'utf8');
			const next = renameKey(text);
			if (next) todo.push({ file, next, collection: coll });
		}
	}

	// ⚠ If a collection that KEEPS its code has records without one, something upstream already
	// renamed them and this run would be operating on a tree it does not understand. Say so and
	// change nothing, rather than half-migrating.
	for (const coll of KEPT_AS_CODE) {
		const files = walk(path.join(base, coll)).filter((f) => f.endsWith('.md'));
		const missing = files.filter((f) => !/^code:/m.test(fs.readFileSync(f, 'utf8').split('\n---')[0] ?? ''));
		if (files.length && missing.length === files.length) {
			refusals.push(`${coll}: ${files.length} record(s) and not one carries \`code\` — this collection KEEPS its code, so the tree is not in the state this migration expects`);
		}
	}
	return { todo, refusals };
}

export function main(argv, cwd) {
	const dryRun = argv.includes('--dry-run');
	const dataRootIx = argv.indexOf('--data-root');
	const dataRoot = dataRootIx > -1 ? path.resolve(cwd, argv[dataRootIx + 1]) : null;
	const root = findWorkspace(cwd) ?? cwd;

	if (!dryRun && !argv.includes('--allow-dirty') && isDirty(root)) {
		console.error('✖ the working tree has uncommitted changes.\n'
			+ '  This rewrites record files in place. Commit or stash first, so the migration is one\n'
			+ '  reviewable diff and `git checkout` is the undo. --allow-dirty overrides.');
		return 1;
	}

	const { todo, refusals } = plan(root, dataRoot);
	for (const r of refusals) console.error(`✖ ${r}`);
	if (refusals.length) return 1;

	if (!todo.length) {
		console.log('nothing to migrate — no record carries `code` on ' + RENAMED.join(', '));
		return 0;
	}

	const byColl = {};
	for (const t of todo) byColl[t.collection] = (byColl[t.collection] ?? 0) + 1;
	for (const [c, n] of Object.entries(byColl)) console.log(`  ${c}: ${n} record(s)`);
	console.log(`\n\`code\` → \`slug\` on ${todo.length} record(s). Ids are UNCHANGED — the new id template renders`);
	console.log('the same value from the same field, so no reference anywhere needs rewriting.');
	console.log(`\`${KEPT_AS_CODE.join('` and `')}\` keep their codes and were not touched.`);

	if (dryRun) { console.log('\n(--dry-run: nothing written)'); return 0; }
	for (const t of todo) fs.writeFileSync(t.file, t.next);
	console.log('\n✔ written. Now: `npx dreamteamer compile && npx dreamteamer check`');
	return 0;
}

function invokedDirectly() {
	if (!process.argv[1]) return false;
	const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
	return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
}

if (invokedDirectly()) process.exit(main(process.argv.slice(2), process.cwd()));
