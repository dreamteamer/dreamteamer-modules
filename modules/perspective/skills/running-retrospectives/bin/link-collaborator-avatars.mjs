#!/usr/bin/env node
// link-collaborator-avatars — put a face on the people in a contributor's evidence.
//
//   node link-collaborator-avatars.mjs --retrospective perspective/retrospective-sessions/<id>
//        [--from <a workspace root that HAS avatars>] [--data-root d] [--copy] [--dry-run]
//
// A board of thirty collaborators is a wall of slugs. The pictures already exist in the origin
// workspace's `assets` collection (`avatars/<slug>`, `codec: file`), so this matches them to the
// people this run found and, with `--copy`, brings the matched files across.
//
// ⚠ THE MATCH IS EXACT, ON A SLUG, AND NEVER FUZZY. A collaborator matches an avatar when the slug
// of their `name` or of ANY of their `handles` equals the avatar's id — nothing else. Levenshtein,
// first-name matching or "close enough" would put one real person's face on another, which is the
// most visible error this module can make and the same class as the merge-by-name refusal in
// `lib/collaborators.mjs`. A person with no exact match keeps no avatar, and the count is reported.
//
// ⚠ AND IT COPIES ONLY WHAT MATCHED. The origin workspace's avatar set is its own address book;
// carrying all of it into a colleague's workspace would move pictures of people who appear nowhere
// in that colleague's evidence. `--copy` brings across exactly the files the matched collaborators
// point at, and says how many.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, slug } from '../lib/vault.mjs';
import { listRecords, readRecord, writeRecord, contributorOf, collectionDir } from '../lib/records.mjs';

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
const dryRun = flag('dry-run');
const wantCopy = flag('copy');

/** Where the pictures come from. Defaults to THIS workspace, which is right when the run is on the
 *  vault that owns the address book and is the only case needing no flag. */
const fromRoot = opt('from', path.resolve(dataRoot, '..'));
const fromAvatars = path.join(fromRoot, 'data', 'assets', 'avatars');
if (!fs.existsSync(fromAvatars)) {
	console.error(`no avatars at ${fromAvatars} — pass --from <workspace root> pointing at one that has them`);
	process.exit(2);
}

/** `avatars/<id>` → the file on disk. A record of a `codec: file` collection is `<id>.<suffix>.<ext>`,
 *  so the id is everything before `.asset.`. */
const available = new Map();
for (const name of fs.readdirSync(fromAvatars)) {
	const cut = name.indexOf('.asset.');
	if (cut > 0) available.set(name.slice(0, cut), path.join(fromAvatars, name));
}

const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

/** Every slug this person could legitimately be filed under. A handle that is an email contributes
 *  its LOCAL PART too — `sam.d@acme.example` is filed as `sam-d` in an address book keyed on
 *  people, not on mailboxes. */
function keysOf(fields) {
	const out = new Set();
	if (fields.name) out.add(slug(fields.name));
	for (const h of list(fields.handles)) {
		const s = String(h);
		out.add(slug(s));
		if (s.includes('@')) out.add(slug(s.split('@')[0]));
	}
	out.delete('');
	return out;
}

const toCopy = new Map();
let matched = 0, already = 0, unmatched = 0, cleared = 0;
for (const file of listRecords(path.join(collectionDir('users', dataRoot), who()))) {
	const { fields, body } = readRecord(file);
	const hit = [...keysOf(fields)].find((k) => available.has(k));
	if (!hit) {
		// ⚠ An avatar that no longer resolves is REMOVED, not left pointing at nothing: a broken
		// image in a board is worse than an initial, and a stale ref outlives the file it named.
		if (fields.avatar) { const next = { ...fields }; delete next.avatar; if (!dryRun) writeRecord(file, next, body); cleared++; }
		unmatched++;
		continue;
	}
	const ref = `assets/avatars/${hit}`;
	toCopy.set(hit, available.get(hit));
	if (fields.avatar === ref) { already++; matched++; continue; }
	if (!dryRun) writeRecord(file, { ...fields, avatar: ref }, body);
	matched++;
}

let copied = 0, skipped = 0;
if (wantCopy) {
	const dest = path.join(dataRoot, 'assets', 'avatars');
	for (const [id, src] of toCopy) {
		const target = path.join(dest, path.basename(src));
		if (fs.existsSync(target) && fs.statSync(target).size === fs.statSync(src).size) { skipped++; continue; }
		if (!dryRun) { fs.mkdirSync(dest, { recursive: true }); fs.copyFileSync(src, target); }
		copied++;
	}
}

process.stdout.write(
	`✔ collaborators with a face ${matched} (${already} already set) · no exact match ${unmatched}` +
	(cleared ? ` · ${cleared} stale avatar(s) removed` : '') +
	(wantCopy ? ` · files copied ${copied}, already present ${skipped}` : ` · ${toCopy.size} file(s) referenced (pass --copy to bring them across)`) +
	`${dryRun ? ' · DRY RUN, nothing written' : ''}\n`,
);
