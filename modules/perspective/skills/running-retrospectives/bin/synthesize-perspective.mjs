#!/usr/bin/env node
// synthesize-perspective — the MECHANICAL half of stage 6 (synthesise). It fills the countable and
// referential half of the run's `perspectives` record and points the retrospective at it.
//
//   node synthesize-perspective.mjs --retrospective perspective/retrospective-sessions/<id>
//        [--data-root d] [--workspace-root d] [--scratch-root d] [--dry-run]
//
// ⚠ WHAT IS THE MODEL'S, AND IS NEVER TOUCHED: `role`, `summary` and the BODY. Those are the
// perspective — an observed role and a paragraph a person would recognise. This script only counts
// and joins. It rewrites the record in place, preserving existing key order, so a model can write
// `role` before or after this runs and either order survives.
//
// WHAT IT FILLS, all mechanically:
//   · inline `commands[].uses` — conversations of this run whose `commands_invoked` holds the name
//   · inline `skills[].uses`   — conversations whose `skills_loaded` holds the name
//     (the inline command/skill/routine lists themselves come from stage 1, `init`; this script
//      never invents an entry, it only counts the ones already listed)
//   · `activities_count` / `decisions_count` — records under <base>/ in those collections
//   · `meetings_count` — DISTINCT `meetings` refs across those activities; absent when there are
//     none, because 0 would read as an empty diary rather than as an absent source
//   · `topics` · `collaborators` · `workflows` — every record ref under <base>/, sorted
//   · `period_start` / `period_end` — min/max of the activities' started/ended; with no activities,
//     of the conversations' started_at; absent when there is neither
//   · `dsl` — every `perspective/concepts/<base>/*` whose `evidence_count` > 0, i.e. the terms
//     actually SEEN used. A concept seeded from workspace vocabulary but never observed is not DSL.
//   · inline `projects` — one per `perspective/world/projects/<base>/*`, with the activities pointing at
//     it counted here and the commit/ticket totals copied from the record the projects pass wrote
//   · inline `repos` — one per `git-repo` source of this run, counted from the COMMITS SCRATCH FILE
//     read-git leaves at `<scratch-root>/commits/<base>/<slug>.jsonl` (commits are deliberately not
//     records — design §8). An absent scratch file is 0 commits, never an error.
//   · inline `collections` — every compiled descriptor under `<workspace-root>/.dreamteamer/
//     collections`, minus this module's own and minus the runtime-base system collections, with the
//     record files under each one's `storage.path` counted. What the contributor has to keep things in.
//
// A record belongs to this run when its `source` ref starts with `perspective/sources/<base>/`
// (source ids are `<base>/<kind>--<label>`) or when it carries no source at all.
//
// It writes NO back-link: `retrospective-sessions.perspective` is a generated mirror of this
// record's own `retrospective` field, and the engine refuses a direct write to it.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { VAULT, DATA, SCRATCH, dt, slug } from '../lib/vault.mjs';
import { recordPath, writeRecord, readRecord, listRecords, contributorOf} from '../lib/records.mjs';
import { contributorHandles as handlesOf } from '../lib/identity.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const retrospective = opt('retrospective');
if (!retrospective.startsWith('perspective/retrospective-sessions/')) {
	console.error('usage: --retrospective perspective/retrospective-sessions/<id> is required');
	process.exit(2);
}
const base = retrospective.split('/').pop();
const dataRoot = opt('data-root', DATA);
// Every evidence and model id is keyed by the CONTRIBUTOR, not by the run — a re-run must update
// this person's records rather than write a parallel set beside them. Resolved LAZILY, on first
// use: reading it eagerly made a script that should exit 2 on a bad argument crash on a missing
// session instead, and write nothing was the contract it broke (read-asana, 2026-09-09).
let _who = null;
const who = () => (_who ??= contributorOf(retrospective, dataRoot));
// Where the INPUTS that are not records live: the compiled descriptors and the data they count
// (--workspace-root, the same spelling init.mjs uses), and read-git's commits JSONL (--scratch-root,
// the same spelling read-git.mjs uses). Both default to this vault.
const workspaceRoot = path.resolve(opt('workspace-root', VAULT));
const scratchRoot = path.resolve(opt('scratch-root', SCRATCH));
const root = path.join(dataRoot, 'perspective');

const belongs = (fields) => !fields.source || String(fields.source).startsWith(`perspective/sources/${who()}/`);
const idFromPath = (file, coll, suffix) =>
	path.relative(path.join(root, coll), file).replace(new RegExp(`\\.${suffix}\\.md$`), '');

/** Every record of a collection filed under this run's own directory — the ids all begin with <base>/. */
function underRun(coll, suffix) {
	return listRecords(path.join(root, coll, who())).map((f) => ({ file: f, id: idFromPath(f, coll, suffix), ...readRecord(f) }));
}
const refsUnderRun = (coll, suffix) => underRun(coll, suffix).map((r) => `perspective/${coll}/${r.id}`).sort();

// ── the run's conversations, read once ────────────────────────────────────────────────────────
const conversations = listRecords(path.join(root, 'conversations'))
	.map((f) => readRecord(f).fields)
	.filter(belongs);

const countIn = (field, name) => conversations.filter((c) => Array.isArray(c[field]) && c[field].includes(name)).length;

// ── the record: read what is there, or make the minimum ───────────────────────────────────────
const file = recordPath('perspectives', who(), 'perspective', dataRoot);
const introFile = path.join(root, 'retrospective-sessions', `${base}.retrospective-session.md`);
let fields = {};
let body = '';
let created = false;
if (fs.existsSync(file)) {
	({ fields, body } = readRecord(file));
} else {
	created = true;
	const intro = fs.existsSync(introFile) ? readRecord(introFile).fields : {};
	fields = {
		retrospective,
		// `contributor` is required by the descriptor, and it is the perspective's own id. There is no
		// fallback rung any more: `label` was removed on 2026-09-09 and `who()` already refuses a session
		// that carries no contributor, so a value here can only come from the session.
		contributor: who(),
		author: 'scripts/synthesize-perspective@1',
		creation_context: `mechanical half of stage 6 for ${retrospective}; role, summary and body are the model's`,
	};
}
fields.retrospective = retrospective;

// ── inline commands / skills / routines ───────────────────────────────────────────────────────
const commands = Array.isArray(fields.commands) ? fields.commands : [];
const skills = Array.isArray(fields.skills) ? fields.skills : [];
const routines = Array.isArray(fields.routines) ? fields.routines : [];
for (const c of commands) c.uses = countIn('commands_invoked', c.name);
for (const s of skills) s.uses = countIn('skills_loaded', s.name);
if (commands.length) fields.commands = commands;
if (skills.length) fields.skills = skills;
if (routines.length) fields.routines = routines;

// ── counts and refs ───────────────────────────────────────────────────────────────────────────
const activities = underRun('world/activities', 'activity');
fields.activities_count = activities.length;
fields.decisions_count = underRun('decisions', 'decision').length;
// ⚠ DISTINCT MEETINGS THE MODEL RESTS ON, not what the reader scanned. A meeting attended and never
// clustered into an activity is on the `meetings` source's own counts and deliberately not here:
// this number is the calendar's contribution to the PERSPECTIVE, and the two would silently disagree
// if one field tried to be both. Absent when no activity cites one, because a workspace without the
// meetings module has no calendar evidence and 0 would read as an empty diary.
const meetingRefs = new Set(activities.flatMap((a) => (Array.isArray(a.fields.meetings) ? a.fields.meetings : []).map(String)));
if (meetingRefs.size) fields.meetings_count = meetingRefs.size; else delete fields.meetings_count;
fields.topics = refsUnderRun('topics', 'topic');
fields.collaborators = refsUnderRun('world/users', 'user');
fields.workflows = refsUnderRun('workflows', 'workflow');
fields.dsl = underRun('concepts', 'concept')
	.filter((r) => Number(r.fields.evidence_count) > 0)
	.map((r) => `perspective/concepts/${r.id}`)
	.sort();

// ── inline projects ───────────────────────────────────────────────────────────────────────────
/** The first sentence of a record body — headings are a title, never a sentence. '' when there is none. */
function firstSentence(body) {
	const prose = String(body ?? '').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').trim();
	if (!prose) return '';
	const para = prose.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
	return (/^(.+?[.!?])(\s|$)/.exec(para)?.[1] ?? para).trim();
}

const activitiesPerProject = new Map();
for (const a of activities) {
	const p = a.fields.project ? String(a.fields.project) : '';
	if (p) activitiesPerProject.set(p, (activitiesPerProject.get(p) ?? 0) + 1);
}
const projects = underRun('world/projects', 'project')
	.map((r) => {
		const ref = `perspective/world/projects/${r.id}`;
		return {
			name: String(r.fields.name ?? r.id.split('/').pop()),
			kind: String(r.fields.kind ?? 'unknown'),
			description: firstSentence(r.body),
			activities: activitiesPerProject.get(ref) ?? 0,
			// The projects pass owns these two; this script copies, never recounts.
			commits: Number(r.fields.commit_count ?? 0),
			tickets: Number(r.fields.ticket_count ?? 0),
			ref,
		};
	})
	.sort((a, b) => b.activities - a.activities || a.name.localeCompare(b.name));
if (projects.length) fields.projects = projects; else delete fields.projects;

// ── inline repos ──────────────────────────────────────────────────────────────────────────────
// The contributor's OWN commits need their git identities. ⚠ This matched the collaborator handles
// against `fields.contributor` until 2026-09-09 — that is the SLUG, and a slug is never an author
// email, so the set came back empty and contributor_commits was 0 on every run after the re-keying.
// The handles are on the run record; `lib/identity.mjs` unions in the merge read-git already did.
const contributorHandles = handlesOf(retrospective, dataRoot) ?? new Set();

const urlish = (v) => typeof v === 'string' && /^(?:https?:\/\/|ssh:\/\/|git@)\S+$/.test(v.trim());

/** read-git writes `<scratchRoot>/commits/<base>/<slug(basename(repo dir))>.jsonl`, and the inventory
 *  builds the source id from `slug(label)` of that same folder name — so the id's `git-repo--<slug>`
 *  suffix IS the file's stem. The location's basename is tried too, for a hand-edited label. */
function commitsFile(rec) {
	const dir = path.join(scratchRoot, 'commits', base);
	const stems = [rec.id.split('/').pop().replace(/^git-repo--/, '')];
	if (rec.fields.location) stems.push(slug(path.basename(String(rec.fields.location))));
	for (const s of stems) { const f = path.join(dir, `${s}.jsonl`); if (fs.existsSync(f)) return f; }
	return '';
}

const repos = underRun('sources', 'source')
	.filter((r) => r.fields.kind === 'git-repo')
	.map((r) => {
		const entry = { name: String(r.fields.label ?? r.id.split('/').pop().replace(/^git-repo--/, '')) };
		const fromCounts = Object.values(r.fields.counts ?? {}).find(urlish);
		const url = fromCounts ?? /(?:https?:\/\/|ssh:\/\/|git@)[^\s)>\]]+/.exec(r.body ?? '')?.[0];
		if (url) entry.url = String(url).trim();
		entry.commits = 0;
		entry.contributor_commits = 0;
		let first = '', last = '';
		const f = commitsFile(r);
		if (f) for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
			if (!line.trim()) continue;
			entry.commits++;
			let c; try { c = JSON.parse(line); } catch { continue; }
			if (c.author_email && contributorHandles.has(String(c.author_email).toLowerCase())) entry.contributor_commits++;
			const day = String(c.date ?? '').slice(0, 10);
			if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
			if (!first || day < first) first = day;
			if (day > last) last = day;
		}
		if (first) { entry.first = first; entry.last = last; }
		return entry;
	})
	.sort((a, b) => a.name.localeCompare(b.name));
if (repos.length) fields.repos = repos; else delete fields.repos;
const repoCommits = repos.reduce((n, r) => n + r.commits, 0);

// ── inline collections ────────────────────────────────────────────────────────────────────────
/** Every file under `dir` matching `test`, recursively. Absent is empty, never an error. */
function walk(dir, test) {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = path.join(dir, e.name);
		return e.isDirectory() ? walk(p, test) : test(e.name) ? [p] : [];
	});
}
/** Record files are `<id>.<suffix>.<ext>`, so the suffix is what separates a record from a stray file. */
const countRecords = (dir, suffix) => walk(dir, (n) => !n.startsWith('.') && (!suffix || n.includes(`.${suffix}.`))).length;

const collections = walk(path.join(workspaceRoot, '.dreamteamer', 'collections'), (n) => n.endsWith('.collection.yaml'))
	.map((file) => ({ file, doc: yaml.load(fs.readFileSync(file, 'utf8')) ?? {} }))
	.map(({ file, doc }) => ({ name: String(doc.name || path.basename(file, '.collection.yaml')), doc }))
	// the module does not list ITSELF, and the runtime-base system collections are the engine's, not the person's
	.filter(({ name, doc }) => name !== 'perspective' && !name.startsWith('perspective/') && doc.storage?.base !== 'runtime')
	.map(({ name, doc }) => ({
		name,
		description: String(doc.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
		records: doc.storage?.path ? countRecords(path.join(workspaceRoot, String(doc.storage.path)), doc.storage.suffix) : 0,
	}))
	.sort((a, b) => a.name.localeCompare(b.name));
if (collections.length) fields.collections = collections; else delete fields.collections;

// ── the period ────────────────────────────────────────────────────────────────────────────────
const dates = activities.flatMap((r) => [r.fields.started, r.fields.ended].filter(Boolean).map(String));
const span = dates.length ? dates : conversations.map((c) => String(c.started_at ?? '')).filter(Boolean);
const days = span.map((d) => d.slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
if (days.length) { fields.period_start = days[0]; fields.period_end = days[days.length - 1]; }

const ref = `perspective/perspectives/${who()}`;
if (!flag('dry-run')) {
	writeRecord(file, fields, body);
	// ⚠ THERE IS NO BACK-LINK TO WRITE ANY MORE, and writing one is now an ERROR.
	// `retrospective-sessions.perspective` was a hand-kept pointer until 2026-09-09; it is a GENERATED
	// MIRROR of `perspectives.retrospective` now, and the engine refuses a direct write to it:
	//   ✖ perspective is generated from perspective/perspectives.retrospective — set that instead
	// The owning side is `fields.retrospective` on the record this function just wrote, so the mirror
	// is already correct the moment the engine next rebuilds relations. This script's only job here is
	// to write the perspective; the edge belongs to the schema.
	//
	// It shipped broken through 0.2.1 because the fixture has no compiled runtime, so the old guard
	// (`does .dreamteamer exist beside dataRoot`) skipped the write in every test and the failure could
	// only appear on a real workspace — which is exactly where it appeared (a client workspace, 2026-09-10).
}

const used = (list) => list.filter((e) => Number(e.uses) > 0).length;
process.stdout.write(
	`✔ perspective ${base} · commands ${commands.length} (used ${used(commands)})`
	+ ` · skills ${skills.length} (used ${used(skills)})`
	+ ` · routines ${routines.length}`
	+ ` · activities ${fields.activities_count} · decisions ${fields.decisions_count} · meetings ${meetingRefs.size}`
	+ ` · topics ${fields.topics.length} · collaborators ${fields.collaborators.length} · workflows ${fields.workflows.length}`
	+ ` · projects ${projects.length} · repos ${repos.length} (commits ${repoCommits}) · collections ${collections.length}`
	+ `${created ? ' · CREATED' : ''}${flag('dry-run') ? ' · DRY RUN' : ''}\n`,
);
