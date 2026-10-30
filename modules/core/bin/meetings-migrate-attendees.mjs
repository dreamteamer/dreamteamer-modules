#!/usr/bin/env node
// migrate-attendees — move every `meetings` record from the 0.1.1 people fields to the 0.1.2 ones.
//
//   node node_modules/@dreamteamer/core/bin/meetings-migrate-attendees.mjs            # the plan, nothing written
//   node node_modules/@dreamteamer/core/bin/meetings-migrate-attendees.mjs --write    # apply it
//   … [meetings/<id> …] [--json]                                                   # only these records
//
// What changes on a record, and why it is lossless where it can be:
//   `attendees` (contact refs)      → `attendees_contacts`, unchanged
//   `attendees_raw` (strings)       → `attendees` (objects): each string was formatted from the API's
//                                     attendee — `<email> — <displayName> (<flags>)`, `<Name> <email>`,
//                                     `<email> (self + organizer)` — so it parses back into the keys it
//                                     came from. A string with no address is somebody's note about who
//                                     was in the room (a recording with no invite behind it); it is
//                                     carried VERBATIM into the meeting's own page (`notes`) under one
//                                     heading, never dropped and never guessed into an object.
//   `organizer` (an address)        → `organizer: { email }`, `self` when the same address is a `self` attendee
//   `attendees_raw`                 → deleted
// A record already in the 0.1.2 shape is a no-op, so a second run changes nothing. Writes go through
// the engine's store, so every record is validated against the compiled descriptor before it lands —
// run `dt compile` on the 0.1.2 module first, then this, then `dt check`.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { attendeeOf } from '../skills/fetching-meetings/bin/event-people.mjs';

export const RESIDUE_HEADING = '## attendee notes (carried from attendees_raw)';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const FLAGS = new Set(['self', 'organizer', 'optional']);
const STATUS = { accepted: 'accepted', needsaction: 'needsAction', 'needs-action': 'needsAction', declined: 'declined', tentative: 'tentative' };

/** Latin words capitalised, or any non-Latin script — the shape of a person's name, never of a remark. */
const nameLike = (s, min, max) => {
	const words = s.split(/\s+/).filter(Boolean);
	if (words.length < min || words.length > max) return false;
	return words.every((w) => /^[\p{L}'./-]+$/u.test(w) && (!/^[A-Za-z]/.test(w) || /^[A-Z]/.test(w)));
};
/** Strip ONE matching pair of quotes around the whole string — a quote inside it is content. */
const unquote = (s) => { const t = s.trim(); return /^(['"]).*\1$/.test(t) ? t.slice(1, -1).trim() : t; };

/** Split a raw string at the first `;` that sits OUTSIDE brackets: the structured head and a free remark. */
function splitRemark(s) {
	let depth = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c === '(' || c === '[') depth++;
		else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
		else if (c === ';' && depth === 0) return [s.slice(0, i), s.slice(i + 1).trim()];
	}
	return [s, ''];
}

/**
 * One `attendees_raw` string → `{ attendee, remarks, resource }`. `attendee` is in the API's own shape
 * (so `attendeeOf` normalises it exactly as the sync does), or null when the string names no single
 * address; `remarks` is every fragment that is neither an address, a name nor a known flag; `resource`
 * marks a string the sync itself labelled a room.
 */
export function parseRawAttendee(raw) {
	const s = String(raw ?? '').trim();
	const remarks = [];
	const [head, tail] = splitRemark(s);
	if (tail) remarks.push(tail);
	// the bracket groups of the head, and the head with them removed
	const groups = [];
	const bare = head.replace(/[(\[]([^()\[\]]*)[)\]]/g, (_, g) => { groups.push(g); return ' '; });
	const emails = bare.match(EMAIL) ?? [];
	if (emails.length !== 1) return { attendee: null, remarks: [s], resource: false };
	const email = emails[0];
	const a = { email };
	// the display name: `Name <email>` (explicit, taken verbatim) or `email — Name` (checked for shape)
	const before = bare.slice(0, bare.indexOf(email)).replace(/<\s*$/, '').trim();
	const after = bare.slice(bare.indexOf(email) + email.length).replace(/^\s*>/, '').trim();
	if (before) a.displayName = unquote(before);
	else if (/^[—-]\s*/.test(after)) {
		const name = unquote(after.replace(/^[—-]\s*/, ''));
		if (name && nameLike(name, 1, 6)) a.displayName = name;
		else if (name) remarks.push(name);
	} else if (after) remarks.push(after);
	let resource = false;
	for (const g of groups) {
		for (const tokenRaw of g.split(/\s*(?:\+|,|;|—|\s-\s)\s*/)) {
			const token = tokenRaw.trim();
			if (!token) continue;
			const key = token.toLowerCase();
			if (FLAGS.has(key)) a[key] = true;
			else if (STATUS[key]) a.responseStatus = STATUS[key];
			else if (/\broom resource\b/i.test(token)) resource = true;
			else if (!a.displayName && nameLike(token, 2, 4)) a.displayName = token;
			else remarks.push(token);
		}
	}
	return { attendee: a, remarks, resource };
}

/**
 * The 0.1.2 fields for one record, or null when it is already there. Pure: `fields` in, the
 * `changes` for `Store.set` out, plus the report line's numbers.
 */
export function planRecord(fields) {
	const refs = Array.isArray(fields.attendees) && fields.attendees.every((a) => typeof a === 'string');
	const raw = Array.isArray(fields.attendees_raw) ? fields.attendees_raw : fields.attendees_raw ? [fields.attendees_raw] : [];
	const organizerIsString = typeof fields.organizer === 'string';
	if (!refs && !raw.length && !organizerIsString) return null;

	const changes = {};
	const residue = [];
	const attendees = [];
	const seen = new Set();
	let rooms = 0;
	for (const line of raw) {
		const { attendee, remarks, resource } = parseRawAttendee(line);
		if (resource) { rooms++; continue; }
		const row = attendee ? attendeeOf(attendee) : null;
		if (row && !seen.has(row.email)) { seen.add(row.email); attendees.push(row); }
		for (const r of remarks) residue.push(row ? `${row.email}: ${r}` : r);
	}
	if (refs) {
		changes.attendees_contacts = fields.attendees;
		if (!attendees.length) changes.attendees = null;
	}
	if (attendees.length) changes.attendees = attendees;
	if (raw.length) changes.attendees_raw = null;
	if (organizerIsString) {
		const email = (fields.organizer.match(EMAIL) ?? [])[0];
		if (email && fields.organizer.trim() === email) {
			const o = { email: email.toLowerCase() };
			if (attendees.some((a) => a.email === o.email && a.self)) o.self = true;
			changes.organizer = o;
		} else {
			residue.push(`organizer: ${fields.organizer}`);
			changes.organizer = null;
		}
	}
	if (residue.length) {
		const body = String(fields.notes ?? '').trimEnd();
		changes.notes = `${body ? `${body}\n\n` : ''}${RESIDUE_HEADING}\n\n${residue.map((r) => `- ${r}`).join('\n')}\n`;
	}
	return { changes, counts: { attendees: attendees.length, contacts: refs ? fields.attendees.length : 0, residue: residue.length, rooms } };
}

// ── plumbing ─────────────────────────────────────────────────────────────────────────────────
function workspaceRoot(from) {
	// package-lock.json, not package.json — a module folder carries the latter too. And a folder sitting directly inside `git_modules/` is a module clone, never the workspace, even when `npm install` left it a lockfile.
	for (let d = from; d !== path.dirname(d); d = path.dirname(d)) {
		const inGitModules = path.basename(path.dirname(d)) === 'git_modules';
		if (!inGitModules && fs.existsSync(path.join(d, 'package-lock.json'))) return d;
	}
	return null;
}

async function main(argv) {
	const write = argv.includes('--write');
	const json = argv.includes('--json');
	const only = new Set(argv.filter((a) => a.startsWith('meetings/')).map((r) => r.slice('meetings/'.length)));
	const root = workspaceRoot(process.cwd()) ?? workspaceRoot(path.dirname(fileURLToPath(import.meta.url)));
	if (!root) throw new Error('no workspace here or above this script (no package-lock.json)');
	const entry = createRequire(path.join(root, 'package.json')).resolve('dreamteamer/records');
	const { Store } = await import(pathToFileURL(entry).href);
	const store = new Store({ root });
	const d = store.descriptor('meetings');
	for (const f of ['attendees_contacts']) {
		if (!d.compiled.fields[f]) throw new Error(`the compiled meetings descriptor has no \`${f}\` — install @dreamteamer/core 0.1.2 or later and run \`dt compile\` first`);
	}
	if (d.compiled.fields.attendees_raw) throw new Error('the compiled meetings descriptor still declares `attendees_raw` — this is the 0.1.1 shape; upgrade the module and compile first');

	const rows = [];
	let scanned = 0, unchanged = 0;
	for (const { id, fields } of store.readAll('meetings')) {
		if (only.size && !only.has(id)) continue;
		scanned++;
		const plan = planRecord(fields);
		if (!plan) { unchanged++; continue; }
		if (write) store.set('meetings', id, plan.changes);
		rows.push({ id, ...plan.counts });
	}
	const totals = rows.reduce((t, r) => ({ attendees: t.attendees + r.attendees, contacts: t.contacts + r.contacts, residue: t.residue + r.residue, rooms: t.rooms + r.rooms }), { attendees: 0, contacts: 0, residue: 0, rooms: 0 });
	const report = { written: write, scanned, unchanged, changed: rows.length, totals, records: rows };
	if (json) console.log(JSON.stringify(report, null, 2));
	else {
		for (const r of rows) console.log(`${write ? '✔' : '·'} meetings/${r.id}  attendees ${r.attendees} · contacts ${r.contacts}${r.residue ? ` · residue ${r.residue} → notes` : ''}${r.rooms ? ` · rooms dropped ${r.rooms}` : ''}`);
		console.log(`${write ? 'migrated' : 'would migrate'} ${rows.length} of ${scanned} meeting(s) (${unchanged} already in shape) · attendees ${totals.attendees} · contacts ${totals.contacts} · residue lines ${totals.residue} · rooms ${totals.rooms}${write ? '' : '\nnothing written — pass --write to apply'}`);
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
