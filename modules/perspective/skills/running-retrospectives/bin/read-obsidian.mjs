#!/usr/bin/env node
// read-obsidian — a personal Obsidian vault as evidence. Counted, never judged, and never quoted.
//
//   node read-obsidian.mjs --retrospective perspective/retrospective-sessions/<id> --vault <path>
//        [--label <name>] [--since YYYY-MM-DD] [--data-root d] [--dry-run] [--force]
//
// ⚠ WHY THIS SOURCE IS DIFFERENT FROM EVERY OTHER ONE, and the rule that follows from it: an
// Obsidian vault is a person's THINKING, not their output. A repo holds what they shipped, a ticket
// board what they were assigned, a mailbox what they sent someone else — all of it already seen by
// somebody. A private notes vault is the only source here that was never addressed to anyone, and it
// is where the half-formed, the wrong and the abandoned live.
//
// So: TITLES, TAGS, DATES, LINK COUNTS AND WORD COUNTS. Never a body, never a heading, never an
// excerpt, never a first line as a "summary". The same discipline `read-gmail` applies to mail, for
// a stronger reason — and unlike mail there is not even a counterpart to justify a subject line, so
// the title is kept only because a filename is how the person themselves finds the note.
//
// ⚠ AND IT NEVER READS THE `.obsidian` FOLDER. That is configuration, plugin state and, in some
// vaults, credentials for sync services. It is skipped by the same dot-prefix rule Obsidian itself
// uses, and so is every other dot-directory in the vault.
//
// What it writes: one `deliverables` record per note (kind `note`, source_kind `obsidian`) and one
// `activity-weeks` per ISO week, so a notes vault lands on the same timeline as the commits and the
// mail and can be compared with them — which is the question this source exists to answer: how much
// of the thinking happened somewhere no other source can see.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, templatize, slug, isoWeek, isoWeekRange } from '../lib/vault.mjs';
import { recordPath, writeRecord, readRecord, contributorOf, writeSource } from '../lib/records.mjs';

const READER = 'read-obsidian@1';
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const retrospectiveRef = opt('retrospective');
if (!retrospectiveRef.startsWith('perspective/retrospective-sessions/')) { console.error('usage: --retrospective perspective/retrospective-sessions/<id> is required'); process.exit(2); }
const base = retrospectiveRef.split('/').pop();
const dataRoot = opt('data-root', DATA);
// Every evidence and model id is keyed by the CONTRIBUTOR, not by the run — a re-run must update
// this person's records rather than write a parallel set beside them. Resolved LAZILY, on first
// use: reading it eagerly made a script that should exit 2 on a bad argument crash on a missing
// session instead, and "writes nothing" was the contract it broke (read-asana, 2026-09-09).
let _who = null;
const who = () => (_who ??= contributorOf(retrospectiveRef, dataRoot));
const since = opt('since');
const dryRun = flag('dry-run');

const vault = path.resolve(opt('vault'));
if (!opt('vault')) { console.error('usage: --vault <path to an Obsidian vault> is required'); process.exit(2); }
const label = opt('label', path.basename(vault));
const sourceId = `${who()}/obsidian--${slug(label)}`;
const sourceRef = `perspective/sources/${sourceId}`;

/** Every markdown note, skipping EVERY dot-directory — `.obsidian` first, but also `.git`, `.trash`
 *  and whatever else a vault has accumulated. This is the same rule Obsidian applies, so what the
 *  reader sees is what the person sees. */
function notes(dir, out = []) {
	let entries;
	try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
	for (const e of entries) {
		if (e.name.startsWith('.')) continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) notes(p, out);
		else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
	}
	return out;
}

/** Frontmatter tags and inline `#tags`, and the counts. ⚠ Reads the file and keeps NO prose: the
 *  text goes out of scope with this function, and only numbers and tags come back. */
function measure(file) {
	let text = '';
	try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
	const fm = /^---\n([\s\S]*?)\n---/.exec(text);
	const body = fm ? text.slice(fm[0].length) : text;
	const tags = new Set();
	if (fm) {
		const line = /^tags:\s*(.*)$/m.exec(fm[1]);
		if (line) for (const t of line[1].split(/[,\[\]\s]+/)) if (t) tags.add(t.replace(/^#/, '').toLowerCase());
		for (const m of fm[1].matchAll(/^\s*-\s*#?([\w/-]+)\s*$/gm)) tags.add(m[1].toLowerCase());
	}
	for (const m of body.matchAll(/(^|\s)#([A-Za-z][\w/-]{1,40})/g)) tags.add(m[2].toLowerCase());
	return {
		words: (body.match(/\S+/g) ?? []).length,
		links: [...body.matchAll(/\[\[([^\]|#]+)/g)].length,
		tags: [...tags].sort().slice(0, 20),
		has_frontmatter: !!fm,
	};
}

const files = notes(vault);
const weeks = new Map();
let written = 0, skipped = 0, unreadable = 0, outside = 0;
let first = '', last = '', words = 0, links = 0;

for (const file of files) {
	let stat;
	try { stat = fs.statSync(file); } catch { unreadable++; continue; }
	// ⚠ MTIME IS ALL A VAULT GIVES. A note carries no authored-on and no last-modified-by — there is
	// only one author and the filesystem is the only clock. So `last_touched_on` is honest and
	// `created_on` is the filesystem's birthtime where it has one, which on some filesystems is the
	// mtime again; a `created_on` equal to `last_touched_on` means "the disk could not say", not
	// "written and never revised".
	const touched = new Date(stat.mtimeMs).toISOString().slice(0, 10);
	if (since && touched < since) { outside++; continue; }
	const m = measure(file);
	if (!m) { unreadable++; continue; }
	const rel = path.relative(vault, file);
	const name = path.basename(rel, '.md');
	const created = stat.birthtimeMs && stat.birthtimeMs > 0 ? new Date(stat.birthtimeMs).toISOString().slice(0, 10) : touched;

	if (!first || touched < first) first = touched;
	if (touched > last) last = touched;
	words += m.words;
	links += m.links;

	const period = isoWeek(new Date(`${touched}T00:00:00Z`));
	const acc = weeks.get(period) ?? { files: 0, words: 0, links: 0 };
	acc.files++; acc.words += m.words; acc.links += m.links;
	weeks.set(period, acc);

	const id = `${who()}/${touched}--${slug(name)}`;
	const target = recordPath('deliverables', id, 'deliverable', dataRoot);
	if (fs.existsSync(target) && !flag('force')) { skipped++; continue; }
	if (!dryRun) {
		writeRecord(target, {
			retrospective: retrospectiveRef,
			contributor: who(),
			name,
			kind: 'note',
			source_kind: 'obsidian',
			source: sourceRef,
			external_id: rel,
			location: templatize(file),
			container: path.dirname(rel) === '.' ? label : `${label} / ${path.dirname(rel)}`,
			created_on: created,
			last_touched_on: touched,
			bytes: stat.size,
			tags: m.tags.length ? m.tags : undefined,
			read_with: READER,
			author: `scripts/${READER}`,
		}, '');
	}
	written++;
}

if (!dryRun) {
	const counts = { files: files.length, notes: written + skipped, words, links };
	if (first) counts.first = first;
	if (last) counts.last = last;
	writeSource(recordPath('sources', sourceId, 'source', dataRoot), {
		contributor: who(),
		retrospective: retrospectiveRef,
		kind: 'obsidian',
		label,
		reach: written + skipped ? 'available' : 'unavailable',
		location: templatize(vault),
		counts,
		read_with: READER,
		author: `scripts/${READER}`,
	}, 'Titles, tags, dates and counts only. No body of any note is read into a record — a personal\nvault is the one source here that was never addressed to anyone.\n');
	for (const [period, w] of weeks) {
		const wid = `${who()}/obsidian--${slug(label)}/${period}`;
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
			files_touched: w.files,
			words_written: w.words,
			summary,
			author: `scripts/${READER}`,
		});
	}
}

process.stdout.write(
	`✔ obsidian ${label} · ${files.length} note(s) · written ${written} · unchanged ${skipped}` +
	` · ${weeks.size} week(s) · ${words} words, ${links} wikilinks` +
	(outside ? ` · ${outside} older than --since` : '') +
	(unreadable ? ` · ⚠ ${unreadable} unreadable` : '') +
	`${dryRun ? ' · DRY RUN, nothing written' : ''}\n`,
);
