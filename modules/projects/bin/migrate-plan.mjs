#!/usr/bin/env node
// migrate-plan — `activities.phase` becomes a REFERENCE, for a workspace whose plan was written
// against 0.8.x or earlier, where it was free text.
//
//   node node_modules/@dreamteamer/projects/bin/migrate-plan.mjs [--dry-run] [--allow-dirty] [--data-root <dir>]
//                                  [--id "<phase text>=<id>"]...
//
// WHY THIS IS A MIGRATION AND NOT A NOTE IN A CHANGELOG. The moment `phase` carries
// `x-reference: phases`, every existing value is a reference to a record that does not exist, and
// `dreamteamer check` fails on every activity that has one. There is no gradual path and no
// "compatible for one release": a reference either resolves or it does not. So the package that
// changed the field ships the command that converts the data, exactly as `migrate-world` does — and
// for the same reason `dt rename` cannot be used, since the engine refuses to write a descriptor
// that ships from node_modules.
//
// WHAT IT DERIVES, AND WHAT IT REFUSES TO INVENT. A `phases` record REQUIRES `starts`, because a
// phase with no dates is a lane wearing the wrong name — that is the whole argument for the
// collection. The dates come from the ACTIVITIES that carried the value: `starts` is the earliest
// `starts` among them and `ends` the latest `ends`. Where no activity in a group carries a `starts`
// at all, the phase CANNOT be minted and the group is REFUSED by name — a date invented here would
// be a number nobody measured, drawn on a gantt, indistinguishable from one somebody chose.
//
// AND A PHASE IS PROJECT-SCOPED. Two plans that both said `phase: Discovery` get TWO records, which
// is correct: a stretch of calendar belongs to one plan. An activity carrying a `phase` and no
// `project` cannot be scoped and is refused by name rather than filed under a guess.
//
// AND THE TRAP THAT ONLY A REAL PLAN REVEALS. The engine's `slug` filter drops everything that is
// not `a-z0-9`, so a plan whose phase names are not Latin does not slug to nothing — it slugs to
// whatever Latin fragment happens to be embedded. Measured on the first consumer, 2026-09-11, whose
// eight phase names were Hebrew with a Latin letter in most of them:
//
//     "<hebrew> A - <hebrew>"          -> "a"
//     "<hebrew> A - <hebrew>"          -> "a"          <-- a DIFFERENT phase, the SAME id
//     "<hebrew> A - hyper-care"        -> "a-hyper-care"
//     "<hebrew>"                       -> ""
//
// Four of the eight collapsed onto two ids. Nothing in the original script noticed: both groups were
// planned, both were written, and the second silently overwrote the first — one phase record where
// two belonged, and half the activities pointing at the wrong stretch. So `plan` now REFUSES a
// collision by name, and `--id "<phase text>=<id>"` is how a workspace says what it wants instead.
// A hand-written id is the documented answer for a non-Latin value everywhere else in this package;
// this makes it reachable from the migration rather than only from `dt add`.
//
// Idempotent: a value that already reads as a reference (`phases/...`) is left alone, so a second
// run finds nothing and says so.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/** The engine's own `slug` behaviour for the Latin case, which is the only case that can be an id.
 *  A value with no `a-z0-9` in it slugs to '' — refused below rather than filed under a hash. */
export const slug = (s) => String(s).toLowerCase().normalize('NFKD')
	.replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** A reference as it may be written — `projects/atlas` or the bare id — reduced to the id. */
const idOf = (ref) => String(ref).trim().replace(/^.*\//, '').replace(/^['"]|['"]$/g, '');

/** Group key. A plain separator rather than a control character: project ids are slugs, so `--` in
 *  the middle cannot collide with anything a slug may contain at the boundary. */
const keyOf = (project, phase) => `${project}--::--${phase}`;

const walk = (dir) => (fs.existsSync(dir)
	? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
		? walk(path.join(dir, e.name))
		: [path.join(dir, e.name)]))
	: []);

/** Frontmatter block and body, split. Null when the file has no frontmatter at all. */
export function splitRecord(text) {
	const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
	return m ? { fm: m[1], body: text.slice(m[0].length) } : null;
}

/** One scalar out of a frontmatter block, by key at the head of a line. Quotes stripped. */
export function scalar(fm, key) {
	const m = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(fm);
	if (!m) return undefined;
	const v = m[1].trim().replace(/^['"]|['"]$/g, '');
	return v === '' ? undefined : v;
}

/**
 * Replace one scalar's VALUE in place, leaving every other byte of the frontmatter alone.
 *
 * EDITED BY LINE, never round-tripped through a YAML dumper — the same rule `migrate-world` states
 * and for the same reason: re-emitting a plan's records would requote every string and reflow every
 * block scalar, producing a diff nobody can review over records a person wrote.
 */
export function setScalar(fm, key, value) {
	return fm.replace(new RegExp(`^(${key}:)[ \\t]*.*$`, 'm'), `$1 ${value}`);
}

/**
 * What the migration would do. Nothing is written here.
 * Returns `{ phases, rewrites, refusals, counts }`.
 */
export function plan(root, { dataRoot, ids = new Map() } = {}) {
	const DATA = dataRoot ?? path.join(root, 'data');
	const activitiesDir = path.join(DATA, 'activities');
	const phasesDir = path.join(DATA, 'phases');
	const refusals = [];
	const groups = new Map();
	const rewrites = [];
	let scanned = 0;
	let already = 0;

	for (const file of walk(activitiesDir).filter((f) => f.endsWith('.activity.md'))) {
		const split = splitRecord(fs.readFileSync(file, 'utf8'));
		if (!split) { refusals.push(`${path.relative(root, file)} has no frontmatter`); continue; }
		scanned += 1;
		const phase = scalar(split.fm, 'phase');
		if (!phase) continue;
		// Already a reference — either this ran before, or the plan was authored after the change.
		if (phase.includes('/')) { already += 1; continue; }

		const project = scalar(split.fm, 'project');
		if (!project) {
			refusals.push(`${path.relative(root, file)} has phase "${phase}" and no \`project\` — a phase is one plan's own calendar and cannot be scoped without one; set the project, or clear the phase`);
			continue;
		}
		const projectId = idOf(project);
		// An explicit `--id` wins over the slug, which is the whole point of it.
		const nameSlug = ids.get(phase) ?? slug(phase);
		if (!nameSlug) {
			refusals.push(`${path.relative(root, file)} has phase "${phase}", which slugs to nothing — the engine's id generator would fall back to an unreadable hash. Pass \`--id "${phase}=<a-readable-latin-handle>"\`, or mint the record by hand with \`dt add phases --id ...\``);
			continue;
		}
		const key = keyOf(projectId, phase);
		if (!groups.has(key)) groups.set(key, { project: projectId, name: phase, slug: nameSlug, files: [], starts: [], ends: [] });
		const g = groups.get(key);
		g.files.push(file);
		const st = scalar(split.fm, 'starts'); if (st) g.starts.push(st);
		const en = scalar(split.fm, 'ends'); if (en) g.ends.push(en);
		rewrites.push({ file, ref: `phases/${projectId}/${nameSlug}`, key });
	}

	// ⚠ TWO DIFFERENT PHASE NAMES ON ONE ID, IN ONE PROJECT. Checked BEFORE anything is planned,
	// because the failure it prevents is silent: both groups plan, both write, the second overwrites
	// the first, and the plan ends up with one stretch where two belonged and half its rungs pointing
	// at the wrong one. Measured on the first real consumer — see the header.
	const byId = new Map();
	for (const g of groups.values()) {
		const k = `${g.project}/${g.slug}`;
		if (!byId.has(k)) byId.set(k, []);
		byId.get(k).push(g);
	}
	const collided = new Set();
	for (const [k, gs] of byId) {
		if (gs.length < 2) continue;
		for (const g of gs) collided.add(keyOf(g.project, g.name));
		const names = gs.map((g) => `"${g.name}"`).join(' and ');
		refusals.push(`${gs.length} different phase names collapse onto the single id \`${k}\`: ${names}. One would silently overwrite the other. Give each an explicit id: ${gs.map((g) => `--id "${g.name}=<handle>"`).join(' ')}`);
	}

	const phases = [];
	const refusedKeys = new Set(collided);
	for (const [key, g] of groups) {
		if (refusedKeys.has(key)) continue;
		const dest = path.join(phasesDir, g.project, `${g.slug}.phase.md`);
		if (fs.existsSync(dest)) {
			refusals.push(`${path.relative(root, dest)} already exists — move or remove it first; nothing was migrated`);
			refusedKeys.add(key);
			continue;
		}
		if (!g.starts.length) {
			// THE ONE THING THIS SCRIPT WILL NOT DO. `starts` is required on a phase and there is
			// nothing here to derive it from. An invented date draws a bar on a gantt that reads
			// exactly like one somebody chose.
			refusals.push(`phase "${g.name}" in project \`${g.project}\` has no \`starts\` on any of its ${g.files.length} activities — a phase REQUIRES a start and nothing here can derive one. Add \`starts\` to one of them, or mint the phase by hand: \`dt add phases --name "${g.name}" --project projects/${g.project} --starts <date>\``);
			refusedKeys.add(key);
			continue;
		}
		phases.push({
			dest,
			name: g.name,
			project: g.project,
			starts: g.starts.slice().sort()[0],
			ends: g.ends.length ? g.ends.slice().sort().at(-1) : undefined,
			from: g.files.length,
		});
	}

	// A refused GROUP means its activities must not be re-pointed either — they would dangle.
	const kept = rewrites.filter((r) => !refusedKeys.has(r.key));

	return {
		root, dataRoot: DATA, phases, rewrites: kept, refusals,
		counts: { scanned, already, phases: phases.length, activities: kept.length },
	};
}

/** The body of a minted phase record — what it is, and plainly that a script derived it. */
export function phaseRecord(p) {
	const fm = [
		'---',
		`name: ${JSON.stringify(p.name)}`,
		`project: projects/${p.project}`,
		`starts: '${p.starts}'`,
		...(p.ends ? [`ends: '${p.ends}'`] : []),
		'author: agents/dreamteamer',
		`creation_context: minted by migrate-plan from the free-text \`phase\` on ${p.from} activit${p.from === 1 ? 'y' : 'ies'}; dates are the earliest start and latest end among them, not a decision anybody made`,
		'source: migration:migrate-plan',
		'confidence: normal',
		'---',
	].join('\n');
	// The body says what the DATES are, because they are derived and a reader must not take them for
	// a commitment. The rest of the page is for a person to write.
	const body = [
		'',
		`Converted from the free-text \`phase: ${p.name}\` that ${p.from} activit${p.from === 1 ? 'y' : 'ies'} carried.`,
		'',
		'**The dates are DERIVED, not decided.** `starts` is the earliest `starts` among those',
		'activities and `ends` the latest `ends` — which is what the old free-text field meant in',
		'practice, since nothing else ever carried the span. Replace them with the dates somebody',
		'actually agreed, and say here what has to be true to leave this stretch and what is',
		'deliberately not in it.',
		'',
	].join('\n');
	return `${fm}\n${body}`;
}

/** Perform the plan. Throws on any refusal — a partial migration is worse than none. */
export function apply(p) {
	if (p.refusals.length) throw new Error(`refusing to migrate:\n  ${p.refusals.join('\n  ')}`);
	for (const ph of p.phases) {
		fs.mkdirSync(path.dirname(ph.dest), { recursive: true });
		fs.writeFileSync(ph.dest, phaseRecord(ph));
	}
	for (const { file, ref } of p.rewrites) {
		const text = fs.readFileSync(file, 'utf8');
		const split = splitRecord(text);
		fs.writeFileSync(file, `---\n${setScalar(split.fm, 'phase', ref)}\n---\n${split.body}`);
	}
	return p.counts;
}

const dirty = (root) => spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).stdout.trim();

export function main(argv, root) {
	const dryRun = argv.includes('--dry-run');
	const at = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined; };
	// `--id "<phase text>=<id>"`, repeatable. Split on the FIRST `=` only: a phase name may contain one.
	const ids = new Map();
	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i] !== '--id' || !argv[i + 1]) continue;
		const eq = argv[i + 1].indexOf('=');
		if (eq < 1) { console.error(`--id expects "<phase text>=<id>", got ${JSON.stringify(argv[i + 1])}`); return 2; }
		ids.set(argv[i + 1].slice(0, eq), argv[i + 1].slice(eq + 1));
	}
	const p = plan(root, { dataRoot: at('data-root'), ids });

	console.log(`scanned ${p.counts.scanned} activities`);
	if (p.counts.already) console.log(`  ${p.counts.already} already carry a \`phase\` reference — left alone`);
	for (const ph of p.phases) console.log(`  + phases/${ph.project}/${path.basename(ph.dest, '.phase.md')}  ${ph.starts}${ph.ends ? ` -> ${ph.ends}` : ''}  (from ${ph.from})`);
	console.log(`${p.counts.phases} phase record(s) to mint, ${p.counts.activities} activit(ies) to re-point`);

	if (p.refusals.length) {
		console.error(`\nrefusing to migrate — ${p.refusals.length} problem(s), and a partial migration is worse than none:`);
		for (const r of p.refusals) console.error(`  ${r}`);
		return 1;
	}
	if (!p.counts.phases && !p.counts.activities) { console.log('nothing to migrate'); return 0; }
	if (dryRun) { console.log('\n(--dry-run: nothing written)'); return 0; }
	// A dirty tree makes this irreversible by `git checkout`, which is the only undo there is.
	if (!argv.includes('--allow-dirty') && dirty(root)) {
		console.error('\nthe working tree is dirty. `git checkout -- data/` is the only undo this has — commit or stash first, or pass --allow-dirty.');
		return 2;
	}
	apply(p);
	console.log(`\nminted ${p.counts.phases} phase record(s), re-pointed ${p.counts.activities} activit(ies)`);
	console.log('  now run: npm run compile && npm run check');
	return 0;
}

/** ⚠ RUN AS A SCRIPT — AND THROUGH A SYMLINK, WHICH IS THE HALF THAT WAS BROKEN.
 *
 *  `process.argv[1]` is the path as INVOKED; `import.meta.url` is the path RESOLVED. Under preview
 *  mode the module is reached through a `git_modules/<name>` symlink into a clone elsewhere, so the
 *  two are different strings for the same file and a `===` between them is false. The guard then
 *  never fires: no output at all, exit 0, and a reader sees a clean run.
 *
 *  Measured 2026-09-11 on a linked consumer holding 52 activities, 35 decisions and 8 phases: this
 *  file printed NOTHING and exited 0. It is the same defect the perspective guard was fixed for a
 *  day earlier from the other direction (its data root resolved from the SCRIPT), and the same
 *  lesson: a guard whose silence means "clean" must be forced to prove it ran. Both sides are
 *  realpath'd now, so the symlink and the real path compare equal. */
const isMain = () => {
	if (!process.argv[1]) return false;
	const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
	return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
};

if (isMain()) {
	process.exit(main(process.argv.slice(2), process.cwd()));
}
