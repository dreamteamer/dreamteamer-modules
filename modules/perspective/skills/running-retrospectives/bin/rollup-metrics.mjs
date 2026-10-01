#!/usr/bin/env node
// rollup-metrics — the mechanical second pass. An activity is a cluster of conversations and
// commits; every number on it is a SUM of theirs, and nothing here is judged.
//
// Why a separate script rather than a step inside the clusterer: the clusterer is a model pass and
// re-running it is expensive, while the numbers change every time a reader re-reads. Splitting them
// means a metrics bump costs one cheap deterministic sweep instead of a re-cluster.
//
//   node rollup-metrics.mjs --retrospective perspective/retrospective-sessions/<id> [--data-root <dir>] [--dry-run]
import path from 'node:path';
import fs from 'node:fs';
import { DATA, SCRATCH } from '../lib/vault.mjs';
import { recordPath, readRecord, writeRecord, listRecords, contributorOf} from '../lib/records.mjs';
import { commitIntent } from '../lib/commit-intent.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const retrospectiveRef = opt('retrospective');
if (!retrospectiveRef.startsWith('perspective/retrospective-sessions/')) { console.error('usage: --retrospective perspective/retrospective-sessions/<id> is required'); process.exit(2); }
const sessionBase = retrospectiveRef.split('/').pop();
const dataRoot = opt('data-root', DATA);
const scratchRoot = opt('scratch-root', SCRATCH);
// Every evidence and model id is keyed by the CONTRIBUTOR, not by the run — a re-run must update
// this person's records rather than write a parallel set beside them. Resolved LAZILY, on first
// use, so a script that should exit 2 on a bad argument still does.
let _who = null;
const who = () => (_who ??= contributorOf(retrospectiveRef, dataRoot));

// The fields this script OWNS. Listed once so a rollup that finds no sessions can zero them rather
// than leave a stale number from a previous clustering behind — a stale count is worse than none.
const SUM = {
	active_minutes: 'active_minutes', turns_user: 'turns_user', tokens_input: 'tokens_input',
	tokens_output: 'tokens_output', tokens_cache_read: 'tokens_cache_read',
	tokens_cache_write: 'tokens_cache_write', tool_calls: 'tool_calls', files_edited: 'files_edited',
	corrections: 'user_correction', interruptions: 'interruptions',
	input_words: 'input_words', output_words: 'output_words',
};

const conv = new Map(); // 'perspective/conversations/<id>' → fields
for (const f of listRecords(path.join(dataRoot, 'perspective', 'conversations'))) {
	const { fields } = readRecord(f);
	const rel = path.relative(path.join(dataRoot, 'perspective', 'conversations'), f).replace(/\.conversation\.md$/, '');
	conv.set(`perspective/conversations/${rel}`, fields);
}

// ── how long the meetings were ───────────────────────────────────────────────────────────────────
// Read out of read-meetings' parking lot (`<scratch>/meetings/<base>.jsonl`), the same place the
// commit lines come from and for the same reason: a meeting is a PEER collection's record, and this
// module never opens one. An absent file is no minutes, which is ABSENT and not zero — a meeting
// with no end time was not a meeting of no length.
const meetingMinutes = new Map();   // `meetings/<id>` → minutes
{
	const f = path.join(scratchRoot, 'meetings', `${sessionBase}.jsonl`);
	if (fs.existsSync(f)) {
		for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
			if (!line.trim()) continue;
			let m; try { m = JSON.parse(line); } catch { continue; }   // a truncated line is not a reason to stop
			if (m.ref && Number.isFinite(Number(m.minutes))) meetingMinutes.set(String(m.ref), Number(m.minutes));
		}
	}
}
/** The scheduled minutes of an activity's meetings, or undefined when none of them is measurable. */
const minutesOf = (refs) => {
	let total = 0, found = 0;
	for (const r of refs) { const v = meetingMinutes.get(String(r)); if (v !== undefined) { total += v; found++; } }
	return found ? total : undefined;
};

let rolled = 0, missing = 0, unchanged = 0;
const activityDir = path.join(dataRoot, 'perspective', 'world', 'activities', who());
for (const file of listRecords(activityDir)) {
	const { fields, body } = readRecord(file);
	const acc = Object.fromEntries(Object.keys(SUM).map((k) => [k, 0]));
	let corrWords = 0, found = 0;
	for (const ref of fields.sessions ?? []) {
		const c = conv.get(ref);
		if (!c) { missing++; continue; }
		found++;
		for (const [out, src] of Object.entries(SUM)) acc[out] += Number(c[src] ?? 0);
		corrWords += Number(c.correction_ratio ?? 0) * Number(c.output_words ?? 0);
	}
	// ⚠ ABSENT AND ZERO ARE DIFFERENT CLAIMS, and only one of them is true here. An activity
	// reconstructed from commits alone — every one of them, in a workspace with no transcripts —
	// has no session evidence at all. Writing `tokens_input: 0` on it says the work cost nothing;
	// writing nothing says nobody measured. The second is the fact. But a stale number left by an
	// earlier clustering is a third thing and the worst of them, so the keys are DELETED rather than
	// skipped: `undefined` removes the field, which is what the writer does with it.
	const zeroed = Object.fromEntries(Object.keys(SUM).map((k) => [k, undefined]));
	// The calendar half, owned here like every other number on an activity. `meeting_count` is a
	// count of refs, so it is 0 when there are none — that IS measured. `meeting_minutes` is absent
	// unless the parking lot could say, for the same reason the token figures are.
	const meetingRefs = fields.meetings ?? [];
	const meetings = { meeting_count: meetingRefs.length, meeting_minutes: minutesOf(meetingRefs) };
	const next = found === 0 ? {
		...fields,
		...zeroed,
		session_count: 0,
		tokens_total: undefined,
		correction_ratio: undefined,
		commit_count: (fields.commits ?? []).length,
		...meetings,
	} : {
		...fields,
		...acc,
		active_minutes: +acc.active_minutes.toFixed(1),
		session_count: found,
		tokens_total: acc.tokens_input + acc.tokens_output + acc.tokens_cache_read + acc.tokens_cache_write,
		commit_count: (fields.commits ?? []).length,
		...meetings,
		// Re-derived from the SUMS. Averaging the per-session ratios would weight a two-turn session
		// like a two-hundred-turn one, which is the whole reason this is not a mean.
		correction_ratio: acc.output_words ? +(corrWords / acc.output_words).toFixed(4) : undefined,
	};
	if (JSON.stringify(next) === JSON.stringify(fields)) { unchanged++; continue; }
	if (!flag('dry-run')) writeRecord(file, next, body);
	rolled++;
}

// ── PROJECTS ───────────────────────────────────────────────────────────────────────────────────
// The second tier. A project's numbers are the sum of its activities', and its code curves come from
// the activity-weeks of the repos it lives in — which is the only place lines are counted at all.
// This is what makes a lifecycle NARRATABLE: without it a project has a name and a date range, and
// nothing that says what it cost or whether it converged.
const projDir = path.join(dataRoot, 'perspective', 'world', 'projects', who());
const PROJ_SUM = ['active_minutes', 'turns_user', 'tokens_total', 'input_words', 'output_words', 'corrections', 'interruptions', 'session_count'];

// ── which repo a commit lives in ─────────────────────────────────────────────────────────────────
// ⚠ THE PROJECT→REPO EDGE HAS NO OTHER WRITER. Code curves are summed out of `activity-weeks`, which
// are keyed by repo, so a project gets them only if something says which repos it touched. Grep the
// toolchain for a writer of `activities.repos` and the only match is this file READING it — so the
// set was always just whatever `repo_names` somebody had typed by hand, and a real workspace had 4
// of 8 projects showing blank line columns, one of them with 244 commits (a client workspace, 2026-09-10).
//
// The evidence was never missing: `read-git` parks every commit it reads in
// `<scratch>/commits/<base>/<repo>.jsonl`, so each SHA already knows its repo. This reads that map
// once and lets a project's own commits name its repos.
const commitOfSha = new Map();
const commitsDir = path.join(scratchRoot, 'commits', sessionBase);
if (fs.existsSync(commitsDir)) {
	for (const f of fs.readdirSync(commitsDir).filter((x) => x.endsWith('.jsonl'))) {
		const repo = f.replace(/\.jsonl$/, '');
		for (const line of fs.readFileSync(path.join(commitsDir, f), 'utf8').split('\n')) {
			if (!line.trim()) continue;
			let c; try { c = JSON.parse(line); } catch { continue; }   // a truncated line is not a reason to stop
			if (!c.sha) continue;
			// Same two rules read-git uses per week, applied per commit: an ADDED file's additions are
			// new code, everything else's additions AND deletions are churn.
			let lnew = 0, lmod = 0;
			for (const fl of c.files ?? []) {
				if (String(fl.status ?? '').startsWith('A')) lnew += Number(fl.add ?? 0);
				else lmod += Number(fl.add ?? 0) + Number(fl.del ?? 0);
			}
			commitOfSha.set(String(c.sha), { repo: String(c.repo || repo), lnew, lmod, intent: commitIntent(c.subject) });
		}
	}
}

const byProject = new Map();
for (const file of listRecords(activityDir)) {
	const { fields } = readRecord(file);
	if (!fields.project) continue;
	const cur = byProject.get(fields.project) ?? { n: 0, commits: 0, tickets: 0, repos: new Set(), topics: new Set(), corrWords: 0, first: '', last: '', lines_new: 0, lines_modified: 0, commits_bug: 0, commits_change_request: 0 };
	cur.n++;
	cur.commits += (fields.commits ?? []).length;
	cur.tickets += (fields.tickets ?? []).length;
	for (const r of fields.repos ?? []) cur.repos.add(String(r).split('/').pop());
	for (const sha of fields.commits ?? []) {
		const c = commitOfSha.get(String(sha));
		if (!c) continue;
		cur.repos.add(c.repo);
		cur.lines_new += c.lnew;
		cur.lines_modified += c.lmod;
		if (c.intent === 'bug') cur.commits_bug++;
		else if (c.intent === 'change-request') cur.commits_change_request++;
	}
	for (const t of fields.topics ?? []) cur.topics.add(t);
	for (const k of PROJ_SUM) cur[k] = (cur[k] ?? 0) + Number(fields[k] ?? 0);
	cur.corrWords += Number(fields.correction_ratio ?? 0) * Number(fields.output_words ?? 0);
	const st = String(fields.started ?? ''), en = String(fields.ended ?? fields.started ?? '');
	if (st && (!cur.first || st < cur.first)) cur.first = st;
	if (en && en > cur.last) cur.last = en;
	byProject.set(fields.project, cur);
}

let projRolled = 0, projUnchanged = 0, orphanProjects = 0;
for (const file of listRecords(projDir)) {
	const { fields, body } = readRecord(file);
	const rel = path.relative(path.join(dataRoot, 'perspective', 'world', 'projects'), file).replace(/\.project\.md$/, '');
	const acc = byProject.get(`perspective/world/projects/${rel}`);
	if (!acc) { orphanProjects++; continue; }   // a project no activity points at: left alone, and counted
	// Code curves come from the repos the project's activities actually touched, plus any the
	// project declares itself. ⚠ A repo shared by two projects contributes its lines to BOTH — the
	// weekly record has no per-project attribution, and pretending otherwise would invent one.
	const repos = new Set([...acc.repos, ...(fields.repo_names ?? [])].filter(Boolean));
	// ⚠ FROM THIS PROJECT'S OWN COMMITS, not from its repos' weekly totals. The weekly records have no
	// per-project attribution, so summing them per repo handed every project sharing a repo that
	// repo's ENTIRE history: on a real workspace a 6-commit project came out with 1,775,984 lines_new,
	// identical to the three other projects touching the same repo (a client workspace, 2026-09-10). A number
	// that confident and that wrong is worse than the blank it replaced. Each commit already carries
	// its own per-file add/del in the scratch, so the honest sum needs no attribution at all.
	const code = {
		lines_new: acc.lines_new, lines_modified: acc.lines_modified,
		commits_bug: acc.commits_bug, commits_change_request: acc.commits_change_request,
	};
	const has = (k) => acc[k] > 0;
	const next = {
		...fields,
		// ⚠ NO `activities_count`. 0.2.0 deleted it from `projects` — the count comes off the generated
		// `activities` mirror — and this kept writing it back on every rollup. `check` does not flag an
		// unknown key, so nothing caught it; `dt set` does, and refuses the WHOLE write, so a project
		// that had been rolled up could no longer be edited at all (a client workspace, 2026-09-10).
		// `perspectives.activities_count` is a different field and still exists.
		commit_count: acc.commits,
		ticket_count: acc.tickets,
		// Written back so the record SAYS which repos its curves were summed from, rather than leaving
		// the reader to guess. A name typed by a person survives — this is a union, never a replacement.
		repo_names: repos.size ? [...repos].sort() : undefined,
		topics: [...acc.topics].sort(),
		// Absent, not zero. A project reconstructed from commits alone has no session evidence, and
		// a 0 in these columns would say the work was free rather than unmeasured.
		session_count: acc.session_count || undefined,
		active_minutes: has('active_minutes') ? +acc.active_minutes.toFixed(1) : undefined,
		turns_user: acc.turns_user || undefined,
		corrections: has('corrections') ? acc.corrections : undefined,
		interruptions: has('interruptions') ? acc.interruptions : undefined,
		tokens_total: acc.tokens_total || undefined,
		input_words: acc.input_words || undefined,
		output_words: acc.output_words || undefined,
		correction_ratio: acc.output_words ? +(acc.corrWords / acc.output_words).toFixed(4) : undefined,
		lines_new: code.lines_new || undefined,
		lines_modified: code.lines_modified || undefined,
		commits_bug: code.commits_bug || undefined,
		commits_change_request: code.commits_change_request || undefined,
		started: acc.first || fields.started,
		ended: acc.last || fields.ended,
	};
	delete next.activities_count;   // clear what earlier versions of this script wrote
	if (JSON.stringify(next) === JSON.stringify(fields)) { projUnchanged++; continue; }
	if (!flag('dry-run')) writeRecord(file, next, body);
	projRolled++;
}

process.stdout.write(
	`✔ activities rolled ${rolled} · unchanged ${unchanged} · session refs unresolved ${missing}` +
	` · projects rolled ${projRolled} · unchanged ${projUnchanged} · with no activities ${orphanProjects}` +
	`${flag('dry-run') ? ' · DRY RUN, nothing written' : ''}\n`,
);
