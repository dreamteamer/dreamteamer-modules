#!/usr/bin/env node
// migrate — the one-shot move from `introspection` to `perspective`, for a workspace that already
// holds records. There is no backward compatibility anywhere else in this package; this file is the
// single place the old spelling is legal, because matching it on disk is its entire job.
//
//   node node_modules/@dreamteamer/perspective/bin/migrate.mjs [--dry-run] [--contributor <slug>] [--allow-dirty] [--data-root <d>]
//
// ⚠ WHAT IT IS ACTUALLY FOR, and why it is not a `sed`. Three things change at once and only one of
// them is a rename:
//
//   1. The namespace, the collection and the record suffix are renamed.
//   2. Every evidence and model record is RE-KEYED from the run to the CONTRIBUTOR, so a second
//      retrospective updates this person's model instead of writing a parallel copy beside it. That
//      changes ids, which changes every reference pointing at them — in bodies as well as
//      frontmatter — so the new id of every record must be known BEFORE a single reference is
//      rewritten.
//   3. Two link fields (`introspective` on eleven collections, `session` on four) become one named
//      `retrospective`, four fields become engine-generated mirrors and must be dropped, and the run
//      record's `contributor` — which held an ADDRESS — moves to `handles` while `contributor`
//      becomes the slug the ids are keyed by.
//
// ⚠ AND WHAT IT REFUSES TO DO. A frontmatter key that no descriptor declares is not dropped: it is
// reported, and the migration refuses. Silently discarding a field somebody wrote is the one
// failure a migration cannot be forgiven, and the alternative costs the operator one look at a list.
//
// The descriptors are read from THIS package at run time rather than restated here, so the set of
// legal fields, the run-layer collections and the mirror targets cannot drift from the schema that
// will validate the result.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
// this module's own root (bin/..), the same place on every channel
const COLLECTIONS = path.join(PKG, 'collections', 'perspective');

/**
 * Old record folder → the collection it is TODAY. Two moves are folded into one migration on
 * purpose: a workspace still on 0.1.x would otherwise have to run this and then `migrate-world`, and
 * the intermediate state (records under `data/perspective/activities`, which no collection claims any
 * more) fails the `dreamteamer check` this migration ends by running. One command, one end state.
 *   0.2.0  `introspectives` → `retrospective-sessions`
 *   0.7.0  the observed world moves into the `perspective/world` namespace, in the real world's nouns
 *   0.9.0  the world layer grows to the WHOLE projects model — `decisions` and `deliverables` join it
 */
const RENAMED = {
	introspectives: 'retrospective-sessions',
	activities: 'activities',
	projects: 'projects',
	collaborators: 'users',
	goals: 'goals',
	// ⚠ 0.9.0. These two were top-level `perspective/*` collections through 0.8.0 and are world
	// objects like any other — leaving them outside meant the one namespace that models the observed
	// world was missing the object that explains most of it. A workspace migrating straight from
	// `introspection` lands on the CURRENT name, which is why the map is keyed by the oldest spelling
	// and valued by the newest rather than chained.
	decisions: 'decisions',
	deliverables: 'deliverables',
};

/**
 * A field that changed NAME, keyed `<collection>.<old>`. The world namespace spells a field the way
 * the real collection spells it wherever the two mean the same thing, so `goals` picked up `goals`'
 * own words. The value is untouched — only the key moves.
 */
const FIELD_RENAMES = {
	'goals.statement': 'done_when',
	'goals.horizon': 'status',
};

// ── the old id shapes ────────────────────────────────────────────────────────────────────────────
// The one thing that cannot be read off the new descriptors, because it describes the world before
// them. Three kinds, measured against all 5,521 live records (2026-09-09): every one keys cleanly.
//
//   PREPEND  the old id carried no run segment at all — these hang off a `source`, and the
//            contributor is derived by walking that reference back to the run.
//   WHOLE    the old id WAS the run id, with nothing after it.
//   (else)   the old id began with the run id; that first segment becomes the contributor.
const PREPEND = new Set(['activity-weeks', 'threads', 'tickets', 'conversations']);
const WHOLE = new Set(['perspectives']);

/** Fields deleted in 0.2.0. Each is dropped WITH a stated reason, and counted in the plan. */
const DROP = {
	'retrospective-sessions.label': 'the contributor slug is the id now; label was a second name for the same thing',
	'retrospective-sessions.perspective': 'a generated mirror of perspectives.retrospective',
	'retrospective-sessions.sources': 'a generated mirror of sources.retrospective',
	'retrospective-sessions.proposals': 'a generated mirror of proposals.retrospective',
	'projects.activities_count': 'a real count off the generated activities mirror, not a hand-kept integer',
	'deliverables.activities': 'a generated mirror of activities.deliverables',
	// `sources` is MANY-TO-MANY with the run since 0.7.0 — `retrospectives` is the list, and a run id
	// begins with its own start date, so first-seen and last-seen are a sort rather than two fields.
	'sources.last_seen_in': 'sources.retrospectives is the list now; a sorted list gives first, last and everything between',
};

/** Set when absent, because the field is new and its default is what the old records meant. */
const DEFAULTS = { 'concepts.kind': 'term' };

const RUN_LINKS = ['introspective', 'session'];
const DATE = /^(\d{4}-\d{2}-\d{2})--/;

// ── reading the schema this migration targets ────────────────────────────────────────────────────
function schema() {
	// the provenance quad is declared inline in every descriptor since 2026-10-01 — no template to merge
	const out = {};
	// ⚠ RECURSIVE. `collections/perspective/world/*.collection.yaml` is a namespaced descriptor and
	// compile enumerates the folder recursively; a flat readdir here saw four fewer collections than
	// exist and refused every record belonging to one of them, naming it "not a collection this
	// package knows" — which was true of the reader, not of the package.
	const walkDescriptors = (dir, prefix = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walkDescriptors(path.join(dir, e.name), `${prefix}${e.name}/`)
			: e.name.endsWith('.collection.yaml') ? [[`${prefix}${e.name}`, path.join(dir, e.name)]] : []);
	for (const [f, full] of walkDescriptors(COLLECTIONS)) {
		const d = yaml.load(fs.readFileSync(full, 'utf8'));
		const props = d.schema?.properties ?? {};
		out[f.replace('.collection.yaml', '')] = {
			props: new Set(Object.keys(props)),
			suffix: d.storage.suffix,
			// A collection with no `contributor` of its own is run-layer: the run names the person,
			// and a question does not repeat it. That is the same rule tests/run-link.test.mjs asserts.
			runLayer: !('contributor' in props),
			mirrorTargets: Object.values(props).flatMap((s) => {
				if (!(s?.['x-inverse'] || s?.['x-inverse-of'])) return [];
				const ref = s['x-reference'] ?? s.items?.['x-reference'];
				return typeof ref === 'string' ? [ref] : Array.isArray(ref) ? ref : [];
			}),
		};
	}
	return out;
}

// ── frontmatter, edited by line so nothing else about the file moves ─────────────────────────────
// ⚠ Deliberately NOT a yaml round-trip. Re-emitting 5,521 records through js-yaml would requote
// every string, reflow every block scalar and reorder nothing but touch everything — a diff nobody
// can review, over records a person wrote. These edits are surgical: a key renamed, a key removed,
// a key inserted. Everything else is left byte-for-byte.
// ⚠ A KEY MAY BE QUOTED, and one of them always is. `n` is a YAML 1.1 boolean token, so every
// writer emits the question number as `'n': 1` — and a pattern that only recognises a bare key reads
// that as a CONTINUATION of the line above it. When the line above is the run link being rewritten,
// the quoted key is dropped with it. That is how 51 live questions across two workspaces lost their
// `n` on the first run against real records, while the fixture — which spelled it bare — passed.
const KEY = /^(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_-]*)):(.*)$/;

/** Split a frontmatter block into `[{ key, lines }]`, preserving each key's continuation lines. */
function blocks(fmText) {
	const out = [];
	for (const line of fmText.split('\n')) {
		const m = KEY.exec(line);
		if (m) out.push({ key: m[1] ?? m[2] ?? m[3], raw: line.slice(0, line.length - m[4].length - 1), value: m[4].trim(), lines: [line] });
		else if (out.length) out[out.length - 1].lines.push(line);
		else out.push({ key: null, value: '', lines: [line] });
	}
	return out;
}

function splitRecord(text) {
	const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
	if (!m) return null;
	return { fm: m[1], body: text.slice(m[0].length) };
}

// ── planning ─────────────────────────────────────────────────────────────────────────────────────
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
	e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : []);

const stripDate = (seg) => seg.replace(DATE, '');

/**
 * Everything the migration would do, computed without touching a byte.
 *
 * Returns `{ contributor, runs, moves, edits, refs, drops, refusals, counts }`. `refusals` being
 * non-empty is the whole answer: `apply` throws rather than proceeding.
 */
export function plan(root, { contributor: override, dataRoot } = {}) {
	const S = schema();
	const OLD = path.join(dataRoot ?? path.join(root, 'data'), 'introspection');
	const NEWROOT = path.join(dataRoot ?? path.join(root, 'data'), 'perspective');
	const refusals = [];
	const drops = {};
	const counts = {};
	const moves = [];
	const edits = new Map();      // new absolute path → { collection, contributor, run }
	const refs = new Map();       // old ref → new ref

	if (!fs.existsSync(OLD)) return { contributor: override ?? null, runs: [], moves, edits, refs, drops, refusals, counts, oldRoot: OLD, newRoot: NEWROOT };

	const runsDir = path.join(OLD, 'introspectives');
	const runs = fs.existsSync(runsDir)
		? fs.readdirSync(runsDir).filter((f) => f.endsWith('.introspective.md')).map((f) => f.replace(/\.introspective\.md$/, ''))
		: [];
	if (!runs.length && !override) refusals.push(`no run records under ${runsDir} — nothing says who these records are about; pass --contributor <slug>`);

	const slugOfRun = (runId) => override ?? stripDate(runId);
	const contributor = override ?? (runs.length === 1 ? stripDate(runs[0]) : null);

	// PASS 1 — every record's new id, before any reference is rewritten.
	// ⚠ The order is the whole design. A reference to a record that is itself being re-keyed can only
	// be resolved once BOTH ids are known, so nothing is written until every id is decided.
	const sourceRunOf = new Map();   // old sources ref → run id, for the four collections with no run link
	for (const file of walk(path.join(OLD, 'sources'))) {
		const id = path.relative(path.join(OLD, 'sources'), file).replace(/\.source\.md$/, '');
		sourceRunOf.set(`introspection/sources/${id}`, id.split('/')[0]);
	}

	const records = [];
	for (const oldColl of fs.existsSync(OLD) ? fs.readdirSync(OLD).filter((d) => fs.statSync(path.join(OLD, d)).isDirectory()) : []) {
		const coll = RENAMED[oldColl] ?? oldColl;
		const spec = S[coll];
		if (!spec) { refusals.push(`data/introspection/${oldColl} has no descriptor in this package — it is not a collection 0.2.0 knows`); continue; }
		for (const file of walk(path.join(OLD, oldColl))) {
			const rel = path.relative(path.join(OLD, oldColl), file);
			const sfxMatch = /\.([a-z][a-z-]*)\.md$/.exec(rel);
			if (!sfxMatch) { refusals.push(`${path.relative(root, file)} is not a record file`); continue; }
			const oldId = rel.slice(0, -sfxMatch[0].length);
			const text = fs.readFileSync(file, 'utf8');
			const split = splitRecord(text);
			if (!split) { refusals.push(`${path.relative(root, file)} has no frontmatter`); continue; }
			let fields;
			try { fields = yaml.load(split.fm) ?? {}; }
			catch (e) { refusals.push(`${path.relative(root, file)}: frontmatter does not parse — ${e.message}`); continue; }

			// WHO. Three routes, one per old id shape.
			let run, slug;
			if (coll === 'retrospective-sessions') { run = oldId; slug = slugOfRun(oldId); }
			else if (PREPEND.has(coll)) {
				const src = fields.source ? String(fields.source) : '';
				run = sourceRunOf.get(src);
				if (!run) { refusals.push(`${path.relative(root, file)}: source "${src || '(none)'}" does not resolve to a run, so no contributor can be derived`); continue; }
				slug = slugOfRun(run);
			} else {
				run = WHOLE.has(coll) ? oldId : oldId.split('/')[0];
				if (!runs.includes(run) && !override) { refusals.push(`${path.relative(root, file)}: first id segment "${run}" is not one of the runs (${runs.join(', ') || 'none'})`); continue; }
				slug = slugOfRun(run);
			}

			const newId = coll === 'retrospective-sessions' || spec.runLayer ? oldId
				: WHOLE.has(coll) ? slug
				: PREPEND.has(coll) ? `${slug}/${oldId}`
				: `${slug}/${oldId.split('/').slice(1).join('/')}`;

			const to = path.join(NEWROOT, coll, `${newId}.${spec.suffix}.md`);
			refs.set(`introspection/${oldColl}/${oldId}`, `perspective/${coll}/${newId}`);
			records.push({ file, to, coll, spec, oldId, newId, slug, run, fields, split });
			counts[coll] = (counts[coll] ?? 0) + 1;
		}
	}

	// PASS 2 — the per-file edit, now that every id is known.
	for (const r of records) {
		const runRef = `perspective/retrospective-sessions/${r.run}`;
		const unknown = [];
		for (const k of Object.keys(r.fields)) {
			if (RUN_LINKS.includes(k)) continue;
			if (`${r.coll}.${k}` in DROP) { drops[`${r.coll}.${k}`] = (drops[`${r.coll}.${k}`] ?? 0) + 1; continue; }
			if (k === 'contributor') continue;   // rewritten below: the slug, or on the run record `handles`
			if (!r.spec.props.has(k)) unknown.push(k);
		}
		if (unknown.length) {
			refusals.push(`${path.relative(root, r.file)}: no descriptor declares ${unknown.map((k) => `\`${k}\``).join(', ')} — decide what these should become before migrating`);
			continue;
		}
		moves.push({ from: r.file, to: r.to });
		edits.set(r.to, r);
		r.runRef = runRef;
	}

	const refCtx = {
		known: new Set(Object.keys(S)),
		runLayer: new Set(Object.entries(S).filter(([, v]) => v.runLayer).map(([k]) => k)),
		slugOf: slugOfRun,
	};
	return { contributor, runs, moves, edits, refs, drops, refusals, counts, refCtx, oldRoot: OLD, newRoot: NEWROOT, mirrorTargets: [...new Set(Object.values(S).flatMap((s) => s.mirrorTargets))].sort() };
}

// ── applying ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Everything that is not a whole record id but still names the old world — a collection cited in
 * prose (`introspection/deliverables`), a wildcard over a run's records
 * (`introspection/questions/<run>/*`), a truncated id in a sentence.
 *
 * ⚠ Measured, not guessed: across the three live workspaces exactly 16 tokens fell through the id
 * map, and every one of them was of this shape. Left alone they are 43 files that still say
 * `introspection` after a migration whose whole promise is that nothing does. Rewritten by hand they
 * are 16 judgement calls nobody should have to make twice.
 *
 * ⚠ And what it must NOT touch: the word in prose. One live `topics` record is literally named
 * "introspection module development" — that is what the person worked on, and a migration that
 * renames the subject of somebody's work has falsified the record. Only a `<known collection>/`
 * prefix is rewritten; a bare mention has no slash and never matches.
 */
function fallbackRef(token, ctx) {
	const m = /^introspection\/([a-z][a-z-]*)((?:\/[^\s]*)?)$/.exec(token);
	if (!m) return null;
	const coll = RENAMED[m[1]] ?? m[1];
	if (!ctx.known.has(coll)) return null;
	let rest = m[2];
	// Re-key the run segment the same way a real id is re-keyed, when one is there to re-key.
	const seg = /^\/(\d{4}-\d{2}-\d{2}--[a-z0-9-]+)(\/.*|\/?)$/.exec(rest);
	if (seg && !ctx.runLayer.has(coll)) rest = `/${ctx.slugOf(seg[1])}${seg[2]}`;
	return `perspective/${coll}${rest}`;
}

/** Rewrite every `introspection/<collection>/<id>` in a blob to the id it now has. */
function rewriteRefs(text, refs, unresolved, ctx) {
	return text.replace(/introspection\/[A-Za-z0-9_@./-]+/g, (m) => {
		if (refs.has(m)) return refs.get(m);
		// A reference at the end of a sentence, or inside brackets, carries punctuation with it.
		const trimmed = m.replace(/[.,;:)\]]+$/, '');
		if (refs.has(trimmed)) return refs.get(trimmed) + m.slice(trimmed.length);
		const fb = fallbackRef(trimmed, ctx);
		if (fb) { unresolved.add(`${trimmed}  →  ${fb}`); return fb + m.slice(trimmed.length); }
		unresolved.add(m);
		return m;
	});
}

/**
 * The run link, as the collection spells it. Every collection but one carries the scalar
 * `retrospective`; `sources` carries the LIST `retrospectives`, because a source is durable and every
 * run re-reads it, so the relation was many-to-many all along.
 */
function runLinkLines(r) {
	return r.coll === 'sources' ? ['retrospectives:', `  - ${r.runRef}`] : [`retrospective: ${r.runRef}`];
}

function editFrontmatter(r) {
	const out = [];
	let sawRun = false;
	for (const b of blocks(r.split.fm)) {
		if (b.key === null) { out.push(...b.lines); continue; }
		if (`${r.coll}.${b.key}` in DROP) continue;
		if (RUN_LINKS.includes(b.key)) {
			if (b.lines.length > 1) throw new Error(`${r.file}: ${b.key} spans several lines; a run link is a single reference`);
			out.push(...runLinkLines(r));
			if (!r.spec.runLayer) out.push(`contributor: ${r.slug}`);
			sawRun = true;
			continue;
		}
		// A key that only changed NAME: emit the new key and every continuation line unchanged, so a
		// block scalar or a list under it survives byte for byte.
		const renamed = FIELD_RENAMES[`${r.coll}.${b.key}`];
		if (renamed) {
			out.push(`${renamed}:${b.lines[0].slice(b.raw.length + 1)}`, ...b.lines.slice(1));
			continue;
		}
		if (b.key === 'contributor') {
			if (b.lines.length > 1) throw new Error(`${r.file}: contributor spans several lines`);
			// ⚠ OVERWRITTEN, NEVER KEPT. 764 live records across the three workspaces carry
			// `contributor: introspection/collaborators/<run>/<name>` — a REFERENCE, written by a
			// backfill script that outlived the design it belonged to. The field is an id segment
			// now and its `pattern` refuses anything but a slug, so keeping the old value would
			// fail `check` on every one of them; inserting beside it would make a duplicate key and
			// fail the YAML parse instead. On the run record the old value is an ADDRESS, which is
			// a handle, and handles have a field.
			if (r.coll === 'retrospective-sessions' && b.value) out.push('handles:', `  - ${b.value}`);
			continue;
		}
		out.push(...b.lines);
	}
	// A collection with no run link of its own (activity-weeks, threads, tickets, conversations)
	// still needs one: `retrospective` is REQUIRED on all nineteen.
	if (!sawRun && r.coll !== 'retrospective-sessions') {
		out.unshift(...(r.spec.runLayer ? [] : [`contributor: ${r.slug}`]));
		out.unshift(...runLinkLines(r));
	}
	if (r.coll === 'retrospective-sessions') out.unshift(`contributor: ${r.slug}`);
	for (const [key, value] of Object.entries(DEFAULTS)) {
		const [coll, field] = key.split('.');
		if (r.coll === coll && !(field in r.fields)) out.push(`${field}: ${value}`);
	}
	return out.join('\n');
}

/**
 * Every key the edited record must end up with — computed from the original, so a key that
 * disappears for any reason at all is caught rather than shipped.
 *
 * ⚠ This exists because the quoted-key bug above lost a REQUIRED field on 51 records and the only
 * thing that noticed was `dreamteamer check`, two steps later, on data the operator would already
 * have had rewritten. A migration may rename a field, drop one it names, or add one — it may never
 * simply lose one, and the difference is worth asserting per record rather than trusting.
 */
function expectedKeys(r) {
	const keys = new Set(Object.keys(r.fields));
	for (const k of [...keys]) if (`${r.coll}.${k}` in DROP) keys.delete(k);
	for (const k of RUN_LINKS) keys.delete(k);
	if (r.coll === 'retrospective-sessions') {
		if (r.fields.contributor) keys.add('handles');
		keys.add('contributor');
	} else {
		keys.add(r.coll === 'sources' ? 'retrospectives' : 'retrospective');
		if (r.coll === 'sources') keys.delete('retrospective');
		if (r.spec.runLayer) keys.delete('contributor'); else keys.add('contributor');
	}
	for (const k of [...keys]) {
		const to = FIELD_RENAMES[`${r.coll}.${k}`];
		if (to) { keys.delete(k); keys.add(to); }
	}
	for (const key of Object.keys(DEFAULTS)) {
		const [coll, field] = key.split('.');
		if (r.coll === coll) keys.add(field);
	}
	return keys;
}

/** Perform the plan. Throws on any refusal — a partial migration is worse than none. */
export function apply(root, p) {
	if (p.refusals.length) throw new Error(`refusing to migrate:\n  ${p.refusals.join('\n  ')}`);
	const unresolved = new Set();
	const ctx = p.refCtx;
	for (const { from, to } of p.moves) {
		const r = p.edits.get(to);
		const fm = rewriteRefs(editFrontmatter(r), p.refs, unresolved, ctx);
		const want = expectedKeys(r);
		let got;
		try { got = new Set(Object.keys(yaml.load(fm) ?? {})); }
		catch (e) { throw new Error(`${path.relative(root, from)}: the edited frontmatter does not parse — ${e.message}`); }
		const lost = [...want].filter((k) => !got.has(k));
		const gained = [...got].filter((k) => !want.has(k));
		if (lost.length || gained.length) {
			throw new Error(`${path.relative(root, from)}: the edit changed the key set in a way it was not asked to`
				+ (lost.length ? `\n    lost: ${lost.join(', ')}` : '')
				+ (gained.length ? `\n    gained: ${gained.join(', ')}` : ''));
		}
		const body = rewriteRefs(r.split.body, p.refs, unresolved, ctx);
		fs.mkdirSync(path.dirname(to), { recursive: true });
		fs.writeFileSync(to, `---\n${fm}\n---\n${body}`);
		fs.rmSync(from);
	}
	// The old tree, now empty of records, goes with them.
	if (fs.existsSync(p.oldRoot) && !walk(p.oldRoot).length) fs.rmSync(p.oldRoot, { recursive: true, force: true });
	return { moved: p.moves.length, unresolved: [...unresolved].sort() };
}

// ── the CLI ──────────────────────────────────────────────────────────────────────────────────────
/** ⚠ RUN AS A SCRIPT — AND THROUGH A SYMLINK. `process.argv[1]` is the path as INVOKED and
 *  `import.meta.url` the path RESOLVED; under preview mode this module is reached through a
 *  `git_modules/<name>` symlink into a clone elsewhere, so the two are different strings for the same
 *  file and a `===` between them is false. The entry guard then never fires — no output, exit 0, and
 *  a reader sees a clean run. Measured 2026-09-11; `tests/script-entry.test.mjs` holds it. */
const isMainFn = () => {
	if (!process.argv[1]) return false;
	const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
	return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
};

const isMain = isMainFn();
if (isMain) main(process.argv.slice(2));

export function main(argv, root = process.cwd()) {
	const flag = (n) => argv.includes(`--${n}`);
	const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
	const dry = flag('dry-run');

	const git = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
	if (!dry && git.status === 0 && git.stdout.trim() && !flag('allow-dirty')) {
		console.error('refusing to migrate a dirty tree — commit or stash first, so the migration is one reviewable diff.');
		console.error('  (--allow-dirty if you really mean to mix it with uncommitted work)');
		return 1;
	}

	let p;
	try { p = plan(root, { contributor: opt('contributor'), dataRoot: opt('data-root') }); }
	catch (e) { console.error(e.message); return 1; }

	const total = Object.values(p.counts).reduce((n, x) => n + x, 0);
	if (!total) { console.log('nothing to migrate — no data/introspection in this workspace.'); return 0; }

	console.log(`\n  ${total} records under data/introspection · runs: ${p.runs.join(', ') || '(none)'} · contributor: ${p.contributor ?? '(per record)'}\n`);
	for (const [c, n] of Object.entries(p.counts).sort()) console.log(`    ${String(n).padStart(6)}  ${c}`);
	if (Object.keys(p.drops).length) {
		console.log('\n  fields dropped, each because 0.2.0 generates or replaces it:');
		for (const [k, n] of Object.entries(p.drops).sort()) console.log(`    ${String(n).padStart(6)}  ${k} — ${DROP[k]}`);
	}
	if (p.refusals.length) {
		console.error(`\n  ✖ refusing to migrate — ${p.refusals.length} thing${p.refusals.length === 1 ? '' : 's'} this cannot decide for you:\n`);
		for (const r of p.refusals) console.error(`    ${r}`);
		return 1;
	}
	if (dry) { console.log('\n  --dry-run: nothing written.\n'); return 0; }

	const { moved, unresolved } = apply(root, p);
	console.log(`\n  ✔ ${moved} records moved and rewritten.`);
	if (unresolved.length) {
		const guessed = unresolved.filter((u) => u.includes('  →  '));
		const left = unresolved.filter((u) => !u.includes('  →  '));
		if (guessed.length) {
			console.log(`\n  ▲ ${guessed.length} token${guessed.length === 1 ? ' was' : 's were'} not a whole record id — the collection prefix was rewritten, the rest left alone:`);
			for (const u of guessed.slice(0, 20)) console.log(`    ${u}`);
		}
		if (left.length) {
			console.log(`\n  ▲ ${left.length} reference${left.length === 1 ? '' : 's'} matched nothing at all and ${left.length === 1 ? 'was' : 'were'} left as ${left.length === 1 ? 'it is' : 'they are'}:`);
			for (const u of left.slice(0, 20)) console.log(`    ${u}`);
		}
	}

	// The scratch tree and the line that ignores it.
	for (const [from, to] of [['.introspection', '.perspective']]) {
		const a = path.join(root, from);
		if (fs.existsSync(a) && !fs.existsSync(path.join(root, to))) { fs.renameSync(a, path.join(root, to)); console.log(`  ✔ ${from}/ → ${to}/`); }
	}
	const gi = path.join(root, '.gitignore');
	if (fs.existsSync(gi)) {
		const before = fs.readFileSync(gi, 'utf8');
		const after = before.split('.introspection').join('.perspective');
		if (after !== before) { fs.writeFileSync(gi, after); console.log('  ✔ .gitignore'); }
	}

    // ⚠ THE MIRRORS ARE STALE THE MOMENT THIS WRITES A FILE. `x-inverse` mirrors are maintained by
    // the engine on every `dt` write, and this wrote 5,000 files directly — so `check` would report
    // every one of them stale. Rebuilding is part of the migration, not a chore left behind.
	const dt = (args) => {
		const bin = path.join(root, 'node_modules', 'dreamteamer', 'bin', 'dreamteamer.js');
		if (!fs.existsSync(bin)) return null;
		return spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8' });
	};
	console.log('\n  compiling…');
	const compiled = dt(['compile']);
	if (!compiled) { console.log('  (no engine in node_modules — run compile, relations rebuild and check yourself)'); return 0; }
	process.stdout.write(compiled.stdout); process.stderr.write(compiled.stderr);

	// ⚠ STOP HERE IF COMPILE FAILED, and the reason is the most alarming thing this release found.
	// On the first real workspace, compile refused on a ui-view name collision the migration had
	// nothing to do with. Everything downstream then ran against the STALE compiled schema — every
	// `relations rebuild` failed with "unknown collection perspective/…", and `check` printed
	//
	//     ✔ 0 violations (63 records across 32 collections)
	//
	// for a workspace holding 282 migrated records. It was not lying: the old schema knew none of the
	// new collections, so `check` validated the 63 records in collections it still recognised and
	// skipped the rest in silence. A tick over the wrong record set is worse than a failure, because
	// somebody reads it and stops looking.
	if (compiled.status !== 0) {
		console.error('\n  ✖ the records were migrated, but this workspace does not COMPILE — stopping here.');
		console.error('    Nothing below could tell you anything: relations rebuild and check both read the');
		console.error('    compiled schema, and it is still the old one. Fix what compile named above, run');
		console.error('    `dreamteamer compile`, then run this again — the migration is idempotent.');
		return 1;
	}

	for (const c of p.mirrorTargets ?? []) {
		const r = dt(['relations', 'rebuild', c]);
		if (r?.status !== 0) process.stderr.write(`  ▲ relations rebuild ${c}: ${(r?.stderr ?? '').trim()}\n`);
	}
	console.log('\n  checking — THIS is the result that says whether the migration worked:');
	const checked = dt(['check']);
	process.stdout.write(checked.stdout); process.stderr.write(checked.stderr);

	// ⚠ AND THE TICK MUST COVER WHAT THIS MOVED. Same incident, second half: a clean `check` means
	// nothing unless the number it counted includes the records just written. The workspace holds
	// records this migration never touched, so the count is a floor rather than an equality.
	const counted = Number(/(\d+) records? across/.exec(checked.stdout + checked.stderr)?.[1] ?? NaN);
	if (Number.isFinite(counted) && counted < moved) {
		console.error(`\n  ✖ check counted ${counted} records, but this migration wrote ${moved}.`);
		console.error('    It validated a set that does not include what was migrated — treat the tick above');
		console.error('    as meaningless and find out why the compiled schema does not know these collections.');
		return 1;
	}
	return checked.status === 0 ? 0 : 1;
}
