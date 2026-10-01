#!/usr/bin/env node
// Bring screenshots taken during meetings into the vault. Deliberately the same shape as
// ingesting-recordings/bin/detect.mjs — scan → sha256 dedupe → file → done — so `dt sync` can
// trigger it later with no redesign, and so the two inboxes behave identically.
//
//   node bin/detect.mjs scan [--from YYYY-MM-DD] [--to YYYY-MM-DD]   pure read, JSON, writes nothing
//   node bin/detect.mjs archive <file> <meeting-id>                  move the original into
//                                                                     meetings/<meeting id>/screenshots/
//
// ⚠ Every `${env:INBOX_FOLDERS}` root's `meeting-screenshots/` lives INSIDE the same synced tree as
// the destination (`${env:FILES_FOLDER}/meetings/…`) when that root is the Drive one — so filing is a
// local move there, no Drive API upload, no second `ingested/` copy (spec
// the 2026-08-22 files-folder design §3.3, revision 2). `INBOX_FOLDERS` is a LIST —
// desktop carries a second root under iCloud, for the phone's zero-friction share sheet — and every
// scan iterates all of them.
//
// The SCRIPT does mechanics (scan, hash, parse the capture time, propose a match, file the move).
// The AGENT does judgment: confirming a match, then pointing the meeting at the folder. Same split
// as recordings.
//
// The inbox log (spec §3.2b): `archive` writes `<file>.log` beside the shot (`seen` at first touch,
// `refused` if the destination is already taken) and DELETES it once the shot is fully filed — the
// log is narrative-only working memory, never a second source of truth this script reads from.
// `scan` heals a moot log (payload already gone) into `<root>/trash/` at the start of every run, and
// never reads a `*.log` as a payload (the `walk` helper already filters to IMAGE extensions only).
//
// ⚠ MATCHING IS ON THE CALENDAR SLOT, widened by SLACK. That is the only anchor that actually
// exists: `recorded_at` has no automatic source (a recording file's creation_time is when the COPY
// was written — the operator uploads to iCloud well after the call), so it is usually empty. When a
// recording DOES carry a trustworthy recorded_at, the real span [recorded_at, +duration] is used
// instead and `basis` says so.
// Slack is needed because slots are routinely wrong in both directions: one call measured
// started 9m40s late, and another ran 87 minutes in a 30-minute slot. So the window is
// [starts - 1h, ends + 1h].
// ⚠ ±1 hour is a HARD SCOPE BOUNDARY set by the operator (2026-08-02), not a heuristic to tune.
// Anything outside every meeting's window is out of scope: reported, left in the inbox, never
// filed — and the correct response to an ambiguous shot is to ASK, not to widen the window.
// The trade is deliberate: this gives up the 87-minute overrun case in exchange for never
// uploading one client's screen into another client's Drive folder. Omit rather than risk it.
// Unmatched shots are REPORTED, never guessed into the nearest meeting — plenty of the
// operator's screenshots have nothing to do with any call.

import { readFileSync, existsSync, readdirSync, statSync, renameSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ⚠ WALKED, never process.cwd() — same fix as the recordings scanner, for the same reason. Here the
// wrong cwd used to fail loudly but for the WRONG reason: `resolveVar` runs the engine with an
// explicit `cwd: ROOT`, but a wrong ROOT would still resolve against the wrong workspace's `.env`
// and report a plausible-looking wrong answer rather than the real fault, the directory you ran
// from. package-lock.json, not package.json — every module carries the latter.
// ⚠ a folder sitting directly inside `git_modules/` is a module clone, never the workspace, even when `npm install` left it a lockfile.
const vaultRoot = () => {
  for (let d = path.dirname(fileURLToPath(import.meta.url)); ; d = path.dirname(d)) {
    const inGitModules = path.basename(path.dirname(d)) === 'git_modules';
    if (!inGitModules && existsSync(path.join(d, 'package-lock.json'))) return d;
    if (path.dirname(d) === d) throw new Error(`vault root (package-lock.json) not found above ${import.meta.url}`);
  }
};
const ROOT = vaultRoot();
const MEETINGS = path.join(ROOT, 'data/meetings');
const RECORDINGS_DIR = path.join(ROOT, 'data/meeting-recordings');
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic']);

// The scope boundary: a screenshot is only ever considered for a meeting whose slot it falls
// within ±1 hour. Outside that, out of scope — reported, never filed. See the block at `slackFrom`.
const SLACK_MS = 60 * 60000;

const die = (m) => { console.error(`✖ ${m}`); process.exit(1); };

// ── declared vars: resolved by the ENGINE, never by a second .env read ───────────────────────────
// Same shape as the recordings scanner's `resolveVar` (each skill script is self-contained — no
// cross-skill import). `FILES_FOLDER` is declared in the workspace package.json's `dreamteamer.vars`, so
// `dt resolve '${env:FILES_FOLDER}'` is its one resolver — reading it out of `.env` directly here
// would be a second resolver, the exact duplication that retired FILE_MOUNTS.
function resolveVar(name) {
  const engine = path.join(ROOT, 'node_modules/.bin/dreamteamer');
  if (!existsSync(engine)) return undefined;
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
    if (!existsSync(root)) { console.error(`  (skipping inbox root — does not exist on this machine: ${root})`); continue; }
    roots.push(root);
  }
  return roots;
}

// ── the inbox log — working memory beside the payload (spec §3.2b) ─────────────────────────────────
// `<exact-payload-filename>.log`, append-only, narrative only: the PAYLOAD's presence/location is
// the only truth this script or anything downstream ever decides from. Copied verbatim from the
// recordings detect.mjs (self-contained scripts, no cross-skill import).
const logPathOf = (payload) => `${payload}.log`;
function logEvent(payload, event, kv = {}, actor = 'screenshots-detect@desktop') {
  const parts = Object.entries(kv).map(([k, v]) => `${k}=${v}`).join(' ');
  appendFileSync(logPathOf(payload), `${new Date().toISOString()}  ${event}  ${parts}  by=${actor}\n`);
}

// `<date>--` prefix on a name collision — never overwrite, never guess which file wins.
function uniqueTrashPath(trashDir, name) {
  mkdirSync(trashDir, { recursive: true });
  let dest = path.join(trashDir, name);
  if (!existsSync(dest)) return dest;
  const datePrefix = new Date().toISOString().slice(0, 10);
  dest = path.join(trashDir, `${datePrefix}--${name}`);
  for (let n = 2; existsSync(dest); n++) dest = path.join(trashDir, `${datePrefix}--${n}--${name}`);
  return dest;
}

// At scan start: a `*.log` whose payload is gone is moot — move it to `<root>/trash/` (spec §3.2b).
// Self-healing for a stray log any transport left behind. Removal is never a delete (design §3.2),
// so this is a rename, never an unlink.
function cleanMootLogs(root, kind) {
  const dir = path.join(root, kind);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.log')) continue;
    const logP = path.join(dir, name);
    const payload = logP.slice(0, -'.log'.length);
    if (existsSync(payload)) continue;
    renameSync(logP, uniqueTrashPath(path.join(root, 'trash'), name));
  }
}

const walk = (d, out = []) => {
  if (!existsSync(d)) return out;
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    // No `ingested/` any more — a filed shot MOVES out of the inbox entirely (see `archive` below),
    // so there is nothing left to skip.
    if (e.isDirectory()) walk(p, out);
    else if (IMAGE.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
};

const sha256 = (f) => `sha256:${createHash('sha256').update(readFileSync(f)).digest('hex')}`;

// ── the capture time ─────────────────────────────────────────────────────────────────────────────
// macOS names screenshots "Screenshot 2026-07-30 at 14.46.12.png" — the absolute capture instant, to
// the second, which is far better evidence than mtime (a copy re-stamps mtime; the name survives it).
// Falls back to mtime and says which was used, because the format is macOS- and locale-specific.
function capturedAt(file) {
  const stem = path.basename(file, path.extname(file));
  const m = stem.match(/(\d{4})-(\d{2})-(\d{2})[ _]+at[ _]+(\d{1,2})[.:](\d{2})[.:](\d{2})/i);
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    return { at: `${y}-${mo}-${d}T${String(h).padStart(2, '0')}:${mi}:${s}`, source: 'filename', confident: true };
  }
  const t = statSync(file).mtime;
  const p = (n) => String(n).padStart(2, '0');
  return {
    at: `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`,
    source: 'mtime', confident: false,
  };
}

// ── vault reads (frontmatter only — no yaml dep, same approach as detect.mjs) ─────────────────────
const fmOf = (src) => (src.match(/^---\n([\s\S]*?)\n---/) ?? [])[1] ?? '';
const field = (fm, k) => (fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) ?? [])[1]?.trim().replace(/^["']|["']$/g, '');
const listOf = (fm, k) => {
  const m = fm.match(new RegExp(`^${k}:\\n((?:\\s+-\\s+.+\\n?)+)`, 'm'));
  return m ? m[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean) : [];
};

const walkRecords = (dir, suffix, out = []) => {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkRecords(p, suffix, out);
    else if (e.name.endsWith(suffix)) out.push(p);
  }
  return out;
};

const idOf = (file, base, suffix) => path.relative(base, file).replace(suffix, '');

// "51:33" → seconds
const durSecs = (d) => {
  if (!d) return null;
  const p = String(d).split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : null;
};
const ms = (s) => (s ? Date.parse(s) : NaN);

function meetings() {
  // recordings indexed by the meeting they belong to, so a meeting can be matched on real span
  const recs = [];
  for (const f of walkRecords(RECORDINGS_DIR, '.meeting-recording.md')) {
    const fm = fmOf(readFileSync(f, 'utf8'));
    recs.push({ id: idOf(f, RECORDINGS_DIR, '.meeting-recording.md'), meeting: field(fm, 'meeting'),
      recorded_at: field(fm, 'recorded_at'), duration: field(fm, 'duration') });
  }
  const out = [];
  for (const f of walkRecords(MEETINGS, '.meeting.md')) {
    const fm = fmOf(readFileSync(f, 'utf8'));
    const id = idOf(f, MEETINGS, '.meeting.md');
    const mine = recs.filter((c) => c.meeting === `meetings/${id}`);
    // Real span from any recording that has an anchor; widest window across parts.
    let from = null, to = null, basis = null;
    for (const c of mine) {
      const st = ms(c.recorded_at), d = durSecs(c.duration);
      if (!Number.isNaN(st) && st && d) {
        from = from === null ? st : Math.min(from, st);
        to = to === null ? st + d * 1000 : Math.max(to, st + d * 1000);
        basis = 'recording';
      }
    }
    if (from === null) {
      const st = ms(field(fm, 'starts')), en = ms(field(fm, 'ends') ?? field(fm, 'starts'));
      from = st; to = Number.isNaN(en) ? st : en;
      basis = 'calendar-slot';
    }
    // TWO windows, and the distinction is what keeps matching honest:
    //   exact  — inside the slot (or the real recording span). A hit here is not negotiable.
    //   slack  — the slot widened by ±SLACK_MS, to RESCUE a shot from a call that started late or
    //            overran. Slack never competes with an exact hit: a generous window on a 12:00
    //            meeting otherwise reaches into the 14:00 one and turns nine clean matches into
    //            ambiguities — measured on 2026-07-30.
    // ⚠ ±1 HOUR IS A HARD SCOPE BOUNDARY, not a tuning knob (operator instruction, 2026-08-02).
    // A shot outside every meeting's ±1h window is OUT OF SCOPE: it is reported and left in the
    // inbox, never filed. The window used to be asymmetric (15 min before / 90 after) to catch an
    // 87-minute call in a 30-minute slot; that reach is deliberately given up. The operator's rule
    // is omit rather than risk it — most of these are a client's screen, and a wrong match uploads
    // one client's data into another client's folder. When in doubt, ASK; do not widen.
    out.push({ id, name: field(fm, 'name'), company: field(fm, 'company'),
      from, to, slackFrom: from - SLACK_MS, slackTo: to + SLACK_MS,
      basis, recordings: mine.map((c) => c.id), screenshots: listOf(fm, 'screenshots') });
  }
  return out.filter((m) => !Number.isNaN(m.from) && m.from !== null);
}

// ⚠ NO VAULT-SIDE FINGERPRINT INDEX ANY MORE. With per-file records gone (2026-07-31) the vault holds
// only a folder pointer, so "is this shot already filed?" is answered by the FILESYSTEM, not by a
// record: a filed shot has MOVED out of the inbox entirely, and `archive` REFUSES a same-name
// collision at the destination rather than silently overwriting it. sha256 is still reported per
// file so the caller can compare bytes if it wants, but nothing in the vault stores it. The trade: a
// shot the operator RENAMES before re-adding will file a second time under the new name — visible in
// the folder, and acceptable because macOS names screenshots by timestamp and they are not normally
// renamed. (Recordings still hash-dedupe: those DO get renamed by hand, which is why that index
// exists there.)

// WHERE the shots are filed: derived by NAME under `${env:FILES_FOLDER}`, never carried as its own
// folder id — the filing is a local move (see `archive` below), and the relative name IS the
// derivation. `scan` reports it as `files_subfolder` so a caller can see the derivation.
//
// The history, because this is the FIFTH shape and each previous one failed differently: it was a
// Drive folder id hard-coded in this file (machine-invariant but install-specific — a copy of the
// script in a second workspace pointed at the FIRST workspace's Drive; dropped when the skill was
// extracted into a shared module, 2026-09-09), before that `meeting-files` under a vault root's own
// .env-declared folder-id key (a second .env key to keep in sync with the root — retired 2026-08-22), before that a
// screenshots-specific Drive-folder-id key (a second id to maintain), and before THAT a `mounts` record
// id ($SCREENSHOTS_MOUNT_ID) resolved against data/mounts/ — a collection with one record, an
// `adapter: gdrive|s3|git` enum in which only gdrive was implemented, and this as its only caller,
// deleted 2026-07-31. (An even earlier version SCANNED data/mounts/ for `purpose: meeting-screenshots`
// and took the first hit — silently picking one of two candidates in readdir order, and silently
// returning null when none matched.) Revision 2 (2026-08-22) drops the `files/` segment: FILES_FOLDER
// now points AT the files folder, so the sub-path is just `meetings`.
const MEETING_FILES = 'meetings';

// ── commands ─────────────────────────────────────────────────────────────────────────────────────
const verb = process.argv[2] ?? 'scan';
const argOf = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
// `--files-folder` overrides `resolveVar('FILES_FOLDER')` — an explicit local-dir override point. Lets a caller (or a test fixture) point this
// script at a throwaway directory instead of this machine's real, `.env`-declared FILES_FOLDER,
// without a second .env resolver. `--inbox-folders` is the matching override for `INBOX_FOLDERS`
// (a newline-separated list, same shape as the declared var).
const filesFolder = argOf('--files-folder') ?? resolveVar('FILES_FOLDER');
if (!filesFolder) die('FILES_FOLDER does not resolve — declare it in dreamteamer.vars and set it in .env');
// A `gdrive://…` value (`.env.web`'s shape for FILES_FOLDER — a cloud session has no synced mount)
// is not a local path. `archive` below joins it straight into `mkdirSync`/`renameSync`, which would
// treat it as a RELATIVE path and silently create real directories inside the repo. Same guard
// doctor.mjs already applies to every declared var (`!val.startsWith('/')`) before it will stat one.
if (!filesFolder.startsWith('/')) {
  die(`FILES_FOLDER ("${filesFolder}") is not a local path — likely a gdrive:// address (.env.web); `
    + 'this script needs a local synced folder, not a remote address.');
}
const inboxFoldersOverride = argOf('--inbox-folders');

if (verb === 'scan') {
  const roots = resolveInboxRoots(inboxFoldersOverride);
  if (!roots.length) die('INBOX_FOLDERS resolves to no usable root — declare it in dreamteamer.vars, set it in .env, and start the sync client(s)');
  const from = argOf('--from'), to = argOf('--to');
  const ms_ = meetings();
  const rows = [];
  const seenFingerprints = new Map();   // fingerprint -> first file, for the cross-root duplicate note

  for (const root of roots) cleanMootLogs(root, 'meeting-screenshots');   // scan-start: heal any stray log

  for (const root of roots) {
    const inbox = path.join(root, 'meeting-screenshots');
    for (const file of walk(inbox).sort()) {
      if (file.endsWith('.log')) continue;   // `*.log` is never a payload (spec §3.2b) — belt & suspenders, `walk` already filters by IMAGE extension
      const c = capturedAt(file);
      if (from && c.at.slice(0, 10) < from) continue;
      if (to && c.at.slice(0, 10) > to) continue;
      const fp = sha256(file);
      const t = Date.parse(c.at);
      // Exact hits first; only if there are none does slack get a say. Tightest window wins inside a
      // tier, so a 30-minute call beats an all-day block that happens to contain the same instant.
      const exact = ms_.filter((m) => t >= m.from && t <= m.to);
      const slack = ms_.filter((m) => t >= m.slackFrom && t <= m.slackTo && !exact.includes(m));
      const tier = exact.length ? 'exact' : 'slack';
      const hits = (exact.length ? exact : slack).sort((a, b) => (a.to - a.from) - (b.to - b.from));
      // The same shot can be dropped into more than one inbox root (design §2.1: "dedupe by sha256,
      // across roots"). The FIRST occurrence is the real candidate; every later one with the same
      // fingerprint is flagged rather than double-counted as a second `new` row.
      const duplicateOf = seenFingerprints.get(fp) ?? null;
      if (!duplicateOf) seenFingerprints.set(fp, file);
      rows.push({
        file, filename: path.basename(file), inbox_root: root,
        captured_at: c.at, captured_at_source: c.source, confident: c.confident,
        fingerprint: fp, size: statSync(file).size,
        duplicate_of: duplicateOf,
        match_tier: hits.length ? tier : null,
        // No meeting within ±1h ⇒ out of scope. Say so in the row rather than leaving a bare empty
        // `matches`, so a caller cannot read "no match" as "needs a decision".
        out_of_scope: hits.length ? undefined : true,
        scope_note: hits.length ? undefined : 'no meeting within ±1h of capture time — out of scope, leave in inbox',
        matches: hits.map((m) => ({ meeting: m.id, name: m.name, basis: m.basis, tier,
          offset_into_recording: m.basis === 'recording' ? `+${String(Math.floor((t - m.from) / 60000)).padStart(2, '0')}:${String(Math.floor(((t - m.from) % 60000) / 1000)).padStart(2, '0')}` : null })),
      });
    }
  }

  const nw = rows.filter((r) => !r.duplicate_of);   // the inbox IS the queue; anything filed already left it via `archive`
  console.log(JSON.stringify({
    inbox_roots: roots.map((r) => path.join(r, 'meeting-screenshots')), files_subfolder: MEETING_FILES,
    total: rows.length,
    duplicates_across_roots: rows.filter((r) => r.duplicate_of).length,
    new: nw.length,
    new_matched: nw.filter((r) => r.matches.length === 1).length,
    new_ambiguous: nw.filter((r) => r.matches.length > 1).length,
    new_out_of_scope: nw.filter((r) => r.matches.length === 0).length,
    low_confidence_time: nw.filter((r) => !r.confident).length,
    scope_window: '±1h around each meeting slot (hard boundary — outside it, out of scope)',
    screenshots: rows,
  }, null, 2));
  process.exit(0);
}

if (verb === 'archive') {
  const [, , , file, meetingId] = process.argv;
  if (!file || !meetingId) die('usage: detect.mjs archive <file> <meeting-id>');
  if (!existsSync(file)) die(`no such file: ${file}`);
  // 'seen' at first touch, only if this payload has no log yet (spec §3.2b).
  if (!existsSync(logPathOf(file))) logEvent(file, 'seen', { sha256: sha256(file), size: statSync(file).size });
  // The inbox now lives INSIDE the same synced tree as the destination (spec §3.3), so filing a shot
  // is one local move — no `drive.mjs write` upload, no second `ingested/` copy. One folder per
  // meeting, nested under the FULL meeting id (`meetingId` carries the whole `<year>/<month>/<id>`
  // reference, slashes and all) with a `screenshots/` leaf — meetings/<meeting id>/screenshots/.
  // ⚠ 2026-08-31: this used to flatten to the meeting's BASENAME only (`meetings/<basename>/`), which
  // meant two meetings sharing a title (a recurring 1:1, say) collided on the same folder. Nesting by
  // the full id — mirroring meeting-recordings' own "the archive path IS the record id" rule — ends
  // that collision risk; `screenshots_folder` (the field name) is unchanged.
  const dest = path.join(filesFolder, MEETING_FILES, meetingId, 'screenshots');
  mkdirSync(dest, { recursive: true });
  const target = path.join(dest, path.basename(file));
  if (existsSync(target)) {
    logEvent(file, 'refused', { reason: 'already-filed-at-destination' });
    die(`already filed: ${target}`);
  }
  renameSync(file, target);
  // Fully processed = payload filed + log DELETED (spec §3.2b) — durable history lives on the
  // meeting's own `screenshots_folder`, not this scratch file.
  rmSync(logPathOf(file), { force: true });
  console.log(JSON.stringify({ archived_to: target }, null, 2));
  process.exit(0);
}

die(`unknown verb: ${verb}`);
