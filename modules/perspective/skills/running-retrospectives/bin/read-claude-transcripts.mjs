#!/usr/bin/env node
// read-claude-transcripts — the mechanical pass over every conversation in every ~/.claude* tree.
// Writes conversations (depth minimal until a judgement lands), one sources record per tree,
// one activity-week per tree per ISO week. Prints ONE receipt line and never a line of transcript text.
//
//   node read-claude-transcripts.mjs --retrospective perspective/retrospective-sessions/<id> [--home <dir>] [--since YYYY-MM-DD]
//                                   [--limit N] [--data-root <dir>] [--dry-run] [--force]
import fs from 'node:fs';
import os from 'node:os';
import { DATA, templatize, isoWeek, isoWeekRange } from '../lib/workspace.mjs';
import { recordPath, writeRecord, readRecord, nowIso, contributorOf, writeSource } from '../lib/records.mjs';
import { claudeHomes, listTranscripts, reconcile } from '../lib/claude-trees.mjs';
import { computeMetrics, INSPECTOR_VERSION, JUDGED_KEYS } from '../lib/metrics.mjs';

// Re-exported for anything that already imported it from here. Nothing SHOULD: this module runs on
// import and exits 2 without its arguments, so a consumer wanting the constant must take it from the
// lib, which is where it now lives.
export { JUDGED_KEYS };
function pick(o, keys) { const out = {}; for (const k of keys) if (o[k] !== undefined) out[k] = o[k]; return out; }

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const retrospectiveRef = opt('retrospective');
if (!retrospectiveRef.startsWith('perspective/retrospective-sessions/')) { console.error('usage: --retrospective perspective/retrospective-sessions/<id> is required'); process.exit(2); }
const sessionBase = retrospectiveRef.split('/').pop();
const dataRoot = opt('data-root', DATA);
// Every evidence and model id is keyed by the CONTRIBUTOR, not by the run — a re-run must update
// this person's records rather than write a parallel set beside them. Resolved LAZILY, on first
// use, so a bad argument exits 2 with a usage line before any session is read.
let _who = null;
const who = () => (_who ??= contributorOf(retrospectiveRef, dataRoot));
const since = opt('since');
// Weekly windows are written only for the last N weeks (--weeks, else the run record's activity_weeks_back,
// else 4) — the conversation index itself is NOT bounded by this; only --since bounds it.
const weeksBack = (() => {
	let w = Number(opt('weeks', '0')) || 0;
	if (!w) { try { w = Number(readRecord(recordPath('retrospective-sessions', sessionBase, 'retrospective-session', dataRoot)).fields.activity_weeks_back) || 0; } catch { /* fall through */ } }
	return w || 4;
})();
const windowFloor = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - weeksBack * 7); return isoWeek(d); })();
const limit = +opt('limit', '0');
const home = opt('home', os.homedir());
const homes = claudeHomes(home);
const transcripts = listTranscripts(homes);
const rec = reconcile(homes, transcripts);

/** A weekly record's only judged field. Recounting the week must not silently delete it. */
function existingWeekSummary(id) {
	try { return readRecord(recordPath('activity-weeks', id, 'activity-week', dataRoot)).fields.summary || undefined; }
	catch { return undefined; }
}

let written = 0, skipped = 0, minimal = 0, candidates = 0;
const perTree = new Map(); // account → { weeks: Map<period,{sessions,turns}>, first, last, conversations }
for (const h of homes) perTree.set(h.account, { weeks: new Map(), first: '', last: '', conversations: 0 });

const rows = limit ? transcripts.slice(0, limit) : transcripts;
for (const t of rows) {
	const sourceId = `${who()}/claude-transcripts--${t.account}`;
	const m = await computeMetrics(t.path, t);
	if (since && m.started_at && m.started_at.slice(0, 10) < since) continue;
	const tree = perTree.get(t.account);
	tree.conversations++;
	if (m.started_at) {
		if (!tree.first || m.started_at < tree.first) tree.first = m.started_at;
		if (m.started_at > tree.last) tree.last = m.started_at;
		const w = isoWeek(new Date(m.started_at));
		if (w >= windowFloor) { // outside the weeks window the conversation is still indexed; only the weekly record is skipped
			const acc = tree.weeks.get(w) ?? { sessions: 0, turns: 0, active: 0, tokIn: 0, tokOut: 0, tokCR: 0, tokCW: 0, tools: 0, files: 0, corrections: 0, interruptions: 0, inWords: 0, outWords: 0, corrWords: 0 };
			acc.sessions++;
			acc.turns += m.turns_user;
			acc.active += m.active_minutes ?? 0;
			acc.tokIn += m.tokens_input ?? 0;
			acc.tokOut += m.tokens_output ?? 0;
			acc.tokCR += m.tokens_cache_read ?? 0;
			acc.tokCW += m.tokens_cache_write ?? 0;
			acc.tools += m.tool_calls ?? 0;
			acc.files += m.files_edited ?? 0;
			acc.corrections += m.user_correction ?? 0;
			acc.interruptions += m.interruptions ?? 0;
			acc.inWords += m.input_words ?? 0;
			acc.outWords += m.output_words ?? 0;
			// The ratio is re-derived from weekly SUMS, so the correction words have to be reconstituted
			// per session — averaging the per-session ratios would weight a two-turn session like a
			// two-hundred-turn one.
			acc.corrWords += (m.correction_ratio ?? 0) * (m.output_words ?? 0);
			tree.weeks.set(w, acc);
		}
	}
	if (m.candidate) candidates++; else minimal++;
	const id = `claude-code/${(m.started_at || '1970-01-01').slice(0, 4)}/${(m.started_at || '1970-01-01').slice(5, 7)}/${t.session_id}`;
	const file = recordPath('conversations', id, 'conversation', dataRoot);
	const present = fs.existsSync(file);
	if (present && !flag('force')) {
		const { fields } = readRecord(file);
		if (fields.inspector_version === INSPECTOR_VERSION) { skipped++; continue; }
	}
	const { candidate, gate_reason, _repo_cwd, ...fields } = m;
	const existing = present ? readRecord(file) : { fields: {}, body: '' };
	const judged = pick(existing.fields, JUDGED_KEYS); // a re-run at a new version keeps judged fields
	const record = {
		...fields,
		depth: existing.fields.depth === 'summarized' ? 'summarized' : 'minimal',
		gate_reason: candidate ? undefined : gate_reason,
		transcript_path: templatize(t.path),
		source: `perspective/sources/${sourceId}`,
		inspected_at: nowIso(),
		...judged,
		author: `scripts/read-claude-transcripts@${INSPECTOR_VERSION}`,
	};
	if (!flag('dry-run')) writeRecord(file, record, existing.body);
	written++;
}

for (const h of homes) {
	const tree = perTree.get(h.account);
	const sourceId = `${who()}/claude-transcripts--${h.account}`;
	if (flag('dry-run')) continue;
	const counts = { files: rec.files, conversations: tree.conversations };
	if (tree.first) counts.first = tree.first.slice(0, 10);
	if (tree.last) counts.last = tree.last.slice(0, 10);
	writeSource(recordPath('sources', sourceId, 'source', dataRoot), {
		contributor: who(),
		retrospective: retrospectiveRef,
		kind: 'claude-transcripts',
		label: h.account,
		reach: tree.conversations ? 'available' : 'unavailable',
		location: templatize(h.projects),
		counts,
		read_with: `read-claude-transcripts@${INSPECTOR_VERSION}`,
		author: `scripts/read-claude-transcripts@${INSPECTOR_VERSION}`,
	});
	for (const [period, w] of tree.weeks) {
		writeRecord(recordPath('activity-weeks', `${who()}/claude-transcripts--${h.account}/${period}`, 'activity-week', dataRoot), {
			// `retrospective` is REQUIRED on every collection; without it every
			// record this writes fails `check` the moment it lands.
			retrospective: retrospectiveRef,
		contributor: who(),
			source: `perspective/sources/${sourceId}`,
			period,
			start_date: isoWeekRange(period).start,
			end_date: isoWeekRange(period).end,
			sessions: w.sessions,
			turns_user: w.turns,
			active_minutes: +w.active.toFixed(1),
			tokens_input: w.tokIn,
			tokens_output: w.tokOut,
			tokens_cache_read: w.tokCR,
			tokens_cache_write: w.tokCW,
			tokens_total: w.tokIn + w.tokOut + w.tokCR + w.tokCW,
			tool_calls: w.tools,
			files_edited: w.files,
			corrections: w.corrections,
			interruptions: w.interruptions,
			input_words: w.inWords,
			output_words: w.outWords,
			correction_ratio: w.outWords ? +(w.corrWords / w.outWords).toFixed(4) : undefined,
			// A judged `summary` written by an earlier pass is the one thing on this record a re-read
			// must not erase — everything else here is recounted, that is not.
			summary: existingWeekSummary(`${who()}/claude-transcripts--${h.account}/${period}`),
			author: `scripts/read-claude-transcripts@${INSPECTOR_VERSION}`,
		});
	}
}

process.stdout.write(`✔ files ${rec.files} · conversations ${rec.conversations} · sidecars ${rec.sidecars} · written ${written} · skipped ${skipped} (current) · minimal ${minimal} · candidates ${candidates}${flag('dry-run') ? ' · DRY RUN, nothing written' : ''}\n`);
