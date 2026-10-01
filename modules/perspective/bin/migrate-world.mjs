#!/usr/bin/env node
// migrate-world — the move of the OBSERVED WORLD into the `perspective/world` namespace, for a
// workspace whose records were written by 0.2.x–0.8.x.
//
//   node node_modules/@dreamteamer/perspective/bin/migrate-world.mjs [--dry-run] [--allow-dirty] [--rewrite-sources] [--data-root <d>]
//
// ⚠ WHY THE PACKAGE SHIPS THIS AND `dt rename collections/<old> <new>` CANNOT DO IT. The engine
// refuses that verb outright for a package-shipped collection — schema-ops.js: "ships from
// node_modules — a write there is erased by the next `npm install`." A collection whose descriptor
// belongs to a package has to be migrated BY that package. Same reason `bin/migrate.mjs` exists.
//
// ⚠ WHAT MAKES THIS CHEAP, and it is the whole reason the world became a NAMESPACE rather than an
// overlay on the real collections: NO ID CHANGES. Every record keeps `<contributor>/<slug>` exactly
// as it was, so nothing has to be re-derived and no run has to be repeated. A consumer measured its
// 205 perspective records by writer and found 72 were script output (a re-run brings those back) and
// 133 were a model pass or rows a person dictated (a re-run produces DIFFERENT ones, at the cost of
// the original). None of that matters here, because nothing is re-derived. Four things move:
//
//   1. THE FOLDER. data/perspective/{activities,projects,collaborators,goals,decisions,deliverables}
//      → …/world/{…,users,…}. The last two joined in 0.9.0, when the layer grew to cover the whole
//      projects model; a workspace already on 0.7.0's namespace finds only those two to move, and the
//      earlier four report nothing, which is what idempotence is for.
//   2. THE SUFFIX, on one collection only: `.collaborator.md` → `.user.md`.
//   3. FOUR FIELD NAMES. `goals.statement` → `done_when` and `goals.horizon` → `status` (the real
//      collection's own words for the same slots); `sources.retrospective` → the LIST
//      `retrospectives`, and `sources.last_seen_in` is dropped into it.
//   4. EVERY REFERENCE to a moved collection, in frontmatter AND in bodies, across the whole tree.
//
// ⚠ AND IT CHECKS THE CONSUMER'S OWN SOURCES FIRST — an overlay's `extends:`, a ui-view's
// `collection:`, anything under the workspace's own `modules/` that names a renamed collection. Those
// are not records, nothing else sweeps them, and compile fails on them AFTERWARDS with a message that
// names a compile internal rather than the file. See `scanSources`; it refuses by default and
// `--rewrite-sources` applies the edits it printed.
//
// ⚠ IT NEVER SETS `real`. The join out to the workspace's own `users`/`projects`/`activities`/
// `tasks`/`goals` is a proposal a person confirms; a migration that guessed it would be authoring
// truth into records whose whole contract is that they are findings.
//
// Idempotent: a second run finds nothing to move and says so.
import __fs from 'node:fs';
import __path from 'node:path';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

// this module's own descriptors, beside bin/ — the same place on every channel
const COLLECTIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'collections', 'perspective');

/** Old collection folder → new one, under `data/perspective/`. The suffix travels with it. */
export const MOVES = [
	{ from: 'activities', to: 'world/activities', suffix: 'activity', newSuffix: 'activity' },
	{ from: 'projects', to: 'world/projects', suffix: 'project', newSuffix: 'project' },
	{ from: 'collaborators', to: 'world/users', suffix: 'collaborator', newSuffix: 'user' },
	{ from: 'goals', to: 'world/goals', suffix: 'goal', newSuffix: 'goal' },
	// ⚠ 0.9.0 — the world layer grows to the WHOLE projects model. These two were top-level
	// `perspective/*` collections through 0.8.0, and a workspace already on 0.7.0's namespace still
	// has them there: the earlier moves below will find nothing and these two will find everything,
	// which is exactly what idempotence buys. No suffix change and no id change, as before.
	{ from: 'decisions', to: 'world/decisions', suffix: 'decision', newSuffix: 'decision' },
	{ from: 'deliverables', to: 'world/deliverables', suffix: 'deliverable', newSuffix: 'deliverable' },
];

/** `<collection>.<old field>` → the new field name. Value untouched; only the key moves. */
export const FIELD_RENAMES = {
	'world/goals.statement': 'done_when',
	'world/goals.horizon': 'status',
};

/** Longest first, so `perspective/activities` is never matched inside `perspective/activity-weeks`. */
const REF_PREFIXES = MOVES
	.map((m) => [`perspective/${m.from}/`, `perspective/${m.to}/`])
	.sort((a, b) => b[0].length - a[0].length);

const walk = (dir) => (fs.existsSync(dir)
	? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
		? walk(path.join(dir, e.name))
		: [path.join(dir, e.name)]))
	: []);

const splitRecord = (text) => {
	const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
	return m ? { fm: m[1], body: text.slice(m[0].length) } : null;
};

/** Rewrite every reference to a moved collection. Frontmatter and body alike — a body carries refs
 *  in prose, and a migration that only swept the frontmatter leaves half the links pointing nowhere. */
export function rewriteRefs(text) {
	let out = text;
	for (const [from, to] of REF_PREFIXES) out = out.split(from).join(to);
	return out;
}

/**
 * The frontmatter of one record, with this collection's key renames applied and — for `sources` —
 * the run link folded into a list.
 *
 * ⚠ EDITED BY LINE, never round-tripped through a YAML dumper. Re-emitting thousands of records
 * would requote every string and reflow every block scalar: a diff nobody can review, over records a
 * person wrote. Only the key at the head of a line moves; every continuation line is carried through
 * byte for byte, so a block scalar or a nested list under a renamed key survives untouched.
 */
export function editFrontmatter(fm, collection) {
	const lines = fm.split('\n');
	const out = [];
	const runs = [];
	let skipping = false;
	for (const line of lines) {
		const m = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(line);
		if (!m) { if (!skipping) out.push(line); continue; }
		skipping = false;
		const [, key, rest] = m;
		if (collection === 'sources' && (key === 'retrospective' || key === 'last_seen_in')) {
			// Both scalars fold into the one list, in the order they appear — `retrospective` was the
			// FIRST run and `last_seen_in` the most recent, which is exactly the order a sorted list
			// would put them in anyway.
			const value = rest.trim();
			if (value && !runs.includes(value)) runs.push(value);
			skipping = true;      // and any continuation lines the scalar somehow had
			continue;
		}
		if (collection === 'sources' && key === 'retrospectives') {
			// Already a list — this record has been migrated. Leave it, and everything under it, alone.
			out.push(line);
			continue;
		}
		const renamed = FIELD_RENAMES[`${collection}.${key}`];
		out.push(renamed ? `${renamed}:${rest}` : line);
	}
	if (runs.length) out.unshift('retrospectives:', ...runs.map((r) => `  - ${r}`));
	return out.join('\n');
}

/**
 * A CONSUMER'S OWN SOURCE FILES THAT NAME A COLLECTION THIS MIGRATION RENAMES.
 *
 * ⚠ MEASURED IN A REAL CONSUMER, 2026-09-11, and it BRICKED the workspace. It shipped its own overlay
 * carrying `extends: perspective/activities`. Renaming that collection makes `compile` hard-fail with
 * `every descriptor declares 'extends' — no base found` — a message naming a compile internal and not
 * the file anybody has to edit. The same class bit again immediately: a workspace `ui-view` with
 * `collection: collections/perspective/activities`. Neither is a RECORD, so the record migration
 * swept neither, and the operator had to find both by reading an error that pointed elsewhere.
 *
 * ⚠ SO THIS RUNS BEFORE ANY COMPILE. It is part of `plan()`, which is the first thing `main()` does
 * and the whole of what `--dry-run` does — because a check that runs after the first compile never
 * gets to print.
 *
 * ⚠ AND IT REFUSES BY DEFAULT RATHER THAN REWRITING, which is the deliberate fork. These are the
 * consumer's OWN authored sources, not records — and in the one real case BOTH files turned out to be
 * obsolete for independent reasons, which was discovered only by reading them. A migration that
 * silently retargeted them would have carried two dead files forward and said nothing. So the default
 * prints the exact file, the exact line and the exact edit; `--rewrite-sources` does it for you once
 * you have looked.
 *
 * It scans the workspace's own source tree only. The package's shipped descriptors already carry the
 * NEW spellings, so they never match — the scan needs no knowledge of which module is whose.
 */
const SOURCE_DIRS = ['modules', 'collections', 'ui-views', 'skills', 'agents', 'commands', 'command-bindings', 'collection-templates'];
const SKIP_DIRS = new Set(['node_modules', 'git_modules', 'data', '.dreamteamer', '.git']);
const SOURCE_EXT = /\.(ya?ml|md|json|mjs|js)$/;

/** `perspective/<moved>` not followed by another name character — so a bare `extends:` target and a
 *  full record reference both match, and `perspective/activity-weeks` (a different collection that
 *  did NOT move) never does. */
const SOURCE_PATTERNS = MOVES.map((m) => [
	new RegExp(`perspective/${m.from}(?![A-Za-z0-9_-])`, 'g'),
	`perspective/${m.from}`,
	`perspective/${m.to}`,
]);

function walkSources(dir) {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) return [];
		const f = path.join(dir, e.name);
		return e.isDirectory() ? walkSources(f) : SOURCE_EXT.test(e.name) ? [f] : [];
	});
}

/** `[{ file, line, lineNo, from, to, fixed }]` — one entry per offending LINE, so the report names
 *  the edit rather than the file. */
export function scanSources(root) {
	const hits = [];
	for (const d of SOURCE_DIRS) {
		for (const file of walkSources(path.join(root, d))) {
			const text = fs.readFileSync(file, 'utf8');
			if (!SOURCE_PATTERNS.some(([re]) => { re.lastIndex = 0; return re.test(text); })) continue;
			text.split('\n').forEach((line, i) => {
				let fixed = line;
				const found = [];
				for (const [re, from, to] of SOURCE_PATTERNS) {
					re.lastIndex = 0;
					if (!re.test(line)) continue;
					re.lastIndex = 0;
					fixed = fixed.replace(re, to);
					found.push([from, to]);
				}
				if (found.length) hits.push({ file, lineNo: i + 1, line, fixed, moves: found });
			});
		}
	}
	return hits;
}

/** Apply what `scanSources` found, line by line, so nothing else about the file moves. */
export function rewriteSources(hits) {
	const byFile = new Map();
	for (const h of hits) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h]);
	for (const [file, list] of byFile) {
		const lines = fs.readFileSync(file, 'utf8').split('\n');
		for (const h of list) lines[h.lineNo - 1] = h.fixed;
		fs.writeFileSync(file, lines.join('\n'));
	}
	return byFile.size;
}

/** Everything the migration would do, computed without touching a byte. */
export function plan(root, { dataRoot } = {}) {
	const DATA = dataRoot ?? path.join(root, 'data');
	const P = path.join(DATA, 'perspective');
	const moves = [];        // { from, to }
	const edits = new Map(); // absolute NEW path → collection name (post-move)
	const refusals = [];
	const counts = {};

	for (const m of MOVES) {
		const src = path.join(P, m.from);
		if (!fs.existsSync(src)) continue;
		const dest = path.join(P, ...m.to.split('/'));
		if (fs.existsSync(dest)) {
			refusals.push(`${path.relative(root, dest)} already exists — move or remove it first; nothing was migrated`);
			continue;
		}
		for (const file of walk(src)) {
			if (!file.endsWith('.md')) { refusals.push(`${path.relative(root, file)} is not a record file`); continue; }
			const rel = path.relative(src, file);
			if (!rel.endsWith(`.${m.suffix}.md`)) {
				refusals.push(`${path.relative(root, file)} does not carry the .${m.suffix}.md suffix — decide what it is before migrating`);
				continue;
			}
			const id = rel.slice(0, -`.${m.suffix}.md`.length);
			const to = path.join(dest, `${id}.${m.newSuffix}.md`);
			moves.push({ from: file, to });
			edits.set(to, m.to);
			counts[m.to] = (counts[m.to] ?? 0) + 1;
		}
	}

	// The sources fold is an edit in place — the collection does not move.
	const sourcesDir = path.join(P, 'sources');
	const sourceEdits = walk(sourcesDir).filter((f) => f.endsWith('.md'));
	for (const f of sourceEdits) edits.set(f, 'sources');
	if (sourceEdits.length) counts.sources = sourceEdits.length;

	// And every OTHER record in the tree may carry a reference to something that moved.
	const others = walk(DATA).filter((f) => f.endsWith('.md') && !edits.has(f) && !moves.some((mv) => mv.from === f));

	return { root, dataRoot: DATA, moves, edits, others, refusals, counts, sourceHits: scanSources(root) };
}

/** Perform the plan. Throws on any refusal — a partial migration is worse than none. */
export function apply(p) {
	if (p.refusals.length) throw new Error(`refusing to migrate:\n  ${p.refusals.join('\n  ')}`);
	for (const { from, to } of p.moves) {
		fs.mkdirSync(path.dirname(to), { recursive: true });
		fs.renameSync(from, to);
	}
	for (const [file, collection] of p.edits) {
		const text = fs.readFileSync(file, 'utf8');
		const split = splitRecord(text);
		const next = split
			? `---\n${rewriteRefs(editFrontmatter(split.fm, collection))}\n---\n${rewriteRefs(split.body)}`
			: rewriteRefs(text);
		if (next !== text) fs.writeFileSync(file, next);
	}
	for (const file of p.others) {
		const text = fs.readFileSync(file, 'utf8');
		const next = rewriteRefs(text);
		if (next !== text) fs.writeFileSync(file, next);
	}
	// The emptied folders, so a second run has nothing to find and `check` reports no strays.
	for (const m of MOVES) {
		const dir = path.join(p.dataRoot, 'perspective', m.from);
		if (fs.existsSync(dir) && walk(dir).length === 0) fs.rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * Every collection this module stamps a GENERATED MIRROR onto.
 *
 * ⚠ MEASURED, NOT ANTICIPATED. The fixtures could not see this and a live walk did: the migration
 * writes records as raw files, so the engine's mirrors (`retrospective-sessions.sources`,
 * `world/projects.activities`, `world/users.activities`, `world/activities.goals`) still hold the
 * PRE-MOVE refs — and `check` correctly reported five `stale` violations over a tree that was
 * otherwise perfectly migrated. Read out of the descriptors rather than listed here, so a relation
 * added later cannot be forgotten; `bin/migrate.mjs` does the same thing for the same reason.
 */
function mirrorTargets() {
	const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
		? walk(path.join(dir, e.name))
		: e.name.endsWith('.collection.yaml') ? [path.join(dir, e.name)] : []));
	const out = new Set();
	for (const f of walk(COLLECTIONS)) {
		const props = (yaml.load(fs.readFileSync(f, 'utf8')) ?? {}).schema?.properties ?? {};
		for (const s of Object.values(props)) {
			if (!(s?.['x-inverse'] || s?.['x-inverse-of'] || s?.items?.['x-inverse'])) continue;
			const ref = s['x-reference'] ?? s.items?.['x-reference'];
			for (const r of typeof ref === 'string' ? [ref] : Array.isArray(ref) ? ref : []) out.add(r);
		}
	}
	return [...out].sort();
}

const dirty = (root) => {
	const r = spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
	return r.status === 0 && r.stdout.trim() ? r.stdout.trim().split('\n').length : 0;
};

const engine = (root, args) => spawnSync(process.execPath,
	[path.join(root, 'node_modules', 'dreamteamer', 'bin', 'dreamteamer.js'), ...args],
	{ cwd: root, encoding: 'utf8' });

export function main(argv, root) {
	const flag = (n) => argv.includes(`--${n}`);
	const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
	const dryRun = flag('dry-run');

	if (!dryRun && !flag('allow-dirty')) {
		const n = dirty(root);
		if (n) {
			console.error(`✖ ${n} uncommitted change(s) — commit or stash first, so the migration is ONE reviewable diff.`);
			console.error('  (--allow-dirty overrides this; --dry-run never writes anything.)');
			return 1;
		}
	}

	const p = plan(root, { dataRoot: opt('data-root') });

	// ⚠ THE CONSUMER'S OWN SOURCES, FIRST AND BEFORE ANY COMPILE. A `compile` run against renamed
	// collections while an overlay still names the old one fails with a message about a missing base,
	// not about the file to edit — so the operator is left reading a compile internal. See
	// `scanSources`.
	if (p.sourceHits.length) {
		const files = [...new Set(p.sourceHits.map((h) => h.file))];
		if (flag('rewrite-sources')) {
			const n = rewriteSources(p.sourceHits);
			console.log(`  ✎ rewrote ${p.sourceHits.length} line(s) in ${n} of this workspace's own source file(s):`);
			for (const h of p.sourceHits) console.log(`      ${path.relative(root, h.file)}:${h.lineNo}  ${h.line.trim()}\n        → ${h.fixed.trim()}`);
			p.sourceHits = [];
		} else {
			console.error(`\n  ✖ ${files.length} of THIS WORKSPACE'S OWN source file(s) name a collection this migration renames.`);
			console.error('    They are not records, so the record migration does not sweep them — and compile FAILS on');
			console.error('    them afterwards with a message about a missing base, not about the file to edit.\n');
			for (const h of p.sourceHits) {
				console.error(`    ${path.relative(root, h.file)}:${h.lineNo}`);
				console.error(`        ${h.line.trim()}`);
				console.error(`      → ${h.fixed.trim()}`);
			}
			console.error('\n    Edit them yourself — worth doing, because a source naming a collection that moved is often');
			console.error('    obsolete for its own reasons and only reading it will say so — or re-run with');
			console.error('    --rewrite-sources to apply exactly the edits above.');
			return 1;
		}
	}

	const total = Object.values(p.counts).reduce((a, b) => a + b, 0);
	console.log(`  ${p.moves.length} record(s) move, ${p.edits.size} edited in place, ${p.others.length} swept for references`);
	for (const [c, n] of Object.entries(p.counts).sort()) console.log(`  ${String(n).padStart(6)}  ${c}`);
	if (p.refusals.length) {
		console.error(`\n  ✖ refusing to migrate — ${p.refusals.length} thing(s) this cannot decide for you:`);
		for (const r of p.refusals) console.error(`    ${r}`);
		return 1;
	}
	if (!p.moves.length && !total) {
		console.log('\n  ✔ nothing to migrate — this workspace holds no pre-0.7.0 perspective records.');
		return 0;
	}
	if (dryRun) { console.log('\n  (--dry-run — nothing was written)'); return 0; }

	apply(p);
	console.log('\n  ✔ moved. Now the two commands that say whether it worked:\n');
	const compiled = engine(root, ['compile']);
	process.stdout.write(compiled.stdout); process.stderr.write(compiled.stderr);
	if (compiled.status !== 0) {
		console.error('\n  ✖ the workspace does not COMPILE — stopping here rather than reporting a check over a stale schema.');
		return 1;
	}
	// ⚠ REBUILD THE MIRRORS BEFORE CHECKING. See `mirrorTargets` — a raw-file migration leaves every
	// generated mirror holding the pre-move refs, and `check` is right to call them stale.
	for (const c of mirrorTargets()) {
		const r = engine(root, ['relations', 'rebuild', c]);
		if (r.status !== 0) process.stderr.write(`  ▲ relations rebuild ${c}: ${(r.stderr ?? '').trim()}\n`);
	}
	const checked = engine(root, ['check']);
	process.stdout.write(checked.stdout); process.stderr.write(checked.stderr);
	console.log('\n  ⚠ THIS is the result that says whether the migration worked — not the summary above it.');
	console.log('  Then run the module guard:  node node_modules/@dreamteamer/extensions/modules/perspective/bin/check-records.mjs');
	return checked.status === 0 ? 0 : 1;
}

// ── run as a script ──────────────────────────────────────────────────────────────────────────────
// Both sides realpath'd: reached through a symlink (`node_modules/.bin`, a `git_modules/` clone) the
// invoked path and the resolved one differ, and a guard that never fires reads as a clean run.
const __isMain = () => {
	if (!process.argv[1]) return false;
	const real = (p) => { try { return __fs.realpathSync(p); } catch { return __path.resolve(p); } };
	return real(process.argv[1]) === real(__fileURLToPath(import.meta.url));
};
if (__isMain()) {
	const { findWorkspace } = await import('../lib/workspace-root.mjs');
	const ws = findWorkspace();
	if (!ws) { console.error('Not inside a dreamteamer workspace — run this from the folder with package.json and package-lock.json.'); process.exit(1); }
	process.exit(await main(process.argv.slice(2), ws));
}
