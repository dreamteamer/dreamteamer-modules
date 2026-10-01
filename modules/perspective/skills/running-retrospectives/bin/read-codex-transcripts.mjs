#!/usr/bin/env node
// read-codex-transcripts — the mechanical pass over every codex rollout. Writes conversations, one
// source record, and one activity-week per ISO week. Prints ONE receipt line and never a line of
// transcript text.
//
//   node read-codex-transcripts.mjs --retrospective perspective/retrospective-sessions/<id>
//        [--home <dir>] [--since YYYY-MM-DD] [--weeks N] [--limit N] [--data-root d] [--dry-run] [--force]
//
// ⚠ WHY IT EXISTS: `inventory` has been writing a `codex-transcripts` source since the first run —
// reach `available`, 53 files found — and nothing ever read it. The record said the evidence was
// reachable and the collection held zero conversations from it, which is worse than an absent
// source: an unavailable source is a stated gap, an unread one is a silent one. Same for
// `gemini-cli-transcripts`, which turns out to hold nothing at all (see below).
//
// The shape it writes is the SAME conversations record the Claude reader writes — one collection,
// one meaning per field, `harness` telling them apart. The differences are in `lib/codex-metrics.mjs`
// and they are differences of ABSENCE: no interruption event, no permission-denial marker, no
// skill-load signal, so those fields are left off rather than written as 0.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA, templatize, isoWeek, isoWeekRange } from '../lib/vault.mjs';
import { recordPath, writeRecord, readRecord, nowIso, contributorOf, writeSource } from '../lib/records.mjs';
import { computeCodexMetrics, sessionIdOf, CODEX_INSPECTOR_VERSION } from '../lib/codex-metrics.mjs';
// ⚠ From the LIB, never from the sibling reader: importing that module runs it, and its argument
// check exits 2 at load. Measured the first time this line was written the other way.
import { JUDGED_KEYS } from '../lib/metrics.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const retrospectiveRef = opt('retrospective');
if (!retrospectiveRef.startsWith('perspective/retrospective-sessions/')) { console.error('usage: --retrospective perspective/retrospective-sessions/<id> is required'); process.exit(2); }
const sessionBase = retrospectiveRef.split('/').pop();
const dataRoot = opt('data-root', DATA);
// Every evidence and model id is keyed by the CONTRIBUTOR, not by the run — a re-run must update
// this person's records rather than write a parallel set beside them. Resolved LAZILY, on first
// use: reading it eagerly made a script that should exit 2 on a bad argument crash on a missing
// session instead, and "writes nothing" was the contract it broke (read-asana, 2026-09-09).
let _who = null;
const who = () => (_who ??= contributorOf(retrospectiveRef, dataRoot));
const since = opt('since');
const limit = +opt('limit', '0');
const home = opt('home', os.homedir());
const account = 'codex';
const sourceId = `${who()}/codex-transcripts--${account}`;
const sourceRef = `perspective/sources/${sourceId}`;
const AUTHOR = `scripts/read-codex-transcripts@${CODEX_INSPECTOR_VERSION}`;

const weeksBack = (() => {
	let w = Number(opt('weeks', '0')) || 0;
	if (!w) { try { w = Number(readRecord(recordPath('retrospective-sessions', sessionBase, 'retrospective-session', dataRoot)).fields.activity_weeks_back) || 0; } catch { /* fall through */ } }
	return w || 4;
})();
const windowFloor = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - weeksBack * 7); return isoWeek(d); })();

/** Every rollout under the sessions tree. Codex nests them `YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`;
 *  the walk does not depend on that, so an archived or re-organised tree still reads. */
function rollouts(root) {
	const out = [];
	const walk = (d) => {
		let entries;
		try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
		for (const e of entries) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
		}
	};
	walk(root);
	return out.sort();
}

const sessionsDir = path.join(home, '.codex', 'sessions');
const found = fs.existsSync(sessionsDir) ? rollouts(sessionsDir) : [];

// ⚠ GROUP BY SESSION FIRST. Continuing a codex thread writes a NEW rollout carrying the SAME
// `session_id`, so the unit on disk is a sitting and the unit in the collection is a session — 53
// rollouts are 32 sessions here. One record per file put the continuations on the first file's path,
// where they were skipped as already current and their turns, tokens and tools were simply lost.
const bySession = new Map();
let notASession = 0;
for (const file of found) {
	const sid = await sessionIdOf(file);
	if (!sid) { notASession++; continue; }
	if (!bySession.has(sid)) bySession.set(sid, []);
	bySession.get(sid).push(file);
}
const groups = [...bySession.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
const rows = limit ? groups.slice(0, limit) : groups;

let written = 0, skipped = 0, minimal = 0, candidates = 0;
const weeks = new Map();
let first = '', last = '', conversations = 0;

for (const group of rows) {
	const m = await computeCodexMetrics(group, { account });
	if (!m) { notASession++; continue; }                       // no session_meta — not a retrospectiveRef
	if (since && m.started_at && m.started_at.slice(0, 10) < since) continue;
	conversations++;
	if (m.started_at) {
		if (!first || m.started_at < first) first = m.started_at;
		if (m.started_at > last) last = m.started_at;
		const w = isoWeek(new Date(m.started_at));
		if (w >= windowFloor) {
			const acc = weeks.get(w) ?? { sessions: 0, turns: 0, active: 0, tokIn: 0, tokOut: 0, tokCR: 0, tokCW: 0, tools: 0, files: 0, inWords: 0, outWords: 0 };
			acc.sessions++;
			acc.turns += m.turns_user;
			acc.active += m.active_minutes ?? 0;
			acc.tokIn += m.tokens_input ?? 0;
			acc.tokOut += m.tokens_output ?? 0;
			acc.tokCR += m.tokens_cache_read ?? 0;
			acc.tokCW += m.tokens_cache_write ?? 0;
			acc.tools += m.tool_calls ?? 0;
			acc.files += m.files_edited ?? 0;
			acc.inWords += m.input_words ?? 0;
			acc.outWords += m.output_words ?? 0;
			weeks.set(w, acc);
		}
	}
	if (m.candidate) candidates++; else minimal++;

	const stamp = m.started_at || '1970-01-01';
	const id = `codex/${stamp.slice(0, 4)}/${stamp.slice(5, 7)}/${m.session_id}`;
	const target = recordPath('conversations', id, 'conversation', dataRoot);
	const present = fs.existsSync(target);
	if (present && !flag('force')) {
		const { fields } = readRecord(target);
		if (fields.inspector_version === CODEX_INSPECTOR_VERSION) { skipped++; continue; }
	}
	const { candidate, gate_reason, _repo_cwd, _models, _subagents, _forked, _rollouts, ...fields } = m;
	const existing = present ? readRecord(target) : { fields: {}, body: '' };
	// A judged field written by a later pass survives a re-read at a new inspector version — the same
	// contract the Claude reader keeps, and the reason JUDGED_KEYS is imported rather than restated.
	const judged = {};
	for (const k of JUDGED_KEYS) if (existing.fields[k] !== undefined) judged[k] = existing.fields[k];
	const record = {
		...fields,
		depth: existing.fields.depth === 'summarized' ? 'summarized' : 'minimal',
		gate_reason: candidate ? undefined : gate_reason,
		// The FIRST rollout of the retrospectiveRef. ⚠ A session may span several; the record points at where it
		// began, and `sittings` says how many files a reader would have to open to see all of it.
		transcript_path: templatize(group[0]),
		sittings: group.length > 1 ? group.length : undefined,
		source: sourceRef,
		inspected_at: nowIso(),
		...judged,
		author: AUTHOR,
	};
	if (!flag('dry-run')) writeRecord(target, record, existing.body);
	written++;
}

if (!flag('dry-run')) {
	const counts = { files: found.length, conversations };
	if (first) counts.first = first.slice(0, 10);
	if (last) counts.last = last.slice(0, 10);
	writeSource(recordPath('sources', sourceId, 'source', dataRoot), {
		contributor: who(),
		retrospective: retrospectiveRef,
		kind: 'codex-transcripts',
		label: account,
		reach: conversations ? 'available' : 'unavailable',
		location: templatize(sessionsDir),
		counts,
		read_with: `read-codex-transcripts@${CODEX_INSPECTOR_VERSION}`,
		author: AUTHOR,
	}, conversations ? '' : `No rollout under \`${templatize(sessionsDir)}\` held a retrospectiveRef.\n`);
	for (const [period, w] of weeks) {
		const wid = `${who()}/codex-transcripts--${account}/${period}`;
		let summary;
		try { summary = readRecord(recordPath('activity-weeks', wid, 'activity-week', dataRoot)).fields.summary || undefined; } catch { /* first write */ }
		writeRecord(recordPath('activity-weeks', wid, 'activity-week', dataRoot), {
			// `retrospective` is REQUIRED on all nineteen collections since 0.2.0; a week written
			// without it fails `check` the moment it lands.
			retrospective: retrospectiveRef,
		contributor: who(),
			source: sourceRef,
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
			input_words: w.inWords,
			output_words: w.outWords,
			summary,
			author: AUTHOR,
		});
	}
}

process.stdout.write(
	`✔ codex rollouts ${found.length} in ${groups.length} session(s) · conversations ${conversations} · written ${written} · skipped ${skipped} (current)` +
	` · minimal ${minimal} · candidates ${candidates} · weeks ${weeks.size}` +
	(notASession ? ` · ${notASession} file(s) held no session_meta and are not sessions` : '') +
	`${flag('dry-run') ? ' · DRY RUN, nothing written' : ''}\n`,
);
