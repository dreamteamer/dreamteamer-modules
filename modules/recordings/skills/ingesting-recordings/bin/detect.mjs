#!/usr/bin/env node
/**
 * detect.mjs — the mechanics behind /fetch-new-recordings.
 *
 * Two verbs, deliberately split so that judgment stays with the agent and side effects stay here:
 *
 *   scan                     walk every `${env:INBOX_FOLDERS}` root's `meeting-recordings/`, sha256
 *                            + ffprobe + parse each file, print JSON with a proposed record for each,
 *                            and whether it is already in the vault. Otherwise read-only — the one
 *                            exception is the inbox log's moot-log rule (spec §3.2b): a `*.log`
 *                            sidecar whose payload is already gone gets moved to `<root>/trash/` on
 *                            sight, tidying scratch space the log lifecycle itself owns rather than
 *                            touching any real payload or record.
 *                            `INBOX_FOLDERS` is a LIST (desktop: Drive + iCloud, for the phone's
 *                            zero-friction share sheet) — every root is scanned, and a duplicate
 *                            fingerprint across roots is flagged rather than double-counted.
 *   import <file> --id <id>  file the recording into its ONE durable home,
 *                            `${env:FILES_FOLDER}/meeting-recordings/<id>.<ext>` — flat, and named
 *                            after the RECORD id rather than whatever the inbox payload was called:
 *                            copy it there, prove the copy by sha256, and only then move the inbox
 *                            payload to that root's `trash/`. Prints `recording_file` + `fingerprint`
 *                            for the caller to set on the record. Writes the inbox log beside `<file>`
 *                            as it goes (`seen` at first touch, `refused` on any refusal) and DELETES
 *                            it once the payload is filed — the log is narrative-only working memory
 *                            (spec §3.2b), never a second source of truth.
 *                            ⚠ No `media/` copy since 23/08/2026 — see the note in the import branch.
 *
 * (`backfill-fingerprints` was the third verb until 23/08/2026. It hashed records that had a `media/`
 * path but no `fingerprint`; retiring `media/` left it nothing to read, so it went — see the note at
 * the bottom of the verb dispatch.)
 *
 * Zero dependencies. Requires `ffprobe` on PATH (already a transcribing-recordings prerequisite).
 * Run from the repo root so `dt resolve` finds the workspace.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AUDIO = new Set(['.m4a', '.mp3', '.wav', '.aac', '.mp4', '.m4b', '.ogg', '.opus', '.flac']);

// ⚠ The vault root is WALKED, never taken from process.cwd(). Measured 2026-08-13: running this
// from the module folder instead of the vault root reported `recordings_without_file: 0` where the
// truth was 25, and every already-ingested file came back unknown — because knownFingerprints()
// returns empty maps when data/meeting-recordings is absent, with no warning and exit 0. That mints
// DUPLICATE recording records, which is the one failure this skill exists to prevent. The scan looked
// entirely normal because `resolveVar` below runs the engine with an explicit `cwd: ROOT` and still
// found the inbox.
// package-lock.json, not package.json — every module carries the latter.
// ⚠ a folder sitting directly inside `git_modules/` is a module clone, never the workspace, even when `npm install` left it a lockfile.
const vaultRoot = () => {
	for (let d = path.dirname(fileURLToPath(import.meta.url)); ; d = path.dirname(d)) {
		const inGitModules = path.basename(path.dirname(d)) === 'git_modules';
		if (!inGitModules && fs.existsSync(path.join(d, 'package-lock.json'))) return d;
		if (path.dirname(d) === d) throw new Error(`vault root (package-lock.json) not found above ${import.meta.url}`);
	}
};
const ROOT = vaultRoot();
// (There was a `MEDIA = <root>/media/meeting-recordings` here until 23/08/2026. `media/` is retired —
// the archive under FILES_FOLDER is the one durable copy, and Drive-for-Desktop uploading it is a
// separate background concern. Nothing in this script writes or reads a second local copy any more.)
const RECORDINGS_DIR = path.join(ROOT, 'data/meeting-recordings');

// ---------------------------------------------------------------- declared vars
// Resolved by the ENGINE, never by a second .env read — mirrors drive.mjs's `resolveVar`.
// `FILES_FOLDER` is declared in the workspace package.json's `dreamteamer.vars`, so
// `dt resolve '${env:FILES_FOLDER}'` is its one resolver; reading it out of `.env` directly here
// would be a second resolver, the exact duplication that retired FILE_MOUNTS.
function resolveVar(name) {
	const engine = path.join(ROOT, 'node_modules/.bin/dreamteamer');
	if (!fs.existsSync(engine)) return undefined;
	try {
		return execFileSync(process.execPath, [engine, 'resolve', `\${env:${name}}`],
			{ cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
	} catch { return undefined; }   // undeclared, or no value on this machine
}

// ── INBOX_FOLDERS: a LIST of inbox roots, every one scanned ─────────────────────────────────────
// Two variables now (design revision 2, 2026-08-22): `FILES_FOLDER` (one root, permanent) and
// `INBOX_FOLDERS` (a newline-separated LIST of inbox roots, transient) — the phone's iOS share
// sheet lands in iCloud with zero friction, so desktop carries a second root there while the web
// has only one. Splits on newlines, trims, drops blanks, and SKIPS a root that does not exist on
// this machine with a printed note rather than dying — a future machine may have more or fewer
// roots than this one. `override` mirrors `--files-folder`: a fixture pins this without touching
// `.env` or a real synced folder.
function resolveInboxRoots(override) {
	const raw = override ?? resolveVar('INBOX_FOLDERS');
	if (!raw) return [];
	const roots = [];
	for (const line of raw.split('\n')) {
		const root = line.trim();
		if (!root) continue;
		if (!fs.existsSync(root)) { console.error(`  (skipping inbox root — does not exist on this machine: ${root})`); continue; }
		roots.push(root);
	}
	return roots;
}

// ── the inbox log — working memory beside the payload (spec §3.2b) ─────────────────────────────────
// `<exact-payload-filename>.log`, append-only, narrative only: the PAYLOAD's presence/location is
// the only truth this script or anything downstream ever decides from. Copied verbatim into the
// screenshots detect.mjs (self-contained scripts, no cross-skill import).
const logPathOf = (payload) => `${payload}.log`;
function logEvent(payload, event, kv = {}, actor = 'recordings-detect@desktop') {
	const parts = Object.entries(kv).map(([k, v]) => `${k}=${v}`).join(' ');
	fs.appendFileSync(logPathOf(payload), `${new Date().toISOString()}  ${event}  ${parts}  by=${actor}\n`);
}

// `<date>--` prefix on a name collision — never overwrite, never guess which file wins.
function uniqueTrashPath(trashDir, name) {
	fs.mkdirSync(trashDir, { recursive: true });
	let dest = path.join(trashDir, name);
	if (!fs.existsSync(dest)) return dest;
	const datePrefix = new Date().toISOString().slice(0, 10);
	dest = path.join(trashDir, `${datePrefix}--${name}`);
	for (let n = 2; fs.existsSync(dest); n++) dest = path.join(trashDir, `${datePrefix}--${n}--${name}`);
	return dest;
}

/** Every file under `dir`, at any depth, sorted; dotfiles and any `trash/` folder (discards, never input) skipped. */
function walkFiles(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		if (e.name.startsWith('.')) continue;
		if (e.isDirectory() && e.name === 'trash') continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walkFiles(p, out); else out.push(p);
	}
	return out;
}

// At scan start: a `*.log` whose payload is gone is moot — move it to `<root>/trash/` (spec §3.2b).
// Self-healing for a stray log any transport left behind. Removal is never a delete (design §3.2),
// so this is a rename, never an unlink. Walks the subtree for the same reason `scan` does.
function cleanMootLogs(root, kind) {
	for (const logP of walkFiles(path.join(root, kind))) {
		if (!logP.endsWith('.log')) continue;
		const payload = logP.slice(0, -'.log'.length);
		if (fs.existsSync(payload)) continue;
		fs.renameSync(logP, uniqueTrashPath(path.join(root, 'trash'), path.basename(logP)));
	}
}

// ── the inbox no longer needs staging ────────────────────────────────────────────────────────────
// Until 22/08/2026 `import` copied into `media/` and left the original exactly where it was —
// staging it into the Drive inbox's `ingested/` and `processed/` folders was "the agent's job, not
// this script's", which meant a processed original just lingered until someone did that by hand.
// Since the 2026-08-22 files-folder restructure an inbox root (`${env:INBOX_FOLDERS}` entry + `meeting-recordings/`) and the
// durable archive (`${env:FILES_FOLDER}/recordings/<year>/<month>/`) sit in the SAME synced tree when that
// root is the Drive one, so `import` finishes the job itself: after the `media/` copy verifies, it
// moves the original there directly — no second stage, no agent-run Drive upload. `--files-folder`
// / `--inbox-folders` below are the override points a caller (or a test fixture) has, so
// nothing here reads `.env` a second way.

// ---------------------------------------------------------------- filename → date + hint
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const HE_MONTHS = { 'ינואר': 1, 'פברואר': 2, 'מרץ': 3, 'מרס': 3, 'אפריל': 4, 'מאי': 5, 'יוני': 6, 'יולי': 7, 'אוגוסט': 8, 'ספטמבר': 9, 'אוקטובר': 10, 'נובמבר': 11, 'דצמבר': 12 };

/** Hebrew → latin, enough for a filesystem slug. Not a translation — the agent supplies that. */
const HE_MAP = { 'א': 'a', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'v', 'ז': 'z', 'ח': 'ch', 'ט': 't', 'י': 'y', 'כ': 'k', 'ך': 'k', 'ל': 'l', 'מ': 'm', 'ם': 'm', 'נ': 'n', 'ן': 'n', 'ס': 's', 'ע': 'a', 'פ': 'p', 'ף': 'f', 'צ': 'ts', 'ץ': 'ts', 'ק': 'k', 'ר': 'r', 'ש': 'sh', 'ת': 't' };
const translit = (s) => [...s].map((c) => HE_MAP[c] ?? c).join('');

const slug = (s) => translit(s)
	.normalize('NFKD').replace(/[̀-ͯ]/g, '')
	.replace(/[‎‏‪-‮⁦-⁩]/g, '')   // bidi marks Apple adds to Hebrew names
	.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * Returns { date, time, hint, how, confident }.
 * The operator names files "[date] [context, company, contacts]" on purpose, in a few dialects.
 */
function parseName(stem, mtime) {
	const clean = stem.replace(/[‎‏‪-‮⁦-⁩]/g, '').trim();
	const mtimeYear = mtime.getFullYear();

	// 1. leading `YYYY MM DD` (or -/_ separated), optional `HHMM`
	let m = clean.match(/^(\d{4})[ \-_.](\d{1,2})[ \-_.](\d{1,2})(?:[ \-_.](\d{3,4}))?\s*(.*)$/);
	if (m) {
		const [, y, mo, d, hhmm, rest] = m;
		const time = hhmm ? `${pad(hhmm.slice(0, hhmm.length - 2))}:${hhmm.slice(-2)}` : null;
		return { date: iso(+y, +mo, +d), time, hint: rest.trim(), how: 'leading YYYY MM DD', confident: true };
	}

	// 2. trailing english month+day — `Alex jul22`, `Danny hoz jouyus jul 24`
	m = clean.match(/^(.*?)[ \-_]*\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[ \-_.]?(\d{1,2})\b\s*$/i);
	if (m) {
		const [, rest, mon, d] = m;
		return { ...yearFor(MONTHS[mon.toLowerCase()], +d, mtimeYear), hint: rest.trim(), how: 'trailing english month+day', confident: true };
	}

	// 3. Hebrew month + day — `דנה אורן יולי 22` (a Hebrew name, then the month word, then the day)
	for (const [he, mo] of Object.entries(HE_MONTHS)) {
		const re = new RegExp(`^(.*?)\\s*${he}\\s*(\\d{1,2})\\s*$`);
		m = clean.match(re);
		if (m) return { ...yearFor(mo, +m[2], mtimeYear), hint: m[1].trim(), how: 'hebrew month+day', confident: true };
	}

	// 4. nothing parseable — fall back to the file's own mtime and say so
	return {
		date: iso(mtime.getFullYear(), mtime.getMonth() + 1, mtime.getDate()),
		time: null, hint: clean, how: 'file mtime (no date in the filename)', confident: false,
	};
}

/** a bare month+day has no year: assume the mtime's, unless that lands in the future */
function yearFor(mo, d, year) {
	let date = iso(year, mo, d);
	if (new Date(date).getTime() - Date.now() > 30 * 864e5) date = iso(year - 1, mo, d);
	return { date, time: null };
}

// ---------------------------------------------------------------- file facts
const sha256 = (f) => {
	const h = crypto.createHash('sha256');
	h.update(fs.readFileSync(f));
	return `sha256:${h.digest('hex')}`;
};

function duration(f) {
	try {
		const s = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim();
		if (!isFinite(s) || s <= 0) return null;
		return `${Math.floor(s / 60)}:${pad(Math.round(s % 60))}`;
	} catch { return null; }
}

const walk = (d, out = []) => {
	for (const e of fs.readdirSync(d, { withFileTypes: true })) {
		const p = path.join(d, e.name);
		e.isDirectory() ? walk(p, out) : out.push(p);
	}
	return out;
};

/**
 * Every fingerprint the vault already knows — the dedupe index, read from each record's STORED
 * `fingerprint` field.
 *
 * ⚠ It hashes NOTHING. Until 23/08/2026 this also returned an `unfingerprinted` list — records with a
 * `media/` path but no fingerprint — and `scan` hashed those files to complete the index. That was
 * the last thing in the whole scan path that read `media/`, and it is what made retiring the folder
 * a question at all. Two facts settled it: the list was empty (all 53 records with audio carry a
 * stored fingerprint, because `import` has always written one), and re-hashing was never the right
 * repair anyway — a record whose fingerprint is missing should get one written to it, not recomputed
 * on every scan forever. So the index is now purely what the records say, and a scan touches no
 * audio at all.
 */
function knownFingerprints() {
	const known = new Map();          // fingerprint -> recording id
	if (!fs.existsSync(RECORDINGS_DIR)) return known;
	for (const f of walk(RECORDINGS_DIR).filter((f) => /\.meeting-recording\.(md|yaml)$/.test(f))) {
		const id = path.relative(RECORDINGS_DIR, f).replace(/\.meeting-recording\.(md|yaml)$/, '');
		const fp = fs.readFileSync(f, 'utf8').match(/^fingerprint:\s*(\S+)\s*$/m);
		if (fp) known.set(fp[1].replace(/^['"]|['"]$/g, ''), id);
	}
	return known;
}

/** A top-level frontmatter scalar with its surrounding quotes removed, or null. */
const fmValue = (text, key) => (new RegExp(`^${key}:[ \\t]*(.*?)\\s*$`, 'm').exec(text)?.[1] ?? '').replace(/^(['"])(.*)\1$/, '$2') || null;

/**
 * Recordings waiting for a binary — `origin: audio` with no `recording_file`. A hash cannot find
 * these, so scan offers each new file the ones it may belong to, with the evidence, and the agent
 * decides. A record (the recording or its meeting) that names the incoming filename is the strong
 * signal; the same day and a duration within 15 s is the plausible one (ASR durations drift by seconds).
 */
function recordingsWithoutFile() {
	const out = [];
	if (!fs.existsSync(RECORDINGS_DIR)) return out;
	for (const f of walk(RECORDINGS_DIR).filter((f) => f.endsWith('.meeting-recording.md'))) {
		const text = fs.readFileSync(f, 'utf8');
		if (/^recording_file:\s*\S/m.test(text)) continue;              // has its binary
		if (!/^origin:\s*audio\s*$/m.test(text)) continue;              // pasted text needs no binary
		const id = path.relative(RECORDINGS_DIR, f).replace(/\.meeting-recording\.md$/, '');
		const meetingRef = fmValue(text, 'meeting');
		let haystack = text;   // the original filename is often written on the meeting, so search both
		if (meetingRef) {
			const mf = meetingFile(meetingRef.replace(/^meetings\//, ''));
			if (mf) haystack += '\n' + fs.readFileSync(mf, 'utf8');
		}
		out.push({
			id, meeting: meetingRef,
			date: fmValue(text, 'date'),
			duration: fmValue(text, 'duration'),
			// substring containment, NOT a filename regex: these names have spaces ("Sam jul23.m4a")
			// and live inside a path in prose, so any tokenizer that stops at whitespace misses them.
			_hay: haystack.toLowerCase(),
		});
	}
	return out;
}

/**
 * The `storage` block of a compiled descriptor — `path`, `suffix` and the `under` placement — read with
 * the same frontmatter-grade line parsing this script uses everywhere, because this module declares no
 * YAML dependency (house rule 8) and these four keys are the only ones it needs.
 */
function compiledStorage(name) {
	let text;
	try { text = fs.readFileSync(path.join(ROOT, '.dreamteamer', 'collections', `${name}.collection.yaml`), 'utf8'); } catch { return null; }
	const block = /^storage:\n((?:[ \t]+.*\n?)+)/m.exec(text)?.[1];
	if (!block) return null;
	const out = {};
	let under = null;
	for (const line of block.split('\n')) {
		const m = /^(\s+)([a-z_]+):\s*(.*)$/.exec(line);
		if (!m) continue;
		const [, indent, key, raw] = m;
		const value = raw.replace(/^['"]|['"]$/g, '');
		if (key === 'under' && raw === '') { under = {}; out.under = under; continue; }
		if (under && indent.length > 2) under[key] = value;
		else if (indent.length === 2) out[key] = value;
	}
	return out;
}

/**
 * The file a meeting id names, or null. The COMPILED descriptor says where meetings live — and since
 * engine 0.32 a meeting with a `company` may live INSIDE that company's folder (`storage.under`), so
 * after the collection's own root every parent record's child folder is probed too. A probe, not a
 * walk: this runs once per recording that lacks its binary.
 */
function meetingFile(id) {
	let parent = null;
	const storage = compiledStorage('meetings');
	const dir = path.join(ROOT, String(storage?.path || 'data/meetings'));
	const name = `${id}.${storage?.suffix || 'meeting'}.md`;
	const own = path.join(dir, name);
	if (fs.existsSync(own)) return own;
	const under = storage?.under;
	if (!under?.collection || !under.path || !(parent = compiledStorage(under.collection))?.path) return null;
	const parentDir = path.join(ROOT, String(parent.path));
	if (!fs.existsSync(parentDir)) return null;
	for (const e of fs.readdirSync(parentDir, { withFileTypes: true })) {
		if (!e.isDirectory() || e.name.startsWith('.')) continue;
		const f = path.join(parentDir, e.name, under.path, name);
		if (fs.existsSync(f)) return f;
	}
	return null;
}

/** `m:ss` or `h:mm:ss` → seconds, for a tolerant duration comparison */
function secs(d) {
	const m = String(d ?? '').match(/^(?:(\d+):)?(\d+):(\d{2})$/);
	return m ? (+(m[1] ?? 0) * 3600) + (+m[2] * 60) + +m[3] : null;
}

/** The local calendar day (`YYYY-MM-DD`) of a date or date-time value, or null. */
function localDay(v) {
	if (!v) return null;
	if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
	const t = new Date(v);
	return isNaN(t) ? String(v).slice(0, 10) : iso(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

// ---------------------------------------------------------------- verbs
const verb = process.argv[2] ?? 'scan';
// `--files-folder` overrides `resolveVar('FILES_FOLDER')` — see "the inbox no longer needs staging"
// above. `--inbox-folders` is the matching override for `INBOX_FOLDERS` (a newline-separated list).
const argOf = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const filesFolder = argOf('--files-folder') ?? resolveVar('FILES_FOLDER');
const inboxFoldersOverride = argOf('--inbox-folders');

if (verb === 'scan') {
	const roots = resolveInboxRoots(inboxFoldersOverride);
	if (!roots.length) die('INBOX_FOLDERS resolves to no usable root — declare it in dreamteamer.vars, set it in .env, and start the sync client(s)');
	const inboxDirs = roots.map((r) => path.join(r, 'meeting-recordings'));
	const known = knownFingerprints();

	const out = [];
	const seenFingerprints = new Map();   // fingerprint -> first inbox_path, for the cross-root duplicate note
	for (const root of roots) cleanMootLogs(root, 'meeting-recordings');   // scan-start: heal any stray log
	for (const inbox of inboxDirs) {
		if (!fs.existsSync(inbox)) { console.error(`  (inbox root has no recordings/ yet: ${inbox})`); continue; }
		for (const p of walkFiles(inbox)) {
			const name = path.basename(p);
			if (name.endsWith('.log')) continue;                    // `*.log` is never a payload (spec §3.2b)
			const ext = path.extname(name).toLowerCase();
			if (!AUDIO.has(ext)) continue;
			const stem = path.basename(name, path.extname(name));
			const st = fs.statSync(p);
			const fingerprint = sha256(p);
			const parsed = parseName(stem, st.mtime);
			const [y, mo] = parsed.date.split('-');
			const s = slug(parsed.hint) || 'recording';
			// The same recording can be dropped into more than one inbox root (design §2.1: "dedupe
			// by sha256, across roots"). The FIRST occurrence is the real candidate; every later one
			// with the same fingerprint is flagged rather than proposed as a second import.
			const duplicateOf = seenFingerprints.get(fingerprint) ?? null;
			if (!duplicateOf) seenFingerprints.set(fingerprint, p);
			out.push({
				inbox_path: p,
				duplicate_of: duplicateOf,
				known: known.has(fingerprint) ? known.get(fingerprint) : null,
				proposed_id: `${y}/${mo}/${parsed.date}--${s}`,
				name: parsed.hint || stem,
				name_is_transliterated: /[֐-׿]/.test(parsed.hint),
				date: parsed.date,
				time_hint: parsed.time,
				duration: duration(p),
				fingerprint,
				size_mb: +(st.size / 1048576).toFixed(1),
				mtime: st.mtime.toISOString(),
				date_source: parsed.how,
				confident: parsed.confident,
				ext,
			});
		}
	}
	// A file-less recording cannot be hash-matched, so attach candidates to every NEW file and let the
	// agent judge. Without this, a recovered binary silently becomes a second record for one meeting.
	const orphans = recordingsWithoutFile();
	for (const r of out) {
		if (r.known) continue;
		const base = path.basename(r.inbox_path);
		const rs = secs(r.duration);
		r.orphan_candidates = orphans
			.map((o) => {
				const named = o._hay.includes(base.toLowerCase());
				const os_ = secs(o.duration);
				const durClose = rs != null && os_ != null && Math.abs(rs - os_) <= 15;
				const sameDate = localDay(o.date) === r.date;
				if (!named && !(sameDate && durClose)) return null;
				return {
					recording: o.id, meeting: o.meeting, date: o.date, duration: o.duration,
					evidence: [named && 'NAMES this exact filename', sameDate && 'same date',
						durClose && `duration within 15s (${o.duration} vs ${r.duration})`].filter(Boolean),
					strength: named ? 'strong' : 'plausible',
				};
			})
			.filter(Boolean);
	}

	for (const o of orphans) delete o._hay;
	console.log(JSON.stringify({
		inbox_roots: inboxDirs,
		total: out.length,
		duplicates_across_roots: out.filter((r) => r.duplicate_of).length,
		already_in_vault: out.filter((r) => r.known).length,
		new: out.filter((r) => !r.known && !r.duplicate_of).length,
		new_with_orphan_candidates: out.filter((r) => !r.known && !r.duplicate_of && r.orphan_candidates?.length).length,
		recordings_without_file: orphans.length,
		recordings: out,
	}, null, 2));
} else if (verb === 'import') {
	const src = process.argv[3];
	const idIdx = process.argv.indexOf('--id');
	if (!src || idIdx === -1) die('usage: detect.mjs import <file> --id <recording-id>');
	const id = process.argv[idIdx + 1];
	if (!fs.existsSync(src)) die(`no such file: ${src}`);
	// 'seen' at first touch, only if this payload has no log yet (spec §3.2b). Everything below that
	// refuses also logs 'refused' before dying, so an inbox folder explains itself even mid-failure.
	if (!fs.existsSync(logPathOf(src))) logEvent(src, 'seen', { sha256: sha256(src), size: fs.statSync(src).size });
	// ── no media/ copy any more (23/08/2026) ────────────────────────────────────────────────────────
	// This used to copy into `media/meeting-recordings/<id>.<ext>` FIRST, verify that, and only then
	// move the original into the archive — so every recording existed twice on this disk forever, once
	// under a gitignored repo folder and once under FILES_FOLDER. The operator retired `media/` for
	// exactly that reason: the archive IS the durable copy, and Drive-for-Desktop uploading it is a
	// separate background concern, so a second local copy bought nothing.
	//
	// What made this safe to drop is that NOTHING in the scan path reads `media/`: `knownFingerprints`
	// dedupes from each record's STORED `fingerprint` field and only hashes records that lack one —
	// which was 0 of 53. The old `file` field was the last consumer, and it is gone from the schema.
	const before = sha256(src);

	// The recording's one durable home: meeting-recordings/<id>.<ext> — FLAT, because the id itself
	// already carries the year/month split (`<year>/<month>/<date>--<slug>`); joining it under
	// meeting-recordings/ recreates those same two directory levels as a side effect of the id's own
	// shape, never a second date parse. Revision 2 (2026-08-22) drops the `files/` segment: FILES_FOLDER
	// now points AT the files folder.
	// ⚠ 2026-08-31, capture→recording terminology pass: the destination file is now named after the
	// RECORD id, not the inbox payload's original filename — the archive is SELF-INDEXING. Given a
	// record you can derive its file (`meeting-recordings/<id>.<ext>`) with no lookup; given a file you
	// can derive its record the same way. This also folds the separate `<year>/<month>` extraction that
	// used to sit here (added 23/08/2026, to unify the two shapes `<year>/` and `<year>/<month>/` this
	// archive had accumulated) into the id itself — there is nothing left to extract.
	const ext = path.extname(src).toLowerCase();
	// Nothing has been written yet at this point, so both guards below leave the inbox exactly as it
	// was — the payload is still the only copy and it has not moved.
	if (!filesFolder) { logEvent(src, 'refused', { reason: 'files-folder-unresolved' }); die('FILES_FOLDER does not resolve — cannot archive; the payload is untouched in the inbox'); }
	// A `gdrive://…` value (`.env.web`'s shape for FILES_FOLDER, since a cloud session has no synced
	// mount) is not a local path — `path.join`/`mkdirSync`/`copyFileSync` below would treat it as a
	// RELATIVE path and silently create real directories inside the repo. Same guard doctor.mjs
	// already applies to every declared var (`!val.startsWith('/')`) before it will stat one.
	if (!filesFolder.startsWith('/')) {
		logEvent(src, 'refused', { reason: 'files-folder-not-local' });
		die(`FILES_FOLDER ("${filesFolder}") is not a local path — likely a gdrive:// address (.env.web);`
			+ ' this script needs a local synced folder to archive into. The payload is untouched in the inbox.');
	}
	const archiveFile = path.join(filesFolder, 'meeting-recordings', `${id}${ext}`);
	// The archive is named after the RECORD id, never the inbox payload's own filename — so a
	// collision here means the SAME id is being imported a second time (almost certainly a mistake,
	// e.g. a re-run after a crash whose trash-move step already succeeded), not two different phone
	// auto-names (`Voice Memo.m4a`, `New Recording 3.m4a`) landing on the same original name the way
	// they used to. Writing over it would silently DESTROY that recording's only archived copy — and
	// since `media/` retired, there is no second local copy to recover from. So refuse and name both:
	// "an error naming the choices, never a silent pick".
	// The folders are created on demand — matching the screenshots twin's own
	// `mkdirSync(dest, { recursive: true })`. Before that fix `meeting-recordings/` held only whichever
	// years already existed by hand, so the first recording of a new year died here with ENOENT.
	fs.mkdirSync(path.dirname(archiveFile), { recursive: true });
	if (fs.existsSync(archiveFile)) {
		logEvent(src, 'refused', { reason: 'archive-destination-already-exists' });
		die(`REFUSING to archive: ${archiveFile} already exists.\n`
			+ `  Record id "${id}" already has archived audio under meeting-recordings/ — importing again would destroy it.\n`
			+ `  The payload is still in the inbox, untouched. Confirm whether this id was already imported before re-running.`);
	}

	// ⚠ COPY-VERIFY-then-remove, never a bare rename. `renameSync` was what this did until 23/08/2026,
	// and it carried a latent bug: an inbox root and the archive are only sometimes on the same
	// filesystem. The Drive root is; the **iCloud root is not**, so filing a recording the operator
	// dropped from their phone would have died with EXDEV — after `media/` had already taken a copy,
	// which is why nobody hit it. With `media/` gone there is no consolation copy, so the sequence has
	// to be safe on its own: copy across, prove the copy by hash, and only then let go of the source.
	try {
		fs.copyFileSync(src, archiveFile);
	} catch (e) {
		logEvent(src, 'refused', { reason: 'archive-copy-failed' });
		die(`could NOT copy the payload to ${archiveFile}: ${e.message}\n`
			+ `  — the payload is untouched in the inbox; check permissions/disk space under FILES_FOLDER/meeting-recordings/.`);
	}
	const after = sha256(archiveFile);
	if (before !== after) {
		fs.rmSync(archiveFile, { force: true });        // the bad copy goes, the source stays
		logEvent(src, 'refused', { reason: 'archive-copy-verification-failed' });
		die(`copy verification FAILED for ${src} → ${archiveFile}\n`
			+ '  — the incomplete copy was removed and the payload is untouched in the inbox. Nothing was lost.');
	}

	// Only now is it safe to let the source go — and letting go is a MOVE to this root's trash/, never
	// an unlink (design §3.2). `trash/` is a sibling inside the same inbox root, so this rename is
	// always same-filesystem even when the archive was not. The operator empties trash by hand, which
	// is the undo.
	// Which inbox root does this payload live under? Prefer a DECLARED root (so `trash/` lands where
	// the gate and the doctor already look), and fall back to the nearest ancestor that has one — a
	// payload passed in from outside any declared root still gets a sane home rather than a crash.
	const inboxRoot = (() => {
		const declared = resolveInboxRoots(inboxFoldersOverride);
		for (let d = path.dirname(src); d !== path.dirname(d); d = path.dirname(d)) {
			if (declared.includes(d)) return d;
		}
		for (let d = path.dirname(src); d !== path.dirname(d); d = path.dirname(d)) {
			if (fs.existsSync(path.join(d, 'trash'))) return d;
		}
		return path.dirname(src);
	})();
	try {
		fs.renameSync(src, uniqueTrashPath(path.join(inboxRoot, 'trash'), path.basename(src)));
	} catch (e) {
		logEvent(src, 'archived-but-source-not-trashed', { reason: e.message, recording_file: archiveFile });
		console.error(`⚠ archived to ${archiveFile} and VERIFIED, but could not move the payload to trash: ${e.message}`);
		console.error('  The archive copy is good. Remove the inbox payload by hand — it is now a duplicate.');
	}

	// Fully processed = payload filed + log DELETED (spec §3.2b). The log sits beside the OLD payload
	// path, so it is unlinked directly: durable history lives on the record's own `recording_file` /
	// `fingerprint`, not this scratch file.
	fs.rmSync(logPathOf(src), { force: true });

	// `recording_file` is printed as the ${env:FILES_FOLDER} TEMPLATE, not the absolute path — the
	// field on the record must be machine-portable, and every caller was converting by hand (or
	// forgetting to). `recording_file_resolved` keeps the absolute path for anything local, e.g.
	// transcribing next. (Renamed from `archive_file` / `archive_file_resolved` in the
	// capture→recording terminology pass, 2026-08-31 — same two values, same intent.)
	console.log(JSON.stringify({
		fingerprint: after,
		recording_file: '${env:FILES_FOLDER}' + archiveFile.slice(filesFolder.length),
		recording_file_resolved: archiveFile,
		duration: duration(archiveFile),
	}, null, 2));
} else {
	// `backfill-fingerprints` lived here until 23/08/2026. It hashed every record that had a `media/`
	// path but no `fingerprint` — and once `media/` retired there was nothing left for it to read, so
	// it was provably dead rather than merely unused (CLAUDE.md: correctness is not usage; measure
	// before you keep). Its job is done at write time now: `import` always prints a fingerprint.
	die(`unknown verb "${verb}" (scan | import)`);
}

function die(msg) { console.error(`✖ ${msg}`); process.exit(1); }
