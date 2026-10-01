#!/usr/bin/env node
// compose-week-summaries — what a week was ABOUT, so a timeline reads instead of decoding.
//
//   node compose-week-summaries.mjs --retrospective perspective/retrospective-sessions/<id>
//        [--data-root d] [--scratch-root d] [--max-names 3] [--force] [--dry-run]
//
// `activity-weeks.summary` has four careful READERS — read-git, read-gmail, read-drive and
// read-claude-transcripts each keep the existing summary when rewriting a week — and this is its one
// WRITER. A field that only a human ever writes is a field that is empty.
//
// It composes the summary DETERMINISTICALLY, out of the names of the activities the week overlaps.
// The judgement is already IN those names, performed once by the naming pass over the evidence, and
// quoting it is truer than asking a second model to paraphrase a paraphrase. It is also re-runnable
// and free, which is what a backfill of hundreds of weeks has to be.
//
// AN ACTIVITY IS ATTRIBUTED TO A SOURCE, not merely to a date. The record's grain is source ×
// week, so "the week of March 2nd" is the wrong answer for a git repo whose week held nothing while
// the mailbox beside it held nine threads. Attribution walks the evidence the activity already
// cites — every conversation, thread and ticket record carries its own `source`, and a deliverable
// is matched on `last_touched_by` because the drive reader never wrote one (that gap is a fact
// about the reader; this pass reports what it could not place rather than guessing).
// Commits carry no record at all, so a git source is matched on the `from_candidate` repo prefix.
//
// NEVER OVERWRITES A WRITTEN SUMMARY unless --force. A person's sentence about a week outranks a
// composed one. A week the pass cannot place stays EMPTY: an empty week is silence, not a sentence
// about silence, and a bar with no label now falls through to `period` in the view.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, SCRATCH, slug } from '../lib/workspace.mjs';
import { listRecords, readRecord, writeRecord, contributorOf, collectionDir, recordId, recordPath } from '../lib/records.mjs';
import { contributorHandles } from '../lib/identity.mjs';

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
const scratch = opt('scratch-root', SCRATCH);
const maxNames = Math.max(1, Number(opt('max-names', '3')) || 3);
const dryRun = flag('dry-run');
const force = flag('force');

const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
// An unquoted YAML date parses to a Date, not a string. `period_start: 2025-09-08` in an
// retrospective is written unquoted, so a string-only guard read it as absent and silently disabled
// the whole out-of-period branch — 376 weeks kept being reported as quiet.
const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : '');
/** `perspective/sources/<base>/git-repo--dreamteamer` → `git-repo--dreamteamer`. The suffix is the
 *  only part that identifies a source, and every reader builds it the same way. */
const suffixOf = (ref) => String(ref ?? '').split('/').pop() ?? '';

// ── evidence ref → the source it came from ───────────────────────────────────────────────────────
const sourceOfRef = new Map();
for (const collection of ['conversations', 'threads', 'tickets']) {
	for (const f of listRecords(collectionDir(collection, dataRoot))) {
		const { fields } = readRecord(f);
		if (!fields.source) continue;
		const id = recordId(collection, f, dataRoot);
		sourceOfRef.set(`perspective/${collection}/${id}`, suffixOf(fields.source));
	}
}
// Deliverables written before `source` existed on the collection have to be joined by inference, and
// the chain matters — each rung is right where the one above it has nothing to say:
//   1. the record's own `source` (read-drive writes it now);
//   2. `drive--${slug(last_touched_by)}`, IF such a source exists — true when someone read their own
//      Drive, which is the common case;
//   3. the run's ONLY drive source, when there is exactly one — the case rung 2 gets WRONG. On a
//      PROXY read (one person's store read through a colleague's login) the source is named for the
//      reading account and every file for the person who touched it, so rung 2 matches nothing and
//      all 28 of that contributor's weeks composed silence.
// With two or more drive sources and no match, the deliverable is left unplaced and counted.
const driveSources = new Set();
for (const f of listRecords(path.join(collectionDir('sources', dataRoot), who()))) {
	const id = path.basename(f).replace(/\.source\.md$/, '');
	if (id.startsWith('drive--')) driveSources.add(id);
}
const soleDrive = driveSources.size === 1 ? [...driveSources][0] : null;
const sourceOfDeliverable = new Map();
let unplacedDeliverables = 0;
for (const f of listRecords(collectionDir('deliverables', dataRoot))) {
	const { fields } = readRecord(f);
	const id = recordId('deliverables', f, dataRoot);
	const byOwn = fields.source ? suffixOf(fields.source) : '';
	const byAccount = fields.last_touched_by ? `drive--${slug(fields.last_touched_by)}` : '';
	const hit = byOwn || (driveSources.has(byAccount) ? byAccount : '') || soleDrive;
	if (hit) sourceOfDeliverable.set(`perspective/deliverables/${id}`, hit);
	else unplacedDeliverables++;
}

// The candidates give a git activity its repo — a commit is a bare SHA and git is the store.
const repoOfCandidate = new Map();
const candFile = path.join(scratch, 'activity-candidates', `${base}.jsonl`);
if (fs.existsSync(candFile)) {
	for (const line of fs.readFileSync(candFile, 'utf8').split('\n')) {
		if (!line.trim()) continue;
		try { const c = JSON.parse(line); if (c.repo) repoOfCandidate.set(c.key, slug(c.repo)); }
		catch { /* a torn line is skipped, never fatal */ }
	}
}

// ── every activity, with the source suffixes it can be placed under ──────────────────────────────
const activities = [];
let unplaceable = 0;
for (const f of listRecords(path.join(collectionDir('activities', dataRoot), who()))) {
	const { fields } = readRecord(f);
	const started = day(fields.started);
	if (!started || !fields.name) continue;
	const sources = new Set();
	for (const ref of [...list(fields.sessions), ...list(fields.threads), ...list(fields.tickets)]) {
		const s = sourceOfRef.get(ref);
		if (s) sources.add(s);
	}
	for (const ref of list(fields.deliverables)) {
		const s = sourceOfDeliverable.get(ref);
		if (s) sources.add(s);
	}
	const repo = repoOfCandidate.get(fields.from_candidate);
	if (repo) sources.add(`git-repo--${repo}`);
	for (const r of list(fields.repos)) sources.add(`git-repo--${slug(String(r).split('/').pop())}`);
	if (!sources.size) unplaceable++;
	activities.push({ name: String(fields.name), started, ended: day(fields.ended) || started, sources });
}
// Earliest first, so a week's sentence reads in the order the work happened.
activities.sort((a, b) => (a.started < b.started ? -1 : a.started > b.started ? 1 : a.name < b.name ? -1 : 1));

/** The sentence. Activity names ARE sentences (the naming pass writes them that way), so the summary
 *  quotes them rather than paraphrasing — joined, capped, and honest about what it left out. */
function compose(names) {
	if (names.length <= maxNames) return names.join(' · ');
	return `${names.slice(0, maxNames).join(' · ')} · +${names.length - maxNames} more`;
}

// The contributor's own handles, so a blank week can say WHICH kind of blank it is. `read-git`
// counts every commit in a repo whatever the author (`--contributor` only labels), so a git source
// the contributor never committed to still produces a full year of counted weeks. A summary there
// would be a sentence about somebody else's work, which is why those weeks stay empty — but a
// receipt that lumps them in with "quiet week" hides a fact worth knowing about the inventory.
const myHandles = contributorHandles(retrospective, dataRoot);

// The run's own window. `read-git` indexes a repo's WHOLE history while a retrospective covers a
// period, so most blank weeks on a long-lived repo are simply older than the run. Lumping those in with "quiet week" makes a legitimate boundary look like a
// hole in the model, which is the reading that sends someone hunting for a bug.
const period = (() => {
	try { const f = readRecord(recordPath('retrospective-sessions', base, 'retrospective-session', dataRoot)).fields; return { from: day(f.period_start), to: day(f.period_end) }; }
	catch { return { from: '', to: '' }; }
})();

let written = 0, kept = 0, empty = 0, noDates = 0, notMine = 0, outside = 0;
for (const f of listRecords(collectionDir('activity-weeks', dataRoot))) {
	const { fields, body } = readRecord(f);
	if (suffixOf(fields.source) && !String(fields.source).includes(`/${who()}/`)) continue;   // another run's weeks
	const from = day(fields.start_date), to = day(fields.end_date);
	if (!from || !to) { noDates++; continue; }
	const source = suffixOf(fields.source);
	const names = activities
		.filter((a) => a.sources.has(source) && a.started <= to && a.ended >= from)
		.map((a) => a.name);
	if (!names.length) {
		if ((period.from && to < period.from) || (period.to && from > period.to)) { outside++; continue; }
		const authors = list(fields.authors).map((a) => String(a).toLowerCase());
		if (authors.length && myHandles && !authors.some((a) => myHandles.has(a))) notMine++;
		else empty++;
		continue;
	}
	const summary = compose(names);
	if (fields.summary && !force) { kept++; continue; }
	if (fields.summary === summary) { kept++; continue; }
	if (!dryRun) writeRecord(f, { ...fields, summary }, body);
	written++;
}

process.stdout.write(
	`✔ week summaries composed ${written} · kept ${kept} · quiet week, no overlapping activity ${empty}` +
	(outside ? ` · ${outside} week(s) older than the run's own period — the repo history is longer than the retrospective` : '') +
	(notMine ? ` · ${notMine} week(s) counted for a source the CONTRIBUTOR did not work in — left blank on purpose` : '') +
	(noDates ? ` · ⚠ ${noDates} week(s) have no start_date/end_date — run backfill-week-dates first` : '') +
	(unplaceable ? ` · ⚠ ${unplaceable} activit(ies) name no source and can compose no week` : '') +
	(unplacedDeliverables ? ` · ⚠ ${unplacedDeliverables} deliverable(s) could not be placed on a drive source` : '') +
	`${dryRun ? ' · DRY RUN, nothing written' : ''}\n`,
);
