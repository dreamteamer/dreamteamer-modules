#!/usr/bin/env node
// derive-decision-projects — which EFFORT a decision belongs to, joined rather than judged.
//
//   node derive-decision-projects.mjs --retrospective perspective/retrospective-sessions/<id>
//        [--data-root d] [--force] [--dry-run]
//
// A decision already carries where it was FOUND (`source_ref`) and, when a later pass linked one,
// where it was FORMED (`conversations`). Neither says which piece of work it belongs to — so
// "what did we decide about the engine this quarter" had no query, and a timeline of decisions had
// no lane to draw them in.
//
// THE JOIN IS THROUGH THE EVIDENCE, NEVER THROUGH THE DATE. An activity cites its sessions, its
// commit SHAs, its threads and its tickets, and it already carries a project; a decision cites the
// same artefacts. So a decision's project is the project of the activity that cites the same thing —
// one hop, entirely mechanical. What it is NOT is "the project that was active that week": several
// routinely run in parallel in one week, and a date is not a join. A decision whose evidence
// no activity cites is left EMPTY and counted, and the count is the honest measure of how much of
// the decision record sits outside the reconstructed work.
//
// ADDITIVE. A project set by hand outranks a derived one and is never overwritten without
// `--force` — the same rule `derive-collaborators` learned when a replacing write would have deleted
// 108 hand-attached refs.
import path from 'node:path';
import { DATA } from '../lib/workspace.mjs';
import { listRecords, readRecord, writeRecord, contributorOf, collectionDir } from '../lib/records.mjs';

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
// use, so a bad argument exits 2 with a usage line before any session is read.
let _who = null;
const who = () => (_who ??= contributorOf(retrospective, dataRoot));
const dryRun = flag('dry-run');
const force = flag('force');

const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

// ── every artefact an activity cites → that activity's project ───────────────────────────────────
const bySession = new Map();
const byThread = new Map();
const byTicket = new Map();
/** Commit SHAs, indexed by their first 7 — a decision may cite a short sha and an activity a full
 *  one, or the other way round, and neither is wrong. 7 is git's own abbreviation floor. */
const byCommit = new Map();
let activitiesWithProject = 0;
for (const file of listRecords(path.join(collectionDir('activities', dataRoot), who()))) {
	const { fields } = readRecord(file);
	const project = fields.project;
	if (!project) continue;
	activitiesWithProject++;
	for (const s of list(fields.sessions)) if (!bySession.has(s)) bySession.set(s, project);
	for (const t of list(fields.threads)) if (!byThread.has(t)) byThread.set(t, project);
	for (const t of list(fields.tickets)) if (!byTicket.has(t)) byTicket.set(t, project);
	for (const c of list(fields.commits)) {
		const k = String(c).slice(0, 7).toLowerCase();
		if (k.length === 7 && !byCommit.has(k)) byCommit.set(k, project);
	}
}

function projectOf(fields) {
	// The session the decision was FORMED in is the strongest link there is: it is the piece of work
	// itself, not a place the decision was later written down.
	for (const c of list(fields.conversations)) {
		const hit = bySession.get(c);
		if (hit) return hit;
	}
	const ref = String(fields.source_ref ?? '');
	switch (fields.source_kind) {
		case 'agent-session': return bySession.get(ref) ?? null;
		case 'git-commit': return byCommit.get(ref.slice(0, 7).toLowerCase()) ?? null;
		case 'email': return byThread.get(ref) ?? null;
		case 'ticket': return byTicket.get(ref) ?? null;
		// `decision-log`, `meeting` and `interview` name an artefact no activity cites. They are
		// reachable only through `conversations` above, and a curated row written by hand has none.
		default: return null;
	}
}

let set = 0, kept = 0, unchanged = 0, unplaced = 0;
const unplacedByKind = new Map();
for (const file of listRecords(path.join(collectionDir('decisions', dataRoot), who()))) {
	const { fields, body } = readRecord(file);
	const project = projectOf(fields);
	if (!project) {
		unplaced++;
		unplacedByKind.set(fields.source_kind, (unplacedByKind.get(fields.source_kind) ?? 0) + 1);
		continue;
	}
	if (fields.project && !force) { kept++; continue; }
	if (fields.project === project) { unchanged++; continue; }
	if (!dryRun) writeRecord(file, { ...fields, project }, body);
	set++;
}

process.stdout.write(
	`✔ decisions placed ${set} · already set ${kept} · unchanged ${unchanged} · no activity cites their evidence ${unplaced}` +
	` · from ${activitiesWithProject} activities carrying a project` +
	`${dryRun ? ' · DRY RUN, nothing written' : ''}\n`,
);
if (unplaced) {
	const by = [...unplacedByKind].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k ?? '(none)'} ${n}`).join(' · ');
	process.stdout.write(`  unplaced by source: ${by}\n`);
	process.stdout.write('  ⚠ NOT a bug and NOT placeable by date: a curated decision-log row names no artefact any\n');
	process.stdout.write('    activity cites, and several projects run in every week here. Those need a reader.\n');
}
