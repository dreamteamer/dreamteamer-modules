#!/usr/bin/env node
// derive-collaborators — WHO the work was with, read out of evidence that was already stored.
//
//   node derive-collaborators.mjs --retrospective perspective/retrospective-sessions/<id>
//        [--data-root d] [--scratch-root d] [--dry-run]
//
// WHY THIS EXISTS. Two separate holes, both silent without it:
//
//   1. A READER WRITES ONLY THE PERSON IT IS LOOKING AT. A ticket reader that upserts the ASSIGNEE
//      alone leaves a contributor whose tickets are all self-assigned with ONE collaborator —
//      themselves — while those tickets carry their counterparts in `followers`. A collaborator
//      model that says a product owner works alone is a fact about the reader, not the person.
//   2. NOTHING ELSE ATTACHES A COLLABORATOR TO AN ACTIVITY. `attach-evidence` assigns sessions,
//      commits, branches and tickets; typing `collaborators` by hand in the naming pass is the
//      transcription failure that script exists to prevent, and leaves "who was this work with"
//      with no answer.
//
// So this reads the evidence records as they already sit on disk — no network, no credential, no
// re-read — and does the two mechanical halves:
//
//   · UPSERT a collaborator per person key found in tickets (`assignee_handle`, `followers`),
//     threads (`participants`), deliverables (`last_touched_by`) and the cluster candidates
//     (`handles`: commit authors + ticket assignees), through `lib/collaborators.mjs`, which is the
//     one place that knows the merge rule.
//   · ATTACH `collaborators` (and the `collaborative` flag `check-records` pins to it) onto every
//     activity, from the evidence THAT ACTIVITY ALREADY CITES.
//
// THE CONTRIBUTOR IS NEVER THEIR OWN COLLABORATOR. They are on every piece of their own evidence;
// attaching them would make `collaborative` true everywhere and the flag would mean nothing.
//
// A DISPLAY NAME IS NOT A PERSON KEY. Ticket comment authors appear in the trail as names only
// (`**Some Name · <date>**`) and are deliberately NOT read here — `lib/collaborators.mjs`
// refuses a bare name for the reason that file carries, and parsing one out of a rendered body to
// get round it would be that same merge-by-name wearing a regex.
//
// Idempotent: re-running attaches the same set and reports `unchanged`.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, SCRATCH } from '../lib/workspace.mjs';
import { listRecords, readRecord, writeRecord, contributorOf, collectionDir, recordId } from '../lib/records.mjs';
import { upsertCollaborators } from '../lib/collaborators.mjs';
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
const dryRun = flag('dry-run');

const lower = (s) => String(s ?? '').toLowerCase();
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
const day = (v) => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : undefined);
/** A record file → its qualified ref, `perspective/<collection>/<id>`. */
const refOf = (file, collection) => `perspective/${collection}/${recordId(collection, file, dataRoot)}`;

// The contributor's OWN handles, seeded on the run record. This pass is the one that CREATES the
// collaborator records, so it cannot read them: whatever the person declared at `installed` is all
// there is, and an address missing from it becomes a second person here. `handles` is the field, on
// the run record, for exactly that reason.
const myHandles = contributorHandles(retrospective, dataRoot) ?? new Set();
if (!myHandles.size) { console.error(`retrospective ${base} declares no handles — nothing can be attributed to the contributor`); process.exit(2); }

// ── 1. every person key the stored evidence carries, and where it was seen ───────────────────────
// `people` is keyed by role, because `upsertCollaborators` stamps one role per batch — the same
// person seen as an assignee here and a correspondent there accumulates both, which is the point of
// `roles_observed`.
// And by SOURCE, because `collaborators.sources` references source records: a person met on a
// ticket is evidenced by that ticket's source, and stamping the retrospective there instead is a
// reference at the wrong collection, which `dt check` refuses.
const people = new Map();   // `${role}\u0000${sourceRef}` → Map(key → { email, name, days:Set, count })
function met(role, sourceRef, key, { name, on } = {}) {
	if (!key || !String(key).includes('@')) return;   // an email or a system id; a bare name is not a key
	if (!sourceRef) return;                           // no source record to evidence it against
	const group = `${role}\u0000${sourceRef}`;
	if (!people.has(group)) people.set(group, new Map());
	const bucket = people.get(group);
	const k = lower(key);
	if (!bucket.has(k)) bucket.set(k, { email: String(key), name, days: new Set(), count: 0 });
	const p = bucket.get(k);
	if (!p.name && name) p.name = name;
	if (on) p.days.add(on);
	p.count++;
}

// evidence ref → the person keys on it, so pass 2 need not re-read a record it already opened
const keysOn = new Map();
const note = (ref, ...keys) => {
	if (!keysOn.has(ref)) keysOn.set(ref, new Set());
	for (const k of keys.flat()) if (k && String(k).includes('@')) keysOn.get(ref).add(lower(k));
};

const belongs = (fields) =>
	!fields.retrospective || fields.retrospective === retrospective
		? !fields.source || String(fields.source).includes(`/${who()}/`)
		: false;

for (const f of listRecords(collectionDir('tickets', dataRoot))) {
	const { fields } = readRecord(f);
	if (!belongs(fields)) continue;
	const ref = refOf(f, 'tickets');
	const on = day(fields.created_on ?? fields.completed_on);
	met('assignee', fields.source, fields.assignee_handle, { on });
	for (const follower of list(fields.followers)) met('follower', fields.source, follower, { on });
	note(ref, fields.assignee_handle, list(fields.followers));
}
for (const f of listRecords(collectionDir('threads', dataRoot))) {
	const { fields } = readRecord(f);
	if (!belongs(fields)) continue;
	const ref = refOf(f, 'threads');
	const on = day(fields.first_on);
	for (const p of list(fields.participants)) met('correspondent', fields.source, p, { on });
	note(ref, list(fields.participants));
}
for (const f of listRecords(collectionDir('deliverables', dataRoot))) {
	const { fields } = readRecord(f);
	if (!belongs(fields)) continue;
	const ref = refOf(f, 'deliverables');
	met('editor', fields.source, fields.last_touched_by, { on: day(fields.last_touched_on ?? fields.created_on) });
	note(ref, fields.last_touched_by);
}

// The cluster candidates carry the commit AUTHORS, which no record does — a commit is a bare SHA on
// an activity and git is the store. Read for ATTACHING ONLY, never for upserting: this pass writes
// a collaborator out of an evidence RECORD, whose own `source` says what evidences it, and a commit
// author has no record and therefore no source to point at. A handle here that matches nobody is
// counted and reported rather than invented — most of them are the contributor's own git aliases.
const candidates = new Map();
const candFile = path.join(scratch, 'activity-candidates', `${base}.jsonl`);
if (fs.existsSync(candFile)) {
	for (const line of fs.readFileSync(candFile, 'utf8').split('\n')) {
		if (!line.trim()) continue;
		try { const c = JSON.parse(line); candidates.set(c.key, c); }
		catch { /* a torn line is skipped, never fatal */ }
	}
}

let added = 0, matchedUp = 0;
for (const [group, bucket] of people) {
	const [role, sourceRef] = group.split('\u0000');
	const res = upsertCollaborators({
		dataRoot, contributorSlug: who(), retrospective, sourceRef,
		people: [...bucket.values()].map((p) => ({ email: p.email, name: p.name, count: p.count, days: [...p.days] })),
		role,
		author: 'scripts/derive-collaborators@1',
		context: `${role} on ${sourceRef.split('/').pop()}, read out of stored evidence`,
		dryRun,
	});
	added += res.added;
	matchedUp += res.matched;
}

// ── 2. handle → collaborator ref, and the contributor's own record, which is excluded ────────────
const refByHandle = new Map();
let selfRef = null;
for (const f of listRecords(path.join(collectionDir('users', dataRoot), who()))) {
	const ref = refOf(f, 'users');
	const handles = list(readRecord(f).fields.handles).map(lower);
	for (const h of handles) if (!refByHandle.has(h)) refByHandle.set(h, ref);
	if (handles.some((h) => myHandles.has(h))) selfRef = ref;
}

// ── 3. attach to every activity, from the evidence it already cites ──────────────────────────────
let touched = 0, unchanged = 0, noEvidence = 0, unmapped = 0;
for (const file of listRecords(path.join(collectionDir('activities', dataRoot), who()))) {
	const { fields, body } = readRecord(file);
	const keys = new Set();
	for (const ref of [...list(fields.tickets), ...list(fields.threads), ...list(fields.deliverables)]) {
		for (const k of keysOn.get(ref) ?? []) keys.add(k);
	}
	for (const h of candidates.get(fields.from_candidate)?.handles ?? []) keys.add(lower(h));

	const refs = new Set();
	for (const k of keys) {
		if (myHandles.has(k)) continue;   // any alias of the contributor's own, not just the seed one
		const ref = refByHandle.get(k);
		if (!ref) { unmapped++; continue; }
		if (ref === selfRef) continue;   // another alias of the contributor's own record
		refs.add(ref);
	}
	if (!keys.size) noEvidence++;

	// ADDITIVE, never a replacement. A mature workspace holds activities whose collaborators a naming
	// pass typed by hand, and a REPLACING run would delete every one this pass cannot re-derive — a
	// person's knowledge silently overwritten by a script's. What a
	// derivation may do is add what the evidence proves and correct the flag; what it may not do is
	// delete what it merely failed to find. A wrong ref is caught by `dt check`, not by this.
	const collaborators = [...new Set([...list(fields.collaborators), ...refs])].sort();
	const next = { ...fields };
	if (collaborators.length) { next.collaborators = collaborators; next.collaborative = true; }
	else { delete next.collaborators; next.collaborative = false; }
	if (JSON.stringify(next) === JSON.stringify(fields)) { unchanged++; continue; }
	if (!dryRun) writeRecord(file, next, body);
	touched++;
}

// ── 4. the ticket's assignee, as a REFERENCE rather than an address ──────────────────────────────
// `perspective/users.tickets` is a generated mirror of `tickets.assignee` (`mirror_of: assignee`)
// — and nothing ever wrote the assignee. `read-asana` stores `assignee_handle`, the raw email, because at
// the moment it writes a ticket the collaborator records do not exist yet: it creates them in a later
// pass over the same tasks. Without this step every ticket carries an address and no assignee, and
// every collaborator board shows zero tickets. The handle→ref map above is the same map that
// resolves it, and by the time this runs the records it needs are on disk.
//
// Unresolvable stays EMPTY. A handle nobody is known by gets no reference — a pointer at a record
// that does not exist is worse than a blank field, and `dt check` refuses it either way.
let stamped = 0, alreadyStamped = 0, noRef = 0;
for (const file of listRecords(collectionDir('tickets', dataRoot))) {
	const { fields, body } = readRecord(file);
	const handle = lower(fields.assignee_handle);
	if (!handle) continue;
	const ref = refByHandle.get(handle);
	if (!ref) { noRef++; continue; }
	if (fields.assignee === ref) { alreadyStamped++; continue; }
	if (!dryRun) writeRecord(file, { ...fields, assignee: ref }, body);
	stamped++;
}

process.stdout.write(
	`✔ collaborators added ${added} · merged into existing ${matchedUp}` +
	` · activities touched ${touched}, unchanged ${unchanged}` +
	` · ${noEvidence} activities cite no person-bearing evidence` +
	` · ticket assignees stamped ${stamped}, already ${alreadyStamped}, unresolvable ${noRef}` +
	(unmapped ? ` · ⚠ ${unmapped} handle sighting(s) matched no collaborator record` : '') +
	`${dryRun ? ' · DRY RUN, nothing written' : ''}\n`,
);
// A DRY RUN UNDERCOUNTS THE SECOND HALF, by construction: pass 2 maps handles through the
// collaborator records ON DISK, and the ones pass 1 would have added are not there. So `added` is
// exact and the attachment figures are a floor — a run that previews "0 activities touched" on a
// contributor with no collaborators yet has not found nothing, it has found them all at once.
if (dryRun && added) process.stdout.write(`  (the ${added} that would be added are not on disk, so the attachment figures above are a FLOOR)\n`);
