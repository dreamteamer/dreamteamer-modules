#!/usr/bin/env node
// link-decision-conversations — fill `decisions.conversations`: the SESSION a decision was formed
// in, as opposed to `source_ref`, which is only the artefact it was found written down in.
//
//   node link-decision-conversations.mjs --retrospective perspective/retrospective-sessions/<id>
//        [--data-root d] [--dry-run] [--verbose]
//
// WHY IT IS A SCRIPT AND NOT A MODEL PASS. The join is a timestamp lookup with an exact answer,
// and a model asked to do 144 of those will guess on the hard ones and never say which. Here the
// hard ones come out as `ambiguous` and stay EMPTY.
//
// Three routes in, in descending order of how much they claim:
//
//   1. `source_kind: agent-session` — `source_ref` IS a conversation ref. Copy it. No inference.
//   2. `source_kind: decision-log` + `source_ref: agent-decision-log/<id>` — that row carries a
//      `decided` TIMESTAMP, and it was written by an agent DURING a session, so the session is the
//      one whose [started_at, ended_at] contains that instant. Exactly one containing session is the
//      answer. Several means sessions were running concurrently — then, and only then, the row's
//      free-text `session` description is scored against each candidate's title and summary, and the
//      winner must beat the runner-up OUTRIGHT. A tie stays empty.
//   3. everything else — a curated `DECISION-LOG.md#<row>` the person wrote by hand, a commit, a
//      ticket — is NOT TOUCHED. There is no session behind a hand-written log row, and the nearest
//      one in time is a guess wearing a reference's clothes.
//
// It never clears a link a person or an earlier run set. `--force` is deliberately absent: this
// script only ever fills an empty field.
import fs from 'node:fs';
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

/** Millis, or NaN. A record whose timestamp will not parse is skipped, never defaulted to now. */
const ms = (v) => {
	if (v instanceof Date) return v.getTime();
	const t = Date.parse(String(v ?? ''));
	return Number.isNaN(t) ? NaN : t;
};

// ── the conversation index ─────────────────────────────────────────────────────────────────────
// Only sessions with BOTH ends parse into the index: a window needs two ends to contain anything.
const convRoot = collectionDir('conversations', dataRoot);
const windows = [];
for (const file of listRecords(convRoot)) {
	const { fields } = readRecord(file);
	const from = ms(fields.started_at);
	const to = ms(fields.ended_at ?? fields.started_at);
	if (Number.isNaN(from) || Number.isNaN(to)) continue;
	const ref = `perspective/conversations/${path.relative(convRoot, file).replace(/\.conversation\.md$/, '')}`;
	windows.push({ from, to, ref, text: [fields.title, fields.summary, ...(fields.key_topics ?? []), ...(fields.goals ?? [])].filter(Boolean).join(' ') });
}
windows.sort((a, b) => a.from - b.from);

// ── scoring, for the concurrent case only ──────────────────────────────────────────────────────
// Bag-of-words overlap between the log row's own description of its session and the conversation's
// title and summary. Deliberately crude: it is a TIE-BREAK among windows that already contain the
// instant, not a search. Short and ubiquitous words are dropped so "the" cannot decide anything.
const STOP = new Set('a an and are as at be but by for from had has have in into is it its of on or that the this to was were will with unattended session run operator agent'.split(' '));
const bag = (s) => new Set(String(s ?? '').toLowerCase().match(/[a-z][a-z0-9-]{2,}/g)?.filter((w) => !STOP.has(w)) ?? []);
const overlap = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n; };

/** The agent-decision-log row behind a `decision-log` decision — its instant and its own words. */
function logRow(sourceRef) {
	const m = /^agent-decision-log\/(.+)$/.exec(String(sourceRef ?? ''));
	if (!m) return null;
	const file = path.join(dataRoot, 'agent-decision-log', `${m[1]}.agent-decision.md`);
	if (!fs.existsSync(file)) return null;
	const { fields } = readRecord(file);
	const at = ms(fields.decided);
	if (Number.isNaN(at)) return null;
	return { at, text: [fields.session, fields.context, fields.name].filter(Boolean).join(' ') };
}

// ── the pass ───────────────────────────────────────────────────────────────────────────────────
const tally = { direct: 0, contained: 0, disambiguated: 0, ambiguous: 0, 'no-window': 0, 'not-a-session': 0, 'already-set': 0 };
const notes = [];

for (const file of listRecords(path.join(collectionDir('decisions', dataRoot), who()))) {
	const rec = readRecord(file);
	const { fields } = rec;
	const id = path.basename(file).replace(/\.decision\.md$/, '');

	if (Array.isArray(fields.conversations) && fields.conversations.length) { tally['already-set']++; continue; }

	let refs = null;
	let route = '';

	if (fields.source_kind === 'agent-session' && String(fields.source_ref ?? '').startsWith('perspective/conversations/')) {
		refs = [fields.source_ref];
		route = 'direct';
	} else if (fields.source_kind === 'decision-log') {
		const row = logRow(fields.source_ref);
		if (!row) { tally['not-a-session']++; continue; }          // a hand-written DECISION-LOG.md row
		const hits = windows.filter((w) => row.at >= w.from && row.at <= w.to);
		if (hits.length === 1) { refs = [hits[0].ref]; route = 'contained'; }
		else if (hits.length === 0) { tally['no-window']++; notes.push(`no-window  ${id}`); continue; }
		else {
			const want = bag(row.text);
			const scored = hits.map((w) => ({ w, s: overlap(want, bag(w.text)) })).sort((a, b) => b.s - a.s);
			if (scored[0].s > 0 && scored[0].s > scored[1].s) { refs = [scored[0].w.ref]; route = 'disambiguated'; }
			else { tally.ambiguous++; notes.push(`ambiguous  ${id} — ${hits.length} concurrent sessions, top score ${scored[0].s}`); continue; }
		}
	} else { tally['not-a-session']++; continue; }                 // git-commit, ticket, meeting, interview

	tally[route]++;
	if (!flag('dry-run')) writeRecord(file, { ...fields, conversations: refs }, rec.body);
	if (flag('verbose')) notes.push(`${route.padEnd(14)} ${id} → ${refs.join(' ')}`);
}

if (notes.length) process.stdout.write(notes.join('\n') + '\n');
process.stdout.write(
	`✔ decisions linked: direct ${tally.direct} · contained ${tally.contained} · disambiguated ${tally.disambiguated}`
	+ ` · left empty: ambiguous ${tally.ambiguous}, no-window ${tally['no-window']}, not-a-session ${tally['not-a-session']}`
	+ ` · already set ${tally['already-set']} · index ${windows.length} sessions${flag('dry-run') ? ' · DRY RUN, nothing written' : ''}\n`,
);