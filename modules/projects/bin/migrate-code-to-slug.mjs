#!/usr/bin/env node
// migrate-code-to-slug — renames the frontmatter key `code` to `slug` on tasks, decisions, goals and
// deliverables.
//
//   node node_modules/@dreamteamer/projects/bin/migrate-code-to-slug.mjs [--dry-run] [--allow-dirty] [--data-root <dir>]
//
// On those four collections the field exists only to give a non-Latin name a readable id, which is a
// slug, and it is optional: the id template takes the slug when set and the name otherwise.
// `activities.code` and `risks.code` are identifiers read in order, stay required, and are not
// touched.
//
// What it does:
//   - Renames the top-level frontmatter key on every record of the four collections. Nothing else.
//   - Ids do not change: `{{ slug }}` renders the same value `{{ code }}` did, so no reference needs
//     rewriting.
//   - Refuses to run if `activities` or `risks` has records and none carries `code`, rather than operate on a tree
//     it does not understand.
//   - Invents no slug for a record that had no code.
//
// Run it before `dreamteamer check`: a record still carrying `code` fails validation as an unknown
// field.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findWorkspace } from '../lib/workspace-root.mjs';

/** The four that were never codes. `activities` and `risks` are codes and are NOT here. */
export const RENAMED = ['tasks', 'decisions', 'goals', 'deliverables'];
export const KEPT_AS_CODE = ['activities', 'risks'];

const SUFFIX = { tasks: 'task', decisions: 'decision', goals: 'goal', deliverables: 'deliverable' };

/** Rewrite the first top-level `code:` key inside the frontmatter block, and nothing else.
 *
 *  Frontmatter only, and only at the top level: a body can contain a line starting with `code:`, and
 *  an indented `code:` belongs to a nested map. Returns null when there is nothing to do. */
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

	// A collection that keeps its code but whose records carry none is a tree this script does not
	// understand. Say so and change nothing, rather than half-migrate.
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
