#!/usr/bin/env node
// read-meetings — the workspace's OWN `meetings` collection as evidence. Counted, never judged, and
// never quoted.
//
//   node read-meetings.mjs --retrospective perspective/retrospective-sessions/<id>
//        --contributor <contacts/<id> or an email> [--label <name>] [--since YYYY-MM-DD]
//        [--data-root d] [--workspace-root d] [--scratch-root d] [--dry-run]
//
// ⚠ WHY A SOURCE AT ALL, when the meetings are already records in the same workspace. Because the
// question this module asks is not "what meetings are there" — it is "what did this person's week
// consist of", and for a contributor whose work is conversations rather than commits, a calendar is
// the only store that can answer it. The same argument `read-drive` makes for the document-shaped
// contributor: an evidence source that is absent for a person is a fact about the SOURCE, never
// about the person. A perspective built from commits alone reads a consultant as idle.
//
// ⚠ WHAT IT REFUSES TO COPY, and this is the whole discipline of the source: NOT ONE WORD of a
// summary, a prep or an analysis. Those records are another module's JUDGEMENT of the call — already
// written, already attributed — and copying them here would put a judged sentence on the evidence
// rung, where every record is supposed to be counted rather than concluded. The meeting REF is the
// pointer; anyone who needs to know what was said follows it. What lands here is: how many meetings,
// how many minutes, and with whom.
//
// ⚠ ATTENDANCE IS NOT PARTICIPATION. Being on an invite says the person was in the room, not that
// they spoke, prepared, or wanted to be there. Nothing this reader writes may be read as engagement,
// and the perspective that cites it should say so.
//
// ⚠ WHY `collaborators.contact` IS SET HERE, when `references/identity.md` says that field is set
// only on confirmation and never inferred from a matching name. Both are true, because this is not a
// name match. `meetings.attendees` is an `x-reference: contacts` — a STRUCTURAL edge somebody
// already committed to in the workspace's own CRM. Following a reference the workspace asserts is
// the opposite of guessing from a string, and it is the one route by which a collaborator record may
// arrive already joined to the person's CRM record. The merge KEY is still the email (below): a
// contact with no email gets NO collaborator record, because a display name is never a person key
// and this reader will not invent one to fill a row.
//
// What it writes:
//   · one `sources` record, `<contributor>/meetings--<label>`, with `reach` and the counts
//   · one `activity-weeks` record per ISO week — `meetings_attended`, `meeting_minutes`,
//     `meeting_counterparts`. Mechanical tier, like every other counted field on that record.
//   · one `collaborators` record per other ATTENDEE, through `lib/collaborators.mjs` — keyed on the
//     contact's email, with `contact` set to the attendee's own ref
//   · `<scratch>/meetings/<base>.jsonl`, the parking lot the cluster stage reads. Meetings are
//     deliberately NOT copied into this module's data — they are a peer collection's records, and
//     this module never holds a domain object (design §8, the same reason commits live in a JSONL).
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { DATA, SCRATCH, isoWeek, isoWeekRange, slug } from '../lib/vault.mjs';
import { recordPath, writeRecord, readRecord, listRecords, contributorOf, writeSource } from '../lib/records.mjs';
import { upsertCollaborators } from '../lib/collaborators.mjs';
import { contributorHandles as handlesOf } from '../lib/identity.mjs';

const READER = 'read-meetings@1';
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const dry = flag('dry-run');

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
// The workspace root is the parent of the data root — that is what `data/…` storage paths are
// relative to, and it is where the compiled descriptor lives. `--workspace-root` splits the two for
// a fixture that keeps its records somewhere else.
const workspaceRoot = path.resolve(opt('workspace-root', path.dirname(dataRoot)));
const scratchRoot = path.resolve(opt('scratch-root', SCRATCH));
const contributorArg = opt('contributor');
if (!contributorArg) { console.error('usage: --contributor <contacts/<id> or an email> is required — whose calendar this is'); process.exit(2); }
const since = opt('since');
const label = opt('label', 'this-workspace');

const sourceId = `${who()}/meetings--${slug(label)}`;
const sourceRef = `perspective/sources/${sourceId}`;

/** A `sources` record for a reach the run could not achieve is still a record — that is the point. */
function unavailable(why) {
	if (!dry) {
		writeSource(recordPath('sources', sourceId, 'source', dataRoot), {
			contributor: who(), retrospective, kind: 'meetings', label,
			reach: 'unavailable', location: '${workspaceFolder}', read_with: READER, author: `scripts/${READER}`,
		}, `${why}\n`);
	}
	process.stdout.write(`✖ meetings ${label} unavailable — ${why}\n`);
}

// ── where the peer collection keeps its records ──────────────────────────────────────────────────
// The COMPILED descriptor is the authority on `storage.path` and `storage.suffix` — never a guess,
// because a consuming workspace may file them anywhere. The fallback is the shipped descriptor's own
// values, for a fixture with no compiled runtime beside it.
function peerStorage(name, fallbackPath, fallbackSuffix) {
	const compiled = path.join(workspaceRoot, '.dreamteamer', 'collections', `${name}.collection.yaml`);
	if (fs.existsSync(compiled)) {
		try {
			const doc = yaml.load(fs.readFileSync(compiled, 'utf8')) ?? {};
			const p = doc.storage?.path, s = doc.storage?.suffix;
			if (p) return { dir: path.join(workspaceRoot, String(p)), suffix: String(s || fallbackSuffix), compiled: true };
		} catch { /* an unreadable descriptor falls through to the default, and the body says so */ }
	}
	return { dir: path.join(workspaceRoot, fallbackPath), suffix: fallbackSuffix, compiled: false };
}
const MEETINGS = peerStorage('meetings', 'data/meetings', 'meeting');
const CONTACTS = peerStorage('contacts', 'data/contacts', 'contact');

if (!MEETINGS.compiled && !fs.existsSync(MEETINGS.dir)) {
	unavailable(`No \`meetings\` collection in this workspace — neither a compiled descriptor nor ${path.relative(workspaceRoot, MEETINGS.dir)}. The meetings module is a declared PEER of this one: a workspace without it simply has no calendar evidence, which is a stated gap rather than a failure.`);
	process.exit(0);
}

/** `<dir>/a/b/c.<suffix>.md` → `a/b/c`, the record id a ref is built from. */
const idOf = (file, dir, suffix) => path.relative(dir, file).replace(new RegExp(`\\.${suffix}\\.md$`), '');
const lower = (s) => String(s ?? '').trim().toLowerCase();
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

// ── the contacts index, read once ────────────────────────────────────────────────────────────────
// Every contact by ref, with the EMAILS the record carries. `email` is the shipped field; `emails`
// is read too so a workspace that added a second address is not silently halved.
const contacts = new Map();   // `contacts/<id>` → { ref, name, emails: [lowercased] }
for (const f of listRecords(CONTACTS.dir)) {
	let fields;
	try { ({ fields } = readRecord(f)); } catch { continue; }
	const ref = `contacts/${idOf(f, CONTACTS.dir, CONTACTS.suffix)}`;
	const emails = [...new Set([...list(fields.email), ...list(fields.emails)].map(lower).filter((e) => e.includes('@')))];
	contacts.set(ref, { ref, name: String(fields.name ?? ref.split('/').pop()), emails });
}
// The same index keyed by EMAIL. An `attendees_raw` line is free text, but the address inside it is
// a person KEY — the very thing `lib/collaborators.mjs` merges on — so matching one against a
// contact's own `email` field is the identical structural join a ref match is, not a name match.
const byEmail = new Map();   // lowercased address → the contact
for (const c of contacts.values()) for (const e of c.emails) if (!byEmail.has(e)) byEmail.set(e, c);

// ── who the contributor is, in the two vocabularies this reader has to speak ─────────────────────
// `attendees` is a list of contact REFS, so the structural test is a ref match. `attendees_raw` is
// free text the calendar wrote, so the test there is an EMAIL match — never a display name, which
// two people share (`lib/collaborators.mjs` and references/identity.md both refuse it, and a reader
// that matched on one would attribute a stranger's whole week to the contributor).
let contactRef = '';
const handles = new Set();
// ⚠ WHOSE MEETINGS THESE ARE IS THE RUN RECORD'S ANSWER, not this flag's. Every id written here is
// keyed by `who()`, the run's contributor slug, so `--contributor` chooses which IDENTITY of that
// person to look them up by — never a different person. That is why the run's own `handles` are
// unioned in below, exactly as read-gmail does, and why an argument this workspace has never seen is
// REPORTED rather than treated as an empty result: the fallback is honest, silence about it is not.
let unknownArg = '';
if (contributorArg.startsWith('contacts/')) {
	contactRef = contributorArg;
	if (!contacts.has(contactRef)) unknownArg = contributorArg;
	for (const e of contacts.get(contactRef)?.emails ?? []) handles.add(e);
} else if (contributorArg.includes('@')) {
	handles.add(lower(contributorArg));
	const hit = [...contacts.values()].find((c) => c.emails.includes(lower(contributorArg)));
	if (hit) { contactRef = hit.ref; for (const e of hit.emails) handles.add(e); }
	else unknownArg = contributorArg;
} else {
	console.error(`usage: --contributor takes \`contacts/<id>\` or an email address, not ${JSON.stringify(contributorArg)} — a bare name is never a person key`);
	process.exit(2);
}
// The run record's own handles, so a second address of theirs still counts as theirs.
for (const h of handlesOf(retrospective, dataRoot) ?? []) if (String(h).includes('@')) handles.add(lower(h));

if (!contactRef && !handles.size) {
	unavailable(`\`${contributorArg}\` resolves to neither a contacts record nor an email address, so no meeting can be attributed to this contributor.`);
	process.exit(0);
}

// ── walk ─────────────────────────────────────────────────────────────────────────────────────────
/** The meeting's instant. `starts` when it has one; otherwise the date its id encodes, which every
 *  id does by construction (`{{ starts | date:YYYY/MM }}/{{ starts | date }}--…`). */
function instantOf(fields, id) {
	const s = String(fields.starts ?? '').trim();
	if (s && Number.isFinite(Date.parse(s))) return s;
	const m = /(\d{4}-\d{2}-\d{2})/.exec(id);
	return m ? `${m[1]}T00:00:00Z` : '';
}

const kept = [];
let scanned = 0, undated = 0, older = 0, byRef = 0, byRaw = 0;
for (const file of listRecords(MEETINGS.dir)) {
	let fields;
	try { ({ fields } = readRecord(file)); } catch { continue; }
	scanned++;
	const id = idOf(file, MEETINGS.dir, MEETINGS.suffix);
	const attendees = list(fields.attendees).map(String);
	const raw = list(fields.attendees_raw).map((r) => lower(r));
	const hitRef = contactRef && attendees.includes(contactRef);
	const hitRaw = !hitRef && raw.some((line) => [...handles].some((h) => line.includes(h)));
	if (!hitRef && !hitRaw) continue;
	const starts = instantOf(fields, id);
	if (!starts) { undated++; continue; }          // undated evidence cannot be placed on a timeline
	const day = starts.slice(0, 10);
	if (since && day < since) { older++; continue; }
	hitRef ? byRef++ : byRaw++;
	const ends = String(fields.ends ?? '').trim();
	const minutes = Number.isFinite(Date.parse(starts)) && Number.isFinite(Date.parse(ends))
		? Math.max(0, Math.round((Date.parse(ends) - Date.parse(starts)) / 60000))
		: undefined;
	// The counterparts are the other people the meeting places in the room, by the two vocabularies
	// this reader speaks — and BOTH of them are structural.
	//   · an `attendees` REF other than the contributor's: an edge somebody already committed to;
	//   · an EMAIL inside an `attendees_raw` line that resolves to a contact record's own address.
	// ⚠ The second used to be refused here, on the grounds that a raw line is "not good enough to
	// name anybody else". That was inconsistent with this reader's own contributor test three lines
	// up, which matches the contributor by exactly such an address: the rule the module actually
	// holds is that a DISPLAY NAME is not a person key and an EMAIL is. A calendar sync that never
	// resolved its attendees to contacts is the normal state of a fresh workspace, so refusing raw
	// emails dropped every counterpart of every unresolved meeting — measured on a fixture where one
	// person's two meetings counted as one.
	// A raw line with no address still yields nobody, and a NAME in one is never mined.
	const seen = new Set();
	const counterparts = [];
	const take = (c) => { if (c && c.ref !== contactRef && !seen.has(c.ref)) { seen.add(c.ref); counterparts.push(c); } };
	for (const a of attendees) if (contacts.has(a)) take(contacts.get(a));
	for (const line of raw) for (const [email, c] of byEmail) if (line.includes(email) && !handles.has(email)) take(c);
	kept.push({
		id, ref: `meetings/${id}`, name: String(fields.name ?? id.split('/').pop()),
		starts, ends: ends || undefined, day, minutes,
		company: fields.company ? String(fields.company) : '',
		counterparts,
		matched: hitRef ? 'attendee-ref' : 'attendees-raw',
	});
}
kept.sort((a, b) => (a.starts < b.starts ? -1 : a.starts > b.starts ? 1 : a.id < b.id ? -1 : 1));

// ── the week, and the people ─────────────────────────────────────────────────────────────────────
const weeks = new Map();     // period → { meetings, minutes, counterparts: Set }
const people = new Map();    // email → { email, name, contact, count, days }
let nameless = 0;
const namelessNames = new Set();
for (const m of kept) {
	const period = isoWeek(new Date(m.starts));
	const acc = weeks.get(period) ?? { meetings: 0, minutes: 0, counterparts: new Set() };
	acc.meetings++;
	acc.minutes += m.minutes ?? 0;
	for (const c of m.counterparts) if (c.emails.length) acc.counterparts.add(c.emails[0]);
	weeks.set(period, acc);
	for (const c of m.counterparts) {
		// ⚠ NO EMAIL, NO COLLABORATOR. The merge key is an email or a system id, and a bare display
		// name is neither — two people share a name, nobody shares an address. Writing a record keyed
		// on the name is how one person's work gets attributed to another, and the receipt says how
		// many attendees were dropped for exactly this reason rather than swallowing the gap.
		if (!c.emails.length) { nameless++; namelessNames.add(c.name); continue; }
		const key = c.emails[0];
		const p = people.get(key) ?? { email: key, name: c.name, contact: c.ref, count: 0, days: [] };
		p.count++; p.days.push(m.day);
		people.set(key, p);
	}
}

const collab = upsertCollaborators({
	dataRoot, contributorSlug: who(), retrospective, sourceRef, people: [...people.values()],
	role: 'attendee', author: `scripts/${READER}`,
	context: `an attendee of a meeting the contributor also attended (meetings, ${label})`, dryRun: dry,
});

// ── write ────────────────────────────────────────────────────────────────────────────────────────
if (!dry) {
	// The parking lot the cluster stage reads. Rewritten whole per run, exactly like read-git's
	// commits dump, so a re-read never leaves a stale line behind.
	const jsonl = path.join(scratchRoot, 'meetings', `${base}.jsonl`);
	fs.mkdirSync(path.dirname(jsonl), { recursive: true });
	fs.writeFileSync(jsonl, kept.map((m) => JSON.stringify({
		ref: m.ref, id: m.id, name: m.name, starts: m.starts, ends: m.ends, day: m.day,
		minutes: m.minutes, company: m.company || undefined, matched: m.matched,
		// The counterpart EMAILS, which is what `collaborators` is merged on. The contributor's own
		// address is deliberately absent: they are on every meeting, so including it would put them
		// into the handles of every candidate the clusterer builds.
		handles: m.counterparts.flatMap((c) => c.emails.slice(0, 1)),
	})).map((l) => `${l}\n`).join(''));

	writeSource(recordPath('sources', sourceId, 'source', dataRoot), {
		contributor: who(), retrospective, kind: 'meetings', label,
		reach: kept.length ? 'available' : 'unavailable',
		location: '${workspaceFolder}',
		counts: {
			scanned, attended: kept.length, by_attendee_ref: byRef, by_attendees_raw: byRaw,
			counterparts: people.size, attendees_without_an_email: nameless,
			undated, older_than_since: since ? older : undefined,
			minutes: kept.reduce((n, m) => n + (m.minutes ?? 0), 0),
			first: kept[0]?.day, last: kept.at(-1)?.day,
		},
		read_with: READER, author: `scripts/${READER}`,
	}, [
		`The workspace's own \`meetings\` collection, read as evidence: ${scanned} meeting(s) scanned, ${kept.length} kept`,
		`because \`${contactRef || contributorArg}\` is on them.`,
		'',
		'⚠ Counts, minutes and attendee handles only. NOT ONE WORD of a summary, prep or analysis is copied',
		'here — those are another module\'s judgement of the call, and the meeting ref is the pointer to them.',
		'',
		'⚠ Attendance is not participation: an invite says the person was in the room, never that they spoke,',
		'prepared, or wanted to be there.',
	].join('\n') + '\n');

	for (const [period, w] of weeks) {
		const wid = `${who()}/meetings--${slug(label)}/${period}`;
		// A recount must not delete the one field on this record a model wrote — the same trap the
		// transcripts reader had, and the one the idempotency gate exists to keep closed.
		let summary;
		try { summary = readRecord(recordPath('activity-weeks', wid, 'activity-week', dataRoot)).fields.summary || undefined; } catch { /* first write */ }
		const { start, end } = isoWeekRange(period);
		writeRecord(recordPath('activity-weeks', wid, 'activity-week', dataRoot), {
			// `retrospective` is REQUIRED on all nineteen collections since 0.2.0; a week written
			// without it fails `check` the moment it lands.
			retrospective,
			contributor: who(),
			source: sourceRef, period, start_date: start, end_date: end,
			meetings_attended: w.meetings,
			// Absent, not 0: a week whose meetings carry no `ends` was not a week of zero-length
			// meetings, it is a week the calendar could not be asked how long they were.
			meeting_minutes: w.minutes || undefined,
			meeting_counterparts: w.counterparts.size || undefined,
			summary,
			author: `scripts/${READER}`,
		});
	}
}

process.stdout.write(
	`✔ meetings ${label} · scanned ${scanned} · attended ${kept.length} (${byRef} by attendee ref, ${byRaw} by attendees_raw)`
	+ ` · minutes ${kept.reduce((n, m) => n + (m.minutes ?? 0), 0)} · weeks ${weeks.size}`
	+ ` · counterparts ${people.size} · collaborators +${collab.added} (=${collab.matched} existing)`
	+ (unknownArg ? ` · ⚠ ${unknownArg} matches no contacts record here — matched on the run record's own handles instead` : '')
	+ (nameless ? ` · ⚠ ${nameless} attendee(s) with no email got NO collaborator (${[...namelessNames].sort().slice(0, 3).join(', ')}) — a display name is never a person key` : '')
	+ (undated ? ` · ${undated} undated` : '')
	+ (since && older ? ` · ${older} older than ${since}` : '')
	+ `${dry ? ' · DRY RUN, nothing written' : ''}\n`,
);
