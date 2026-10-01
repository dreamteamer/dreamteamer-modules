#!/usr/bin/env node
// derive-tasks — the COMMITMENTS a contributor was on the hook for, read off the tickets a reader
// already collected. Mechanical: nothing here is judged, so nothing here can be invented.
//
//   node derive-tasks.mjs --retrospective perspective/retrospective-sessions/<id>
//        [--data-root d] [--force] [--dry-run]
//
// ⚠ WHY THIS EXISTS. A ticket is EVIDENCE — a row `read-asana` found, counted and never judged, the
// same tier as an `activity-weeks` record. Until `perspective/world/tasks` existed, that half of the
// evidence dead-ended: a measured consumer workspace held 933 ticket records and nothing in the
// module ever turned one into a modelled commitment, so "what did this person actually OWE" had no
// answer while the data to answer it sat on disk.
//
// ⚠ THE JOIN IS THROUGH THE ACTIVITY, NEVER THROUGH THE DATE. An activity already cites its tickets
// (`attach-evidence` puts them there from the cluster candidate) and already carries a project, so a
// task's `activity` and `project` are one hop and entirely mechanical. A ticket no clustered
// activity cites gets a task with neither, and it is COUNTED — that count is the honest measure of
// how much of the ticket record sits outside the reconstructed work, and it is a fact about the
// clustering window rather than about the person.
//
// ⚠ ADDITIVE, and idempotent by construction. The id is `<contributor>/<the ticket's external id>`,
// so a second run lands on the same record. Fields a person edited are kept unless `--force`; only
// the joins and the mechanically-copied fields are refreshed.
//
// ⚠ IT NEVER SETS `real`. The join out to the workspace's own `tasks` collection is a PROPOSAL a
// person confirms — see `world/users.real`. A script that guessed it would be authoring truth, which
// is the one thing this module never does.
import path from 'node:path';
import { DATA } from '../lib/vault.mjs';
import { listRecords, readRecord, writeRecord, recordPath, contributorOf } from '../lib/records.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const retrospective = opt('retrospective');
if (!retrospective.startsWith('perspective/retrospective-sessions/')) {
	console.error('usage: --retrospective perspective/retrospective-sessions/<id> is required');
	process.exit(2);
}
const dataRoot = opt('data-root', DATA);
// Lazily, for the reason derive-decision-projects states: a bad argument must exit 2 rather than
// crash on a missing session.
let _who = null;
const who = () => (_who ??= contributorOf(retrospective, dataRoot));
const dryRun = flag('dry-run');
const force = flag('force');
const AUTHOR = 'scripts/derive-tasks@1';

const dir = (c) => path.join(dataRoot, 'perspective', c);
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
const idOf = (file, coll, suffix) => path.relative(dir(coll), file).replace(new RegExp(`\\.${suffix}\\.md$`), '');

// ── the tickets each activity cites → that activity, and its project ────────────────────────────
const byTicket = new Map();
for (const file of listRecords(path.join(dir('world/activities'), who()))) {
	const { fields } = readRecord(file);
	const ref = `perspective/world/activities/${idOf(file, 'world/activities', 'activity')}`;
	for (const t of list(fields.tickets)) byTicket.set(String(t), { activity: ref, project: fields.project ?? '' });
}

// ── one task per ticket ─────────────────────────────────────────────────────────────────────────
// `open`/`completed` is the whole vocabulary a ticketing system has, and `world/tasks.status` says
// three values on purpose: `blocked`, `doing` and `closed` are distinctions a person makes about
// their own work and no source carries them. A ticket with no status at all reads `unknown`.
const STATUS = { open: 'open', completed: 'done' };

let written = 0, unchanged = 0, unjoined = 0;
const tickets = listRecords(path.join(dir('tickets'), who()));
for (const file of tickets) {
	const { fields, body } = readRecord(file);
	const ticketId = idOf(file, 'tickets', 'ticket');
	const ref = `perspective/tickets/${ticketId}`;
	const join = byTicket.get(ref);
	if (!join) unjoined++;
	// The id's second segment IS the ticket's external id — the descriptor builds it from
	// `{{ ticket | basename }}`, so the two can never disagree.
	const external = String(fields.external_id ?? ticketId.split('/').pop());
	const target = recordPath('world/tasks', `${who()}/${external}`, 'task', dataRoot);
	let prior = { fields: {}, body: '' };
	try { prior = readRecord(target); } catch { /* first write */ }
	const keep = (key, value) => (force || prior.fields[key] === undefined ? value : prior.fields[key]);
	const next = {
		...prior.fields,
		retrospective: prior.fields.retrospective ?? retrospective,
		last_seen_in: prior.fields.retrospective && prior.fields.retrospective !== retrospective ? retrospective : prior.fields.last_seen_in,
		contributor: who(),
		name: keep('name', String(fields.title ?? '').trim()),
		ticket: ref,
		activity: join?.activity || undefined,
		project: join?.project || undefined,
		assignee: fields.assignee || undefined,
		status: STATUS[String(fields.status ?? '')] ?? 'unknown',
		created_on: fields.created_on || undefined,
		due_on: fields.due_on || undefined,
		completed_on: fields.completed_on || undefined,
		tags: list(fields.tags).length ? list(fields.tags) : undefined,
		author: prior.fields.author ?? AUTHOR,
		creation_context: prior.fields.creation_context ?? `Derived mechanically from ${ref} by derive-tasks.`,
		confidence: prior.fields.confidence ?? 'high',
	};
	// The body is the ticket's own, carried once and then left to whoever edits it.
	const nextBody = prior.body?.trim() ? prior.body : (body ?? '');
	if (JSON.stringify(next) === JSON.stringify(prior.fields) && (nextBody ?? '') === (prior.body ?? '')) { unchanged++; continue; }
	written++;
	if (!dryRun) writeRecord(target, next, nextBody);
}

console.log(`derive-tasks: ${tickets.length} ticket(s) → ${written} task(s) written, ${unchanged} unchanged, ${unjoined} with no clustered activity${dryRun ? ' (dry run — nothing written)' : ''}`);
