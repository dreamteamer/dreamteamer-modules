#!/usr/bin/env node
// touch-contacts — maintain `contacts.recent_meeting` + `recent_meeting_date` from meetings.
//
//   node touch-contacts.mjs meetings/<id> [meetings/<id> …] [--dry-run] [--json]
//   node touch-contacts.mjs --all [--dry-run] [--json]          # backfill from every meeting
//
// The rule (pure, exported as `computeRecent`):
//   a contact's recent meeting is the LATEST meeting by `starts` that (a) lists the contact in
//   `attendees_contacts`, (b) has already started (`starts` <= now), and (c) is not `status: cancelled`.
//   A contact is only ever moved FORWARD — a meeting older than what the record already holds is
//   ignored — so re-running over any subset of meetings is idempotent and can never regress a
//   record. Both fields are written together, always.
//
// Reads go through `dt list --json` (two calls, whatever the scope) and writes through
// `dt set` (one call per contact that actually changes), so every write is schema-validated and
// pathspec-scoped exactly like a hand-run CLI call. No YAML parser, no direct file writes.
//
// The engine is invoked as `node <its bin.js>` resolved from node_modules, not via `npm run` or
// `node_modules/.bin`, so this works in a shell where npm is not on PATH.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ── the rule ─────────────────────────────────────────────────────────────────────────────────
/**
 * @param {Array<{id:string, starts?:string, status?:string, attendees_contacts?:string[]}>} meetings
 * @param {Array<{id:string, recent_meeting?:string, recent_meeting_date?:string}>} contacts
 * @param {Date} now
 * @returns {Array<{contact:string, recent_meeting:string, recent_meeting_date:string, previous?:string}>}
 */
export function computeRecent(meetings, contacts, now = new Date()) {
	const latest = new Map(); // contactId → { ref, starts }
	for (const m of meetings) {
		if (!m.starts || m.status === 'cancelled') continue;
		const t = Date.parse(m.starts);
		if (Number.isNaN(t) || t > now.getTime()) continue;
		for (const a of m.attendees_contacts ?? []) {
			if (typeof a !== 'string' || !a.startsWith('contacts/')) continue;
			const cur = latest.get(a);
			if (!cur || t > cur.t) latest.set(a, { ref: `meetings/${m.id}`, starts: m.starts, t });
		}
	}
	const byId = new Map(contacts.map((c) => [`contacts/${c.id}`, c]));
	const changes = [];
	for (const [contactRef, best] of latest) {
		const c = byId.get(contactRef);
		if (!c) continue; // an attendee ref with no record — check reports that, not this script
		const have = c.recent_meeting_date ? Date.parse(c.recent_meeting_date) : NaN;
		if (!Number.isNaN(have) && have > best.t) continue;            // only move forward
		if (c.recent_meeting === best.ref && c.recent_meeting_date === best.starts) continue; // no-op
		changes.push({
			contact: contactRef,
			recent_meeting: best.ref,
			recent_meeting_date: best.starts,
			...(c.recent_meeting ? { previous: c.recent_meeting } : {}),
		});
	}
	return changes.sort((a, b) => a.contact.localeCompare(b.contact));
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

function engineBin(root) {
	const pkgPath = path.join(root, 'node_modules', 'dreamteamer', 'package.json');
	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
	const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin.dreamteamer ?? Object.values(pkg.bin)[0]);
	return path.join(path.dirname(pkgPath), bin);
}

function dt(root, args, { capture = true } = {}) {
	return execFileSync(process.execPath, [engineBin(root), ...args], {
		cwd: root, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
		maxBuffer: 64 * 1024 * 1024,
	});
}

function main(argv) {
	const flags = new Set(argv.filter((a) => a.startsWith('--')));
	const refs = argv.filter((a) => !a.startsWith('--'));
	const all = flags.has('--all');
	if (!all && refs.length === 0) {
		console.error('usage: touch-contacts.mjs meetings/<id> [...] | --all   [--dry-run] [--json]');
		process.exit(2);
	}
	const bad = refs.filter((r) => !r.startsWith('meetings/'));
	if (bad.length) { console.error('not meeting refs: ' + bad.join(', ')); process.exit(2); }

	const root = workspaceRoot(path.dirname(fileURLToPath(import.meta.url)));
	let meetings = JSON.parse(dt(root, ['list', 'meetings', '--json']));
	if (!all) {
		const want = new Set(refs.map((r) => r.slice('meetings/'.length)));
		meetings = meetings.filter((m) => want.has(m.id));
		const missing = [...want].filter((id) => !meetings.some((m) => m.id === id));
		if (missing.length) { console.error('no such meeting: ' + missing.join(', ')); process.exit(1); }
	}
	const contacts = JSON.parse(dt(root, ['list', 'contacts', '--json']));
	const changes = computeRecent(meetings, contacts);

	const dryRun = flags.has('--dry-run');
	if (!dryRun) {
		for (const ch of changes) {
			dt(root, ['set', ch.contact,
				`recent_meeting=${ch.recent_meeting}`, `recent_meeting_date=${ch.recent_meeting_date}`], { capture: true });
		}
	}
	const report = {
		scope: all ? 'all' : refs, meetings_considered: meetings.length, contacts_total: contacts.length,
		changed: changes.length, dry_run: dryRun, changes,
	};
	if (flags.has('--json')) console.log(JSON.stringify(report, null, 2));
	else {
		console.log(`${dryRun ? 'would update' : 'updated'} ${changes.length} contact(s) from ${meetings.length} meeting(s)`);
		for (const ch of changes) console.log(`  ${ch.contact}  →  ${ch.recent_meeting}  (${ch.recent_meeting_date})${ch.previous ? '  was ' + ch.previous : ''}`);
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

if (isMain()) main(process.argv.slice(2));
