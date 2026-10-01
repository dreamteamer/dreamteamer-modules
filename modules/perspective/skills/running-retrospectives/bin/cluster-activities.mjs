#!/usr/bin/env node
// cluster-activities — the MECHANICAL half of stage 3 (cluster). It proposes activity CANDIDATES
// from the evidence so the model that names and refines activities never has to read raw evidence.
//
//   node cluster-activities.mjs --retrospective perspective/retrospective-sessions/<id>
//        [--data-root d] [--scratch-root d] [--gap-days 3] [--dry-run]
//
// ⚠ THIS SCRIPT WRITES NO RECORDS. Writing `activities` and `topics` is the MODEL's job: it reads
// the candidates file this produces, names each activity as a person would, decides which are one
// piece of work and which are two, and writes them with `dt add`. A candidate is a proposal about
// TIME AND REPO — nothing here judges what the work was.
//
// THE ALGORITHM, deterministic end to end:
//   1. Gather six kinds of evidence belonging to this run:
//        · conversations — records under <data-root>/perspective/conversations
//        · commits       — <scratch>/commits/<base>/*.jsonl, one JSON per line, written by read-git
//        · tickets       — records under <data-root>/perspective/tickets
//        · threads       — records under <data-root>/perspective/threads (read-gmail), placed on
//                          first_on, bucketed by the DOMAIN most of the counterparts share — mail has
//                          no repo, and "who it was with" is the nearest thing to one
//        · deliverables  — records under <data-root>/perspective/world/deliverables (read-drive), placed on
//                          last_touched_on, bucketed by their `container`; they belong to the run by
//                          `retrospective`, not `source`
//
//        · meetings      — <scratch>/meetings/<base>.jsonl, one JSON per line, written by
//                          read-meetings. Placed on `starts`, bucketed by `company` — a meeting has
//                          no repo, and who it was WITH is the nearest thing to one, exactly as the
//                          mail bucket is a domain. ⚠ Read from the scratch and never from the
//                          `meetings` records themselves: those belong to a PEER module, and this
//                          module holds no domain object. Like the commits dump the directory is
//                          routinely ABSENT — that is 0 meetings and a normal run, never an error.
//      A record belongs to the run when its `source` ref starts with
//      `perspective/sources/<base>/` (source ids are `<base>/<kind>--<label>`, so the prefix is
//      the whole test). A record with NO source is included — a hand-written or fixture record is
//      evidence too, and silently dropping it would be the worse failure.
//      The commits directory is routinely ABSENT (read-git has not been run, or ran before it
//      learned to dump commits): that is 0 commits and a normal run, never an error.
//   2. Bucket every item by its REPO KEY — conversation `repo_name`, commit `repo`, ticket
//      `project`. An item with none lands in the bucket `(unknown)`, which still clusters by time.
//   3. Sort each bucket by timestamp ascending (ties broken by kind then id, so a re-run of the
//      same evidence produces byte-identical output).
//   4. Walk the bucket and start a NEW candidate whenever the gap since the previous item exceeds
//      --gap-days. That is the whole clustering rule: work is a run of evidence with no long
//      silence in it. A candidate with one item is a SINGLETON — still emitted, flagged, because
//      a one-session activity is real and the model must see it to dismiss it.
//   5. Per candidate collect session refs, commit SHAs, branch names, ticket refs, the date span,
//      summed active_minutes / turns_user / commit_count, and `handles` — the distinct commit
//      author emails plus ticket assignee handles, which is what `collaborators` is merged on.
//   6. Derive a LABEL SEED: the top 5 most frequent non-stopword tokens across the candidate's
//      conversation titles and key_topics, commit subjects, and ticket titles. Ties break
//      alphabetically. It is a hint for the naming model, never a name.
//
// Output: <scratch>/activity-candidates/<base>.jsonl, rewritten whole on each run.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, SCRATCH, slug } from '../lib/vault.mjs';
import { listRecords, readRecord, recordPath, contributorOf} from '../lib/records.mjs';
import { contributorHandles as handlesOf, isContributor as isThem } from '../lib/identity.mjs';

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
const scratch = opt('scratch-root', SCRATCH);
const gapDays = Number(opt('gap-days', '3'));
// The ANALYSIS window, which is not the same thing as the evidence on disk. Weekly records are kept
// for all of history deliberately (the operator, 2026-09-08: "keep full history, don't delete old
// weeks") — but naming activities back to 2021 is a different job from describing this year's work,
// and it triples the candidate count with singletons nobody will read. --since drops evidence older
// than the date; without it, everything on disk is clustered, which is the v1 behaviour.
// ⚠ An unquoted YAML date parses to a Date OBJECT, not a string — `period_start: 2025-09-08` comes
// back as a Date, and `date + 'T00:00:00Z'` then produces an unparseable string, NaN, and a window
// that silently does not apply. The receipt printing "window since Mon Sep 08 2025 03:00:00 GMT+0300"
// is what gave it away. Normalise to YYYY-MM-DD before anything touches it.
const asDay = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const since = asDay(opt('since') || (() => { try { return readRecord(recordPath('retrospective-sessions', base, 'retrospective-session', dataRoot)).fields.period_start || ''; } catch { return ''; } })());
if (!Number.isFinite(gapDays) || gapDays < 0) { console.error('usage: --gap-days must be a non-negative number'); process.exit(2); }
const GAP_MS = gapDays * 86400000;

/** A record belongs to this run when its source is one of the run's sources — or when it has none. */
const belongs = (fields) => !fields.source || String(fields.source).startsWith(`perspective/sources/${who()}/`);

/** `<dataRoot>/perspective/<coll>/a/b/c.<suffix>.md` → `a/b/c` — the record id a ref is built from. */
const idFromPath = (file, coll, suffix) =>
	path.relative(path.join(dataRoot, 'perspective', coll), file).replace(new RegExp(`\\.${suffix}\\.md$`), '');

const ts = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : NaN; };
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// ── gather ────────────────────────────────────────────────────────────────────────────────────
/** items: { kind, id, at, repo, ... } */
const items = [];
/** The window gate. A ticket is kept if EITHER end of it lands in the window — an old ticket
 *  completed this year is this year's work, and a ticket opened this year is too. */
const sinceMs = since ? Date.parse(since + 'T00:00:00Z') : NaN;
let outOfWindow = 0;
const inWindow = (at, endsAt) => {
	if (!Number.isFinite(sinceMs)) return true;
	const keep = (Number.isFinite(at) && at >= sinceMs) || (Number.isFinite(endsAt) && endsAt >= sinceMs);
	if (!keep) outOfWindow++;
	return keep;
};

for (const f of listRecords(path.join(dataRoot, 'perspective', 'conversations'))) {
	const { fields } = readRecord(f);
	if (!belongs(fields)) continue;
	const at = ts(fields.started_at);
	if (!Number.isFinite(at)) continue; // undated evidence cannot be clustered by time
	if (!inWindow(at, ts(fields.ended_at))) continue;
	items.push({
		kind: 'session',
		id: idFromPath(f, 'conversations', 'conversation'),
		at,
		endsAt: ts(fields.ended_at),
		repo: fields.repo_name || (Array.isArray(fields.subject_repos) ? fields.subject_repos[0] : '') || '',
		active_minutes: Number(fields.active_minutes) || 0,
		turns_user: Number(fields.turns_user) || 0,
		words: [fields.title, ...(fields.key_topics ?? [])],
	});
}

for (const f of listRecords(path.join(dataRoot, 'perspective', 'tickets'))) {
	const { fields } = readRecord(f);
	if (!belongs(fields)) continue;
	const at = ts(fields.created_on ?? fields.completed_on);
	if (!Number.isFinite(at)) continue;
	if (!inWindow(at, ts(fields.completed_on))) continue;
	items.push({
		kind: 'ticket',
		id: idFromPath(f, 'tickets', 'ticket'),
		at,
		endsAt: ts(fields.completed_on),
		repo: fields.project || '',
		handle: fields.assignee_handle || '',
		words: [fields.title, ...(fields.tags ?? [])],
	});
}

// ⚠ THE CONTRIBUTOR FILTER. A retrospective is ONE person's perspective, and the commits scratch holds
// every author in the repo. Without this a candidate for a shared repo is a repo-wide window mixing the
// contributor's commits with hundreds of other people's — found on the first multi-author run, where a
// colleague sharing a first name and a near-identical work address landed inside the contributor's own
// activities. Handles are the run record's, unioned with the collaborator record that already carries
// one of them; a run that declares none filters NOTHING, which is honest for a solo workspace rather
// than an empty timeline. `lib/identity.mjs` holds the rule — it was four near-copies until 2026-09-09.
const contributorHandles = handlesOf(retrospective, dataRoot);
const isContributor = (email, name) => isThem(contributorHandles, email, name);
let foreignCommits = 0;

for (const f of listRecords(path.join(dataRoot, 'perspective', 'threads'))) {
	const { fields } = readRecord(f);
	if (!belongs(fields)) continue;
	const at = ts(fields.first_on);
	if (!Number.isFinite(at)) continue;
	if (!inWindow(at, ts(fields.last_on))) continue;
	// The bucket: the domain most counterparts share. `@gmail.com` and friends are not an organisation,
	// so a thread whose counterparts are all on public mail lands in `mail:(personal)`.
	const PUBLIC = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'me.com', 'walla.co.il', 'walla.com']);
	// ⚠ The contributor's OWN domain never votes — every thread has them on it, and a mailbox at
	// work.example would otherwise bucket every personal thread under the employer.
	const domains = new Map();
	for (const p of fields.participants ?? []) {
		if (isContributor(p)) continue;
		const d = String(p).split('@')[1]?.toLowerCase();
		if (!d) continue;
		domains.set(d, (domains.get(d) ?? 0) + 1);
	}
	const top = [...domains.entries()].filter(([d]) => !PUBLIC.has(d)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
	items.push({
		kind: 'thread',
		id: idFromPath(f, 'threads', 'thread'),
		at,
		endsAt: ts(fields.last_on),
		repo: top ? `mail:${top}` : 'mail:(personal)',
		participants: (fields.participants ?? []).map((p) => String(p).toLowerCase()),
		words: [fields.subject],
	});
}

for (const f of listRecords(path.join(dataRoot, 'perspective', 'deliverables'))) {
	const { fields } = readRecord(f);
	if (fields.retrospective && fields.retrospective !== retrospective) continue;   // another run's artefacts
	const at = ts(fields.last_touched_on ?? fields.created_on);
	if (!Number.isFinite(at)) continue;
	if (!inWindow(at, at)) continue;
	items.push({
		kind: 'deliverable',
		id: idFromPath(f, 'deliverables', 'deliverable'),
		at,
		endsAt: at,
		repo: fields.container ? `drive:${fields.container}` : 'drive:(unknown)',
		words: [fields.name],
	});
}

// commits: scratch jsonl, one object per line. Absent directory = 0 commits, not an error.
const commitsDir = path.join(scratch, 'commits', base);
if (fs.existsSync(commitsDir)) {
	for (const name of fs.readdirSync(commitsDir).filter((n) => n.endsWith('.jsonl')).sort()) {
		const text = fs.readFileSync(path.join(commitsDir, name), 'utf8');
		for (const line of text.split('\n')) {
			if (!line.trim()) continue;
			let c;
			try { c = JSON.parse(line); } catch { continue; } // a torn line is skipped, never fatal
			const at = ts(c.date);
			if (!Number.isFinite(at) || !c.sha) continue;
			if (!isContributor(c.author_email, c.author_name)) { foreignCommits++; continue; }
			if (!inWindow(at, at)) continue;
			items.push({
				kind: 'commit',
				id: String(c.sha),
				at,
				repo: c.repo || name.replace(/\.jsonl$/, ''),
				handle: c.author_email || '',
				branches: Array.isArray(c.branches) ? c.branches : c.branches ? [c.branches] : [],
				words: [c.subject],
			});
		}
	}
}

// meetings: scratch jsonl, one object per line, written by read-meetings. Absent directory = 0
// meetings, not an error — the same contract the commits dump has.
const meetingsFile = path.join(scratch, 'meetings', `${base}.jsonl`);
if (fs.existsSync(meetingsFile)) {
	for (const line of fs.readFileSync(meetingsFile, 'utf8').split('\n')) {
		if (!line.trim()) continue;
		let m;
		try { m = JSON.parse(line); } catch { continue; }   // a torn line is skipped, never fatal
		const at = ts(m.starts);
		if (!Number.isFinite(at) || !m.ref) continue;
		const endsAt = ts(m.ends);
		if (!inWindow(at, Number.isFinite(endsAt) ? endsAt : at)) continue;
		// The bucket is WHO IT WAS WITH. A meeting has no repo; its company is the axis a run of
		// calls actually shares, and `meeting:` keeps it distinguishable from a repo of that name.
		const company = String(m.company ?? '').split('/').pop();
		items.push({
			kind: 'meeting',
			id: String(m.ref),
			at,
			endsAt: Number.isFinite(endsAt) ? endsAt : at,
			repo: company ? `meeting:${company}` : 'meeting:(unknown)',
			participants: (m.handles ?? []).map((h) => String(h).toLowerCase()),
			words: [m.name],
		});
	}
}

// ── bucket, walk, cluster ─────────────────────────────────────────────────────────────────────
const KIND_ORDER = { session: 0, commit: 1, ticket: 2, thread: 3, deliverable: 4, meeting: 5 };
const buckets = new Map();
for (const it of items) {
	const k = it.repo || '(unknown)';
	if (!buckets.has(k)) buckets.set(k, []);
	buckets.get(k).push(it);
}

// Deliberately short and hand-picked: English filler plus the words every commit subject and
// session title carries, which would otherwise win every label seed by sheer volume.
const STOPWORDS = new Set(`a an the and or but if then else for of to in on at by with from into over under about as
is are was were be been being it its this that these those do does did done doing you she they our their your not
yes so than too very can will just should now add added adding fix fixed fixes update updated updates use used using
make made get got run running one two more most also there here what which when where who how why all any some each
other only own same chore feat refactor test tests wip merge branch main master pull request initial commit file
files code`.trim().split(/\s+/));
const tokens = (arr) => String(arr.filter(Boolean).join(' '))
	.toLowerCase()
	.split(/[^a-z0-9]+/)
	.filter((w) => w.length > 2 && !STOPWORDS.has(w));

const candidates = [];
for (const key of [...buckets.keys()].sort()) {
	const list = buckets.get(key).sort((a, b) => a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	let group = [];
	const flush = () => { if (group.length) candidates.push({ repo: key, items: group }); group = []; };
	for (const it of list) {
		if (group.length && it.at - group[group.length - 1].at > GAP_MS) flush();
		group.push(it);
	}
	flush();
}

// ── SPLIT WHAT IS TOO BIG TO NAME ──────────────────────────────────────────────────────────────
// ⚠ A GAP RULE ALONE PRODUCES UNBOUNDED CANDIDATES, and an unbounded candidate cannot be named.
// Measured 2026-09-08: one repo worked on at least every three days for six months collapsed into a
// SINGLE candidate of 257 sessions and 1,753 commits, and the naming pass simply skipped it — along
// with 44 others, together holding 616 sessions. They were not lost to a bug; they were lost because
// nobody can answer "what task is this?" about six months of continuous work.
// So a candidate also splits on SIZE. The split point is the LARGEST INTERNAL GAP, recursively:
// that is the most defensible seam available, because it is where the person actually paused.
const MAX_ITEMS = Number(opt('max-items', '40'));
const MAX_DAYS = Number(opt('max-days', '21'));
const MAX_MS = MAX_DAYS * 86400000;
function splitOversized(group) {
	const span = group[group.length - 1].at - group[0].at;
	if (group.length <= MAX_ITEMS && span <= MAX_MS) return [group];
	if (group.length < 4) return [group];   // too small to seam, whatever its span
	// The largest gap between consecutive items, excluding the very ends so a split always leaves
	// two non-trivial halves.
	let best = -1, at = -1;
	for (let i = 1; i < group.length; i++) {
		const d = group[i].at - group[i - 1].at;
		if (d > best) { best = d; at = i; }
	}
	if (at <= 0 || at >= group.length) return [group];
	return [...splitOversized(group.slice(0, at)), ...splitOversized(group.slice(at))];
}
let oversized = 0;
const sized = [];
for (const c of candidates) {
	const parts = splitOversized(c.items);
	if (parts.length > 1) oversized++;
	for (const items of parts) sized.push({ repo: c.repo, items });
}
candidates.length = 0;
candidates.push(...sized);

const seen = new Map();
const lines = candidates.map((c) => {
	const its = c.items;
	const sessions = its.filter((i) => i.kind === 'session');
	const commits = its.filter((i) => i.kind === 'commit');
	const tickets = its.filter((i) => i.kind === 'ticket');
	const threads = its.filter((i) => i.kind === 'thread');
	const deliverables = its.filter((i) => i.kind === 'deliverable');
	const meetings = its.filter((i) => i.kind === 'meeting');
	const started = day(Math.min(...its.map((i) => i.at)));
	const ended = day(Math.max(...its.map((i) => (Number.isFinite(i.endsAt) ? Math.max(i.at, i.endsAt) : i.at))));

	let key = `${slug(c.repo)}--${started}`;
	const n = (seen.get(key) ?? 0) + 1;
	seen.set(key, n);
	if (n > 1) key = `${key}--${n}`;

	const freq = new Map();
	for (const it of its) for (const w of tokens(it.words ?? [])) freq.set(w, (freq.get(w) ?? 0) + 1);
	const label_seed = [...freq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5).map(([w]) => w);

	return {
		key,
		repo: c.repo,
		started,
		ended,
		sessions: sessions.map((i) => `perspective/conversations/${i.id}`).sort(),
		commits: commits.map((i) => i.id),
		branches: [...new Set(commits.flatMap((i) => i.branches ?? []))].sort(),
		tickets: tickets.map((i) => `perspective/tickets/${i.id}`).sort(),
		threads: threads.map((i) => `perspective/threads/${i.id}`).sort(),
		deliverables: deliverables.map((i) => `perspective/world/deliverables/${i.id}`).sort(),
		// ⚠ ALREADY A QUALIFIED REF, unlike every other kind here: a meeting lives in a PEER
		// collection, so the reader parks `meetings/<id>` and nothing prefixes it with `perspective/`.
		meetings: meetings.map((i) => i.id).sort(),
		handles: [...new Set([
			...[...commits, ...tickets].map((i) => i.handle).filter(Boolean),
			...threads.flatMap((i) => i.participants ?? []),
			...meetings.flatMap((i) => i.participants ?? []),
		])].sort(),
		active_minutes: Math.round(sessions.reduce((s, i) => s + i.active_minutes, 0) * 10) / 10,
		turns_user: sessions.reduce((s, i) => s + i.turns_user, 0),
		commit_count: commits.length,
		label_seed,
		singleton: its.length === 1,
	};
});

const out = path.join(scratch, 'activity-candidates', `${base}.jsonl`);
if (!flag('dry-run')) {
	fs.mkdirSync(path.dirname(out), { recursive: true });
	fs.writeFileSync(out, lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
}

const nS = items.filter((i) => i.kind === 'session').length;
const nC = items.filter((i) => i.kind === 'commit').length;
const nT = items.filter((i) => i.kind === 'ticket').length;
const nM = items.filter((i) => i.kind === 'meeting').length;
const singletons = lines.filter((l) => l.singleton).length;
process.stdout.write(
	`✔ candidates ${lines.length} · from ${nS} sessions, ${nC} commits, ${nT} tickets, ${nM} meetings · repos ${buckets.size} · singletons ${singletons}${oversized ? ` · ${oversized} run(s) split for size (>${MAX_ITEMS} items or >${MAX_DAYS}d)` : ''}${foreignCommits ? ` · ${foreignCommits} commits by others skipped` : ''}${since ? ` · window since ${since} (${outOfWindow} items older, kept on disk)` : ''}${flag('dry-run') ? ' · DRY RUN' : ''}\n`,
);
