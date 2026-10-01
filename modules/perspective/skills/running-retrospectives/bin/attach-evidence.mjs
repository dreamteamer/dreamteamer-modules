#!/usr/bin/env node
// attach-evidence — the machine half of clustering. The model NAMES and BOUNDS a piece of work; this
// attaches the evidence it rests on.
//
//   node attach-evidence.mjs --retrospective perspective/retrospective-sessions/<id>
//        [--data-root d] [--scratch-root d] [--dry-run]
//
// ⚠ WHY THIS EXISTS, measured 2026-09-08 on a real run: the naming pass was asked to copy session
// refs onto its `dt add` command line, and 615 of 1,068 conversations never arrived. One candidate
// held 257 sessions. No model copies 257 refs, and nothing in the pipeline noticed — every activity
// looked complete, every rolled-up number was under half, and the only symptom was a total that
// felt low. Asking a model to transcribe a long list is a silent-data-loss machine.
//
// So an activity carries ONE short string, `from_candidate`, and this script does the rest:
//   · every session, commit, branch, ticket and meeting of that candidate is attached
//   · when a candidate produced SEVERAL activities (the model split it, which is the point of the
//     naming pass), each item goes to the activity whose [started, ended] window contains its date;
//     the NARROWEST containing window wins, so a specific activity beats a catch-all
//   · an item inside no window goes to the nearest activity by start date — it belongs to that
//     candidate by construction, and dropping it is the failure this script exists to prevent
//   · an activity with no `from_candidate` is left exactly as it is (a person wrote it)
import fs from 'node:fs';
import path from 'node:path';
import { DATA, SCRATCH } from '../lib/vault.mjs';
import { listRecords, readRecord, writeRecord, contributorOf, collectionDir, recordId } from '../lib/records.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const retrospective = opt('retrospective');
if (!retrospective.startsWith('perspective/retrospective-sessions/')) { console.error('usage: --retrospective perspective/retrospective-sessions/<id> is required'); process.exit(2); }
const base = retrospective.split('/').pop();
const dataRoot = opt('data-root', DATA);
// Every evidence and model id is keyed by the CONTRIBUTOR, not by the run — a re-run must update
// this person's records rather than write a parallel set beside them. Resolved LAZILY, on first
// use: reading it eagerly made a script that should exit 2 on a bad argument crash on a missing
// session instead, and write nothing was the contract it broke (read-asana, 2026-09-09).
let _who = null;
const who = () => (_who ??= contributorOf(retrospective, dataRoot));
const scratch = opt('scratch-root', SCRATCH);

const candFile = path.join(scratch, 'activity-candidates', `${base}.jsonl`);
if (!fs.existsSync(candFile)) { console.error(`no candidates at ${candFile} — run cluster-activities first`); process.exit(2); }
const candidates = new Map();
for (const line of fs.readFileSync(candFile, 'utf8').split('\n')) {
	if (!line.trim()) continue;
	try { const c = JSON.parse(line); candidates.set(c.key, c); } catch { /* a torn line is skipped, never fatal */ }
}

/** When did this item happen? Sessions and tickets carry their own date; a commit carries the
 *  candidate's, which is close enough to place it inside one of the candidate's own windows. */
const dayOf = (v) => (typeof v === 'string' ? v.slice(0, 10) : '');

const byCandidate = new Map();
const activities = [];
for (const file of listRecords(path.join(collectionDir('activities', dataRoot), who()))) {
	const rec = readRecord(file);
	activities.push({ file, ...rec });
	const key = rec.fields.from_candidate;
	if (!key) continue;
	if (!byCandidate.has(key)) byCandidate.set(key, []);
	byCandidate.get(key).push({ file, ...rec });
}

/** Session ref → its start day, so an item can be placed in a window. */
const sessionDay = new Map();
for (const f of listRecords(collectionDir('conversations', dataRoot))) {
	const rel = recordId('conversations', f, dataRoot);
	sessionDay.set(`perspective/conversations/${rel}`, dayOf(readRecord(f).fields.started_at));
}

/** Meeting ref → its own day, read out of read-meetings' parking lot rather than out of the
 *  `meetings` records: those belong to a PEER module and this script never opens one. A meeting
 *  whose day is missing falls back to the candidate's start, exactly as a commit does. */
const meetingDay = new Map();
{
	const f = path.join(scratch, 'meetings', `${base}.jsonl`);
	if (fs.existsSync(f)) {
		for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
			if (!line.trim()) continue;
			try { const m = JSON.parse(line); if (m.ref) meetingDay.set(String(m.ref), dayOf(m.day || m.starts)); }
			catch { /* a torn line is skipped, never fatal */ }
		}
	}
}

/** The activity an item belongs to: narrowest containing window, else nearest by start. */
function pick(acts, day) {
	if (acts.length === 1) return acts[0];
	const span = (a) => {
		const s = dayOf(a.fields.started), e = dayOf(a.fields.ended) || s;
		return { s, e, width: (Date.parse(e) - Date.parse(s)) || 0 };
	};
	const containing = acts.filter((a) => { const { s, e } = span(a); return day && s && day >= s && day <= e; });
	if (containing.length) return containing.sort((x, y) => span(x).width - span(y).width)[0];
	// Outside every window. It still belongs to this candidate — place it nearest and never drop it.
	return acts.slice().sort((x, y) => Math.abs(Date.parse(span(x).s) - Date.parse(day)) - Math.abs(Date.parse(span(y).s) - Date.parse(day)))[0];
}

let touched = 0, unchanged = 0, orphanKeys = 0;
let sessionsAttached = 0, commitsAttached = 0, ticketsAttached = 0, meetingsAttached = 0;
const assign = new Map(); // activity file → { sessions:Set, commits:Set, branches:Set, tickets:Set, meetings:Set }
const bucket = (f) => { if (!assign.has(f)) assign.set(f, { sessions: new Set(), commits: new Set(), branches: new Set(), tickets: new Set(), meetings: new Set() }); return assign.get(f); };

for (const [key, acts] of byCandidate) {
	const c = candidates.get(key);
	if (!c) { orphanKeys++; continue; }   // a key naming no candidate: reported, never guessed at
	for (const s of c.sessions ?? []) { bucket(pick(acts, sessionDay.get(s) ?? c.started).file).sessions.add(s); sessionsAttached++; }
	for (const sha of c.commits ?? []) { bucket(pick(acts, c.started).file).commits.add(sha); commitsAttached++; }
	for (const t of c.tickets ?? []) { bucket(pick(acts, c.started).file).tickets.add(t); ticketsAttached++; }
	for (const m of c.meetings ?? []) { bucket(pick(acts, meetingDay.get(m) ?? c.started).file).meetings.add(m); meetingsAttached++; }
	for (const b of c.branches ?? []) for (const a of acts) bucket(a.file).branches.add(b);
}

for (const a of activities) {
	const add = assign.get(a.file);
	if (!add) { unchanged++; continue; }
	const merge = (existing, extra) => [...new Set([...(existing ?? []), ...extra])].sort();
	const next = {
		...a.fields,
		sessions: merge(a.fields.sessions, add.sessions),
		commits: merge(a.fields.commits, add.commits),
		branches: merge(a.fields.branches, add.branches),
		tickets: merge(a.fields.tickets, add.tickets),
		meetings: merge(a.fields.meetings, add.meetings),
	};
	for (const k of ['sessions', 'commits', 'branches', 'tickets', 'meetings']) if (!next[k].length) delete next[k];
	if (JSON.stringify(next) === JSON.stringify(a.fields)) { unchanged++; continue; }
	if (!flag('dry-run')) writeRecord(a.file, next, a.body);
	touched++;
}

const noKey = activities.filter((a) => !a.fields.from_candidate).length;
process.stdout.write(
	`✔ activities touched ${touched} · unchanged ${unchanged} · without from_candidate ${noKey}` +
	` · attached ${sessionsAttached} sessions, ${commitsAttached} commits, ${ticketsAttached} tickets, ${meetingsAttached} meetings` +
	(orphanKeys ? ` · ⚠ ${orphanKeys} from_candidate key(s) match no candidate` : '') +
	`${flag('dry-run') ? ' · DRY RUN, nothing written' : ''}\n`,
);
