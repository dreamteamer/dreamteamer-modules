#!/usr/bin/env node
// event-people — write a meeting's `attendees` and `organizer` from the Calendar API event itself.
//
//   node event-people.mjs meetings/<id> --event <event.json>          # one event object, as `gcal.mjs event` prints it
//   node event-people.mjs meetings/<id> --event <events.json> --event-id <id>   # pick one out of an `events` array
//   cat event.json | node event-people.mjs meetings/<id>               # the event on stdin
//   … [--dry-run] [--json]
//
// `attendees` is a list of objects and `organizer` an object, which the CLI cannot spell on a
// command line — a repeated `--attendees` is a list of strings. So the sync hands the raw event to
// this script, which keeps the API's own keys (`email`, `displayName`, `responseStatus`, `organizer`,
// `self`, `optional`), drops room bookings (`resource: true`), maps `needsAction` to the descriptor's
// kebab-case `needs-action` once, here, and writes both fields through the engine's store, so the
// write is validated exactly like a `dt set`. `attendees_contacts` and `ours` are refs — strings —
// and stay a plain `dt set`.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ── the mapping, pure ──────────────────────────────────────────────────────────────────────────
/** The API's `responseStatus` spellings → the descriptor's enum (kebab-case, as every v2 enum is). */
export const RESPONSE_STATUS = { needsAction: 'needs-action', declined: 'declined', tentative: 'tentative', accepted: 'accepted' };

/**
 * One API attendee → the record's attendee object, or null for a room/resource or an entry with no address.
 * Only the keys the descriptor declares survive; a false flag is dropped rather than written as `false`.
 * @param {{email?:string, displayName?:string, responseStatus?:string, organizer?:boolean, self?:boolean, optional?:boolean, resource?:boolean}} a
 */
export function attendeeOf(a) {
	if (!a || typeof a !== 'object' || a.resource === true) return null;
	const email = String(a.email ?? '').trim().toLowerCase();
	if (!email.includes('@')) return null;
	const out = { email };
	const name = String(a.displayName ?? '').trim();
	if (name) out.displayName = name;
	const status = RESPONSE_STATUS[a.responseStatus];
	if (status) out.responseStatus = status;
	for (const flag of ['organizer', 'self', 'optional']) if (a[flag] === true) out[flag] = true;
	return out;
}

/** The event's attendee list as the record stores it: people only, in the API's order, deduped by address. */
export function attendeesOf(event) {
	const seen = new Set();
	const out = [];
	for (const a of event?.attendees ?? []) {
		const row = attendeeOf(a);
		if (!row || seen.has(row.email)) continue;
		seen.add(row.email);
		out.push(row);
	}
	return out;
}

/** The event's organizer as the record stores it, or null when the API carries none. */
export function organizerOf(event) {
	const o = event?.organizer;
	if (!o || typeof o !== 'object') return null;
	const email = String(o.email ?? '').trim().toLowerCase();
	if (!email.includes('@')) return null;
	const out = { email };
	const name = String(o.displayName ?? '').trim();
	if (name) out.displayName = name;
	if (o.self === true) out.self = true;
	return out;
}

/** Both fields at once — what the script writes. `organizer: null` clears the field when the API has none. */
export function peopleOf(event) {
	return { attendees: attendeesOf(event), organizer: organizerOf(event) };
}

// ── plumbing ─────────────────────────────────────────────────────────────────────────────────
function workspaceRoot(from) {
	// package-lock.json, not package.json — a module folder carries the latter too. And a folder sitting directly inside `git_modules/` is a module clone, never the workspace, even when `npm install` left it a lockfile.
	for (let d = from; d !== path.dirname(d); d = path.dirname(d)) {
		const inGitModules = path.basename(path.dirname(d)) === 'git_modules';
		if (!inGitModules && fs.existsSync(path.join(d, 'package-lock.json'))) return d;
	}
	throw new Error('no package-lock.json above ' + from);
}

async function engineStore(root) {
	const entry = createRequire(path.join(root, 'package.json')).resolve('dreamteamer/records');
	const { Store } = await import(pathToFileURL(entry).href);
	return new Store({ root });
}

function readEvent(argv) {
	const at = argv.indexOf('--event');
	const text = at >= 0 && argv[at + 1] ? fs.readFileSync(argv[at + 1], 'utf8') : fs.readFileSync(0, 'utf8');
	let json;
	try { json = JSON.parse(text); } catch (e) { throw new Error(`the event is not JSON: ${e.message}`); }
	if (Array.isArray(json)) {
		const i = argv.indexOf('--event-id');
		const want = i >= 0 ? argv[i + 1] : null;
		if (!want) throw new Error(`the input is a list of ${json.length} events — pass --event-id <id> to pick one`);
		const hit = json.find((e) => e?.id === want);
		if (!hit) throw new Error(`no event with id ${want} in the input`);
		return hit;
	}
	return json;
}

async function main(argv) {
	const flags = new Set(argv.filter((a) => a.startsWith('--')));
	const refs = argv.filter((a, i) => !a.startsWith('--') && !['--event', '--event-id'].includes(argv[i - 1]));
	if (refs.length !== 1 || !refs[0].startsWith('meetings/')) {
		console.error('usage: event-people.mjs meetings/<id> [--event <file.json>] [--event-id <id>] [--dry-run] [--json]');
		process.exit(2);
	}
	const id = refs[0].slice('meetings/'.length);
	const event = readEvent(argv);
	const people = peopleOf(event);
	const dryRun = flags.has('--dry-run');
	const root = workspaceRoot(path.dirname(fileURLToPath(import.meta.url)));
	if (!dryRun) {
		const store = await engineStore(root);
		store.set('meetings', id, people);
	}
	const report = { meeting: refs[0], attendees: people.attendees.length, organizer: people.organizer?.email ?? null,
		dropped_resources: (event.attendees ?? []).filter((a) => a?.resource === true).length, dry_run: dryRun, people };
	if (flags.has('--json')) console.log(JSON.stringify(report, null, 2));
	else {
		console.log(`${dryRun ? 'would write' : 'wrote'} ${people.attendees.length} attendee(s)${people.organizer ? ` and the organizer` : ''} on ${refs[0]}${report.dropped_resources ? ` (${report.dropped_resources} room(s) dropped)` : ''}`);
		for (const a of people.attendees) console.log(`  ${a.email}${a.displayName ? ` — ${a.displayName}` : ''}${a.responseStatus ? ` (${a.responseStatus})` : ''}${a.organizer ? ' organizer' : ''}${a.self ? ' self' : ''}${a.optional ? ' optional' : ''}`);
	}
}

/** Run as a script, including through a symlink. `process.argv[1]` is the path as invoked and
 *  `import.meta.url` the path resolved, so both are realpathed before they are compared; under a
 *  `git_modules/<name>` symlink a plain `===` is false and the script would exit 0 having done nothing. */
const isMain = () => {
	if (!process.argv[1]) return false;
	const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
	return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
};

if (isMain()) {
	try { await main(process.argv.slice(2)); }
	catch (e) { console.error(e.message); process.exit(1); }
}
