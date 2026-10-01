#!/usr/bin/env node
// backfill-from-candidate — a repair, not a stage. It infers `from_candidate` on activities written
// before the field existed, so `attach-evidence` can recover the evidence they were never given.
//
//   node backfill-from-candidate.mjs --retrospective perspective/retrospective-sessions/<id>
//        [--data-root d] [--scratch-root d] [--dry-run]
//
// ⚠ THIS EXISTS FOR ONE MIGRATION AND SHOULD NOT BECOME A HABIT. The naming pass sets
// `from_candidate` itself now; this only rescues the run that predates it. Inferring provenance is
// always worse than recording it, and the rule here is deliberately narrow so it fails loudly rather
// than attributing one candidate's work to another (design §4: a wrong merge is the worst error this
// module can make).
//
// THE RULE, in order:
//   1. A candidate is a CANDIDATE MATCH only if its date range overlaps the activity's AND the two
//      share at least one session ref or commit SHA. Shared evidence is the only honest signal that
//      this activity came from that candidate — a date overlap alone matches half the corpus.
//   2. An activity carrying no evidence at all falls back to repo + date overlap, which is weaker and
//      is reported separately so the number is visible.
//   3. Exactly one match wins. Several matches are broken by the MOST shared evidence; a tie there is
//      left UNSET and counted — an unset field costs nothing, a wrong one is unrecoverable.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, SCRATCH } from '../lib/vault.mjs';
import { listRecords, readRecord, writeRecord, contributorOf, collectionDir } from '../lib/records.mjs';

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
const cands = [];
for (const line of fs.readFileSync(candFile, 'utf8').split('\n')) {
	if (!line.trim()) continue;
	try {
		const c = JSON.parse(line);
		cands.push({ ...c, _sessions: new Set(c.sessions ?? []), _commits: new Set(c.commits ?? []), _repo: String(c.repo ?? '').toLowerCase() });
	} catch { /* a torn line is skipped, never fatal */ }
}

const day = (v) => String(v ?? '').slice(0, 10);
const seg = (r) => String(r).split('/').pop().toLowerCase();

let set = 0, already = 0, weak = 0, tied = 0, unmatched = 0;
for (const file of listRecords(path.join(collectionDir('activities', dataRoot), who()))) {
	const { fields, body } = readRecord(file);
	if (fields.from_candidate) { already++; continue; }
	const st = day(fields.started), en = day(fields.ended) || st;
	const sess = new Set(fields.sessions ?? []);
	const shas = new Set(fields.commits ?? []);
	const repos = new Set([...(fields.repos ?? [])].map(seg));

	const overlapping = cands.filter((c) => st <= day(c.ended) && en >= day(c.started));
	const scored = overlapping
		.map((c) => ({ c, n: [...sess].filter((x) => c._sessions.has(x)).length + [...shas].filter((x) => c._commits.has(x)).length }))
		.filter((x) => x.n > 0)
		.sort((a, b) => b.n - a.n);

	let pick = null, viaRepo = false;
	if (scored.length) {
		// A tie at the top is ambiguous by construction: two candidates gave this activity the same
		// amount of evidence, and guessing between them is exactly the error to refuse.
		if (scored.length > 1 && scored[0].n === scored[1].n) { tied++; continue; }
		pick = scored[0].c;
	} else if (!sess.size && !shas.size && repos.size) {
		const byRepo = overlapping.filter((c) => repos.has(seg(c._repo)) || repos.has(c._repo.split('/')[0]));
		if (byRepo.length === 1) { pick = byRepo[0]; viaRepo = true; }
		else if (byRepo.length > 1) { tied++; continue; }
	}
	if (!pick) { unmatched++; continue; }
	if (viaRepo) weak++;
	if (!flag('dry-run')) writeRecord(file, { ...fields, from_candidate: pick.key }, body);
	set++;
}

process.stdout.write(
	`✔ from_candidate set ${set} (${weak} by repo alone — weaker) · already had one ${already}` +
	` · left unset: ambiguous ${tied}, no match ${unmatched}` +
	`${flag('dry-run') ? ' · DRY RUN, nothing written' : ''}\n`,
);
