#!/usr/bin/env node
/**
 * detect.mjs — the mechanics behind /fetch-new-recordings.
 *
 * Two verbs, split so that judgment stays with the agent and side effects stay here:
 *
 *   scan                     walk every `${env:INBOX_FOLDERS}` root's `meeting-recordings/`, sha256
 *                            + ffprobe + parse each file, and print JSON with a proposed record for
 *                            each and whether the workspace already has it. Read-only, except that a
 *                            `*.log` sidecar whose payload is gone is moved to `<root>/trash/`.
 *                            `INBOX_FOLDERS` is a LIST — every root is scanned, and a duplicate
 *                            fingerprint across roots is flagged rather than double-counted.
 *   import <file> --id <id>  copy the recording to `${env:FILES_FOLDER}/meeting-recordings/<id>.<ext>`,
 *                            named after the RECORD id, prove the copy by sha256, and only then move
 *                            the inbox payload to that root's `trash/`. Prints `recording_file` +
 *                            `fingerprint` for the caller to set on the record. Writes the inbox log
 *                            beside `<file>` as it goes (`seen` at first touch, `refused` on any
 *                            refusal) and deletes it once the payload is filed — the log is working
 *                            memory, never a second source of truth.
 *
 * Zero dependencies. Requires `ffprobe` on PATH (already a transcribing-recordings prerequisite).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AUDIO = new Set(['.m4a', '.mp3', '.wav', '.aac', '.mp4', '.m4b', '.ogg', '.opus', '.flac']);

// The workspace root is WALKED up from this file, never taken from process.cwd(): run from another
// folder, knownFingerprints() would find no records, every known file would come back new, and the
// agent would mint duplicate records — the one failure this skill exists to prevent.
// package-lock.json, not package.json — every module carries the latter; and a folder directly inside
// `git_modules/` is a module clone, never the workspace, even when `npm install` left it a lockfile.
const workspaceRoot = () => {
	for (let d = path.dirname(fileURLToPath(import.meta.url)); ; d = path.dirname(d)) {
		const inGitModules = path.basename(path.dirname(d)) === 'git_modules';
		if (!inGitModules && fs.existsSync(path.join(d, 'package-lock.json'))) return d;
		if (path.dirname(d) === d) throw new Error(`workspace root (package-lock.json) not found above ${import.meta.url}`);
	}
};
const ROOT = workspaceRoot();
const RECORDINGS_DIR = path.join(ROOT, 'data/meeting-recordings');

// ---------------------------------------------------------------- declared vars
// Resolved by the ENGINE (`dt resolve`), never by reading `.env` a second way, so a declared var has
// exactly one resolver.
function resolveVar(name) {
	const engine = path.join(ROOT, 'node_modules/.bin/dreamteamer');
	if (!fs.existsSync(engine)) return undefined;
	try {
		return execFileSync(process.execPath, [engine, 'resolve', `\${env:${name}}`],
			{ cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
	} catch { return undefined; }   // undeclared, or no value on this machine
}

// ── INBOX_FOLDERS: a LIST of inbox roots, every one scanned ─────────────────────────────────────
// A newline-separated list — a desktop may carry a synced-drive root and a phone-share root, a cloud
// session one. Splits on newlines, trims, drops blanks, and SKIPS a root that does not exist on this
// machine with a printed note rather than dying. `override` mirrors `--files-folder`, so a fixture
// pins this without touching `.env` or a real synced folder.
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

// ── the inbox log — working memory beside the payload ────────────────────────────────────────────
// `<exact-payload-filename>.log`, append-only, narrative only: the PAYLOAD's presence/location is
// the only truth this script or anything downstream ever decides from.
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

// At scan start: a `*.log` whose payload is gone is moot — move it to `<root>/trash/`. Removal is
// never a delete, so this is a rename, never an unlink. Walks the subtree for the same reason `scan` does.
function cleanMootLogs(root, kind) {
	for (const logP of walkFiles(path.join(root, kind))) {
		if (!logP.endsWith('.log')) continue;
		const payload = logP.slice(0, -'.log'.length);
		if (fs.existsSync(payload)) continue;
		fs.renameSync(logP, uniqueTrashPath(path.join(root, 'trash'), path.basename(logP)));
	}
}

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
 * Recordings are named "[date] [context, company, contacts]" by hand, in a few dialects.
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
 * Every fingerprint the workspace already knows — the dedupe index, read from each record's STORED
 * `fingerprint` field. It hashes nothing: a record missing its fingerprint should have one written to
 * it, not recomputed on every scan.
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
 * the same line parsing this script uses everywhere, because this module declares no YAML dependency
 * and these four keys are the only ones it needs.
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
 * The file a meeting id names, or null. The COMPILED descriptor says where meetings live — and a
 * meeting with a `company` may live INSIDE that company's folder (`storage.under`), so after the
 * collection's own root every parent record's child folder is probed too. A probe, not a walk: this
 * runs once per recording that lacks its binary.
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
// `--files-folder` and `--inbox-folders` (a newline-separated list) override the two declared vars,
// so a caller or a test fixture never touches `.env` or a real synced folder.
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
		if (!fs.existsSync(inbox)) { console.error(`  (inbox root has no meeting-recordings/ yet: ${inbox})`); continue; }
		for (const p of walkFiles(inbox)) {
			const name = path.basename(p);
			if (name.endsWith('.log')) continue;                    // `*.log` is never a payload
			const ext = path.extname(name).toLowerCase();
			if (!AUDIO.has(ext)) continue;
			const stem = path.basename(name, path.extname(name));
			const st = fs.statSync(p);
			const fingerprint = sha256(p);
			const parsed = parseName(stem, st.mtime);
			const [y, mo] = parsed.date.split('-');
			const s = slug(parsed.hint) || 'recording';
			// The same recording can be dropped into more than one inbox root. The FIRST occurrence is the
			// real candidate; every later one with the same fingerprint is flagged rather than proposed as a
			// second import.
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
	// 'seen' at first touch, only if this payload has no log yet. Everything below that refuses also
	// logs 'refused' before dying, so an inbox folder explains itself even mid-failure.
	if (!fs.existsSync(logPathOf(src))) logEvent(src, 'seen', { sha256: sha256(src), size: fs.statSync(src).size });
	const before = sha256(src);

	// The recording's one durable home: meeting-recordings/<id>.<ext>. Named after the RECORD id, so the
	// archive is self-indexing — a record names its file and a file names its record, with no lookup —
	// and the id's own `<year>/<month>/` prefix becomes the folder split.
	const ext = path.extname(src).toLowerCase();
	// Nothing has been written yet at this point, so both guards below leave the inbox exactly as it
	// was — the payload is still the only copy and it has not moved.
	if (!filesFolder) { logEvent(src, 'refused', { reason: 'files-folder-unresolved' }); die('FILES_FOLDER does not resolve — cannot archive; the payload is untouched in the inbox'); }
	// A `gdrive://…` value (how a session with no synced mount may set FILES_FOLDER) is not a local
	// path — `path.join`/`mkdirSync`/`copyFileSync` below would treat it as a RELATIVE path and silently
	// create real directories inside the repo.
	if (!filesFolder.startsWith('/')) {
		logEvent(src, 'refused', { reason: 'files-folder-not-local' });
		die(`FILES_FOLDER ("${filesFolder}") is not a local path — likely a gdrive:// address (.env.web);`
			+ ' this script needs a local synced folder to archive into. The payload is untouched in the inbox.');
	}
	const archiveFile = path.join(filesFolder, 'meeting-recordings', `${id}${ext}`);
	// The archive is named after the RECORD id, so a collision means the SAME id is being imported a
	// second time (a re-run after a crash, say). Writing over it would destroy that recording's only
	// archived copy, so refuse and say so. The folders are created on demand.
	fs.mkdirSync(path.dirname(archiveFile), { recursive: true });
	if (fs.existsSync(archiveFile)) {
		logEvent(src, 'refused', { reason: 'archive-destination-already-exists' });
		die(`REFUSING to archive: ${archiveFile} already exists.\n`
			+ `  Record id "${id}" already has archived audio under meeting-recordings/ — importing again would destroy it.\n`
			+ `  The payload is still in the inbox, untouched. Confirm whether this id was already imported before re-running.`);
	}

	// COPY-VERIFY-then-remove, never a bare rename: an inbox root and the archive are not always on the
	// same filesystem, and a rename across filesystems fails with EXDEV. So copy across, prove the copy
	// by hash, and only then let go of the source.
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
	// an unlink. `trash/` sits inside the same inbox root, so this rename is always same-filesystem even
	// when the archive was not. Nothing empties trash/ automatically: emptying it is yours, and until
	// then it is the undo.
	// Which inbox root does this payload live under? Prefer a DECLARED root, and fall back to the nearest
	// ancestor that has a trash/ — a payload passed in from outside any declared root still gets a sane
	// home rather than a crash.
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
		console.error(`archived to ${archiveFile} and VERIFIED, but could not move the payload to trash: ${e.message}`);
		console.error('  The archive copy is good. Remove the inbox payload by hand — it is now a duplicate.');
	}

	// Fully processed = payload filed + log deleted. The log sits beside the OLD payload path, so it is
	// unlinked directly: durable history lives on the record's own `recording_file` / `fingerprint`.
	fs.rmSync(logPathOf(src), { force: true });

	// `recording_file` is printed as the ${env:FILES_FOLDER} TEMPLATE, not the absolute path, so the
	// field on the record is machine-portable. `recording_file_resolved` keeps the absolute path for
	// anything local, e.g. transcribing next.
	console.log(JSON.stringify({
		fingerprint: after,
		recording_file: '${env:FILES_FOLDER}' + archiveFile.slice(filesFolder.length),
		recording_file_resolved: archiveFile,
		duration: duration(archiveFile),
	}, null, 2));
} else {
	die(`unknown verb "${verb}" (scan | import)`);
}

function die(msg) { console.error(`✖ ${msg}`); process.exit(1); }
