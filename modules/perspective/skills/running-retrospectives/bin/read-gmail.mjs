#!/usr/bin/env node
// read-gmail — the mechanical pass over a mailbox: every thread the contributor WROTE IN during the
// window becomes one `threads` record; every counterpart becomes (or extends) a `collaborators`
// record; every week gets `threads_touched` and `messages_sent`. Counted, never judged.
//
//   node read-gmail.mjs --retrospective perspective/retrospective-sessions/<id> --contributor <email>
//        [--as <google-account-email>] [--since YYYY-MM-DD] [--limit N] [--concurrency 6]
//        [--data-root d] [--dry-run]
//
// ⚠ WHY "WROTE IN" AND NOT "RECEIVED". A mailbox is mostly other people's noise — newsletters,
// notifications, threads one was copied on and never read. The evidence of a person's WORK is what
// they sent, so the query is `from:<contributor>` and a thread with none of their messages is
// dropped even if fetched. Reading is invisible here, exactly as it is in Drive.
//
// ⚠ WHAT IT KEEPS AND WHAT IT REFUSES TO. Subject, participants (as handles), counts, dates, the
// thread URL. NO bodies, NO snippets, NO attachments, NO labels — `lib/gmail.mjs` says why. The
// reader mints its token from the credential the google-workspace tool already holds (`lib/google-auth.mjs`):
// no new grant, no browser, no broad permission. A missing credential is a `sources` record with
// `reach: unavailable`, not an error.
import { DATA, isoWeek, isoWeekRange, slug } from '../lib/vault.mjs';
import { recordPath, writeRecord, readRecord, listRecords, contributorOf, writeSource } from '../lib/records.mjs';
import { accessTokenFor, googleAccounts, gmail } from '../lib/google-auth.mjs';
import { summarizeThread } from '../lib/gmail.mjs';
import { upsertCollaborators } from '../lib/collaborators.mjs';
import path from 'node:path';

const READER = 'read-gmail@1';
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const dry = flag('dry-run');

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
const contributor = opt('contributor').toLowerCase();
if (!contributor) { console.error('usage: --contributor <email> is required'); process.exit(2); }
const as = (opt('as') || contributor).toLowerCase();
const since = opt('since') || (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 365); return d.toISOString().slice(0, 10); })();
const limit = Number(opt('limit', '0')) || 0;
const concurrency = Math.max(1, Number(opt('concurrency', '6')) || 6);

const sourceId = `${who()}/gmail--${slug(as)}`;
const sourceRef = `perspective/sources/${sourceId}`;

function unavailable(why) {
	if (!dry) writeSource(recordPath('sources', sourceId, 'source', dataRoot), { contributor: who(), retrospective, kind: 'gmail', label: `gmail as ${as}`, reach: 'unavailable', read_with: READER, author: `scripts/${READER}` }, `${why}\n`);
	process.stdout.write(`✖ gmail as ${as} unavailable — ${why}\n`);
}

const token = await accessTokenFor(as);
if (!token) { unavailable(`No stored Google credential for ${as}. Accounts that do have one: ${googleAccounts().join(', ') || 'none'}.`); process.exit(0); }

// Every handle the contributor is known by, so a message from a second address of theirs counts as theirs.
const contributorHandles = new Set([contributor, as]);
for (const f of listRecords(path.join(dataRoot, 'perspective', 'world', 'users', who()))) {
	const h = (readRecord(f).fields.handles ?? []).map((x) => String(x).toLowerCase());
	if (h.includes(contributor)) for (const x of h) if (x.includes('@')) contributorHandles.add(x);
}

// ── list ─────────────────────────────────────────────────────────────────────────────────────────
const q = `from:${contributor} after:${since.replace(/-/g, '/')}`;
const ids = [];
let pageToken;
do {
	const page = await gmail(token, 'threads', { q, maxResults: 500, pageToken });
	for (const t of page.threads ?? []) ids.push(t.id);
	pageToken = page.nextPageToken;
	if (limit && ids.length >= limit) break;
} while (pageToken);
const wanted = limit ? ids.slice(0, limit) : ids;

// ── fetch, bounded concurrency ───────────────────────────────────────────────────────────────────
const HEADERS = ['From', 'To', 'Cc', 'Subject'];
const summaries = [];
let fetched = 0, dropped = 0, failed = 0;
async function worker(queue) {
	for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
		try {
			const t = await gmail(token, `threads/${id}`, { format: 'metadata', metadataHeaders: HEADERS });
			fetched++;
			const s = summarizeThread(t, contributorHandles);
			if (s) summaries.push(s); else dropped++;
		} catch (e) { failed++; process.stderr.write(`thread ${id}: ${String(e.message).slice(0, 120)}\n`); }
	}
}
const queue = [...wanted];
await Promise.all(Array.from({ length: concurrency }, () => worker(queue)));
summaries.sort((a, b) => (a.fields.first_on < b.fields.first_on ? -1 : 1));

// ── write ────────────────────────────────────────────────────────────────────────────────────────
const weeks = new Map();       // period → { threads: Set, sent: n }
const people = new Map();      // email → { email, name, count, days }
let written = 0;
for (const s of summaries) {
	if (!dry) {
		writeRecord(recordPath('threads', `${sourceId.split('/').pop()}/${s.fields.external_id}`, 'thread', dataRoot), {
		contributor: who(),
			source: sourceRef,
			...s.fields,
			read_with: READER,
			author: `scripts/${READER}`,
		}, `${s.fields.message_count} messages, ${s.fields.contributor_messages} by the contributor, ${s.fields.first_on} → ${s.fields.last_on}.\n\nParticipants (handles): ${s.fields.participants.join(' · ')}\n`);
		written++;
	}
	for (const d of s.sentDays) {
		const w = isoWeek(new Date(`${d}T00:00:00Z`));
		const acc = weeks.get(w) ?? { threads: new Set(), sent: 0 };
		acc.threads.add(s.fields.external_id); acc.sent++;
		weeks.set(w, acc);
	}
	for (const c of s.counterparts) {
		const p = people.get(c.email) ?? { email: c.email, name: c.name, count: 0, days: [] };
		if (!p.name && c.name) p.name = c.name;
		p.count++; p.days.push(s.fields.first_on, s.fields.last_on);
		people.set(c.email, p);
	}
}

const collab = upsertCollaborators({
	dataRoot, contributorSlug: who(), retrospective, sourceRef, people: [...people.values()],
	role: 'correspondent', author: `scripts/${READER}`, context: `seen on a mail thread with the contributor (gmail as ${as})`, dryRun: dry,
});

if (!dry) {
	writeSource(recordPath('sources', sourceId, 'source', dataRoot), {
		contributor: who(),
		retrospective, kind: 'gmail', label: `gmail as ${as}`,
		reach: summaries.length ? 'available' : 'unavailable',
		counts: {
			listed: ids.length, fetched, participated: summaries.length, dropped_no_own_message: dropped, failed,
			messages_sent: summaries.reduce((n, s) => n + s.fields.contributor_messages, 0),
			first: summaries[0]?.fields.first_on, last: summaries.at(-1)?.fields.last_on,
		},
		read_with: READER, author: `scripts/${READER}`,
	}, [
		`Threads matching \`${q}\` in the mailbox of \`${as}\`, kept when \`${contributor}\` (or another of their handles) sent at least one message.`,
		'',
		'⚠ Subjects, participant handles, counts and dates only. No bodies, no snippets, no attachments, no labels — the',
		'record says WHO wrote to WHOM, how often and when, and nothing about what was said. Reading is invisible here.',
	].join('\n') + '\n');
	for (const [period, w] of weeks) {
		const wid = `${who()}/gmail--${slug(as)}/${period}`;
		let summary;
		try { summary = readRecord(recordPath('activity-weeks', wid, 'activity-week', dataRoot)).fields.summary || undefined; } catch { /* first write */ }
		const { start, end } = isoWeekRange(period);
		writeRecord(recordPath('activity-weeks', wid, 'activity-week', dataRoot), {
			// `retrospective` is REQUIRED on all nineteen collections since 0.2.0; a week written
			// without it fails `check` the moment it lands.
			retrospective,
		contributor: who(),
			source: sourceRef, period, start_date: start, end_date: end,
			threads_touched: w.threads.size, messages_sent: w.sent, summary, author: `scripts/${READER}`,
		});
	}
}

process.stdout.write(
	`✔ gmail as ${as} · listed ${ids.length} · fetched ${fetched} · participated ${summaries.length} · dropped ${dropped} · failed ${failed}`
	+ ` · threads written ${written} · weeks ${weeks.size} · collaborators +${collab.added} (=${collab.matched} existing)${dry ? ' · DRY RUN, nothing written' : ''}\n`,
);
