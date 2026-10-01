#!/usr/bin/env node
// Files screenshots taken during meetings beside the meeting they belong to.
//
//   node bin/detect.mjs scan [--from YYYY-MM-DD] [--to YYYY-MM-DD]   pure read, JSON, writes nothing
//   node bin/detect.mjs archive <file> <meeting-id>                  move the original into
//                                                                     meetings/<meeting id>/screenshots/
//
// Every `${env:INBOX_FOLDERS}` root's `meeting-screenshots/` is scanned; `INBOX_FOLDERS` is a list,
// one root per line. When an inbox root sits in the same synced tree as `${env:FILES_FOLDER}`, filing
// is one local move.
//
// The script does mechanics (scan, hash, parse the capture time, propose a match, file the move).
// The agent does judgment: confirming a match, then pointing the meeting at the folder.
//
// The inbox log: `archive` writes `<file>.log` beside the shot (`seen` at first touch, `refused` if
// the destination is already taken) and deletes it once the shot is filed. The log is narrative
// only, never a source of truth this script reads from. `scan` moves a log whose payload is gone
// into `<root>/trash/` at the start of every run, and never reads a `*.log` as a payload.
//
// Matching is on the calendar slot, widened by SLACK. When a recording carries a trustworthy
// `recorded_at`, its real span [recorded_at, +duration] is used instead and `basis` says so.
// The ±1 hour window is a hard scope boundary, not a heuristic to tune: a shot outside every
// meeting's window is reported, left in the inbox and never filed, because a wrong match puts one
// client's screen in another client's folder. An ambiguous shot is a question for the person, never
// a reason to widen the window. Unmatched shots are reported, never guessed into the nearest meeting.

import { readFileSync, existsSync, readdirSync, statSync, renameSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The workspace root is found by walking up from this file to `package-lock.json` (every module
// carries a package.json), never from process.cwd(), so a run from another directory still reads
// this workspace. A folder directly inside `git_modules/` is a module clone, never the workspace.
const workspaceRoot = () => {
  for (let d = path.dirname(fileURLToPath(import.meta.url)); ; d = path.dirname(d)) {
    const inGitModules = path.basename(path.dirname(d)) === 'git_modules';
    if (!inGitModules && existsSync(path.join(d, 'package-lock.json'))) return d;
    if (path.dirname(d) === d) throw new Error(`workspace root (package-lock.json) not found above ${import.meta.url}`);
  }
};
// `--workspace-root` is the same explicit-override shape as `--files-folder` below: a test fixture
// (or a caller operating another checkout) points the record reads at a throwaway workspace.
const rootOverride = (() => { const i = process.argv.indexOf('--workspace-root'); return i > 0 ? path.resolve(process.argv[i + 1]) : undefined; })();
const ROOT = rootOverride ?? workspaceRoot();
const MEETINGS = path.join(ROOT, 'data/meetings');
const RECORDINGS_DIR = path.join(ROOT, 'data/meeting-recordings');

/**
 * The `storage` block of a compiled descriptor — `path`, `suffix` and the `under` placement — read
 * with the same frontmatter-grade line parsing this script uses everywhere (no yaml dependency).
 * Null when the workspace has no compiled runtime, which leaves the module defaults above in force.
 */
function compiledStorage(name) {
  let text;
  try { text = readFileSync(path.join(ROOT, '.dreamteamer', 'collections', `${name}.collection.yaml`), 'utf8'); } catch { return null; }
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
 * Every folder a meeting record can sit in, as `[root, suffixTail]`: the collection's own root, and —
 * when the compiled descriptor places meetings under a parent record (`storage.under`), each parent
 * record's child folder. A meeting's id is its path inside whichever root holds it, so filing under
 * `meetings/<id>/screenshots/` does not depend on where the record is.
 */
function meetingRoots() {
  const storage = compiledStorage('meetings');
  const own = storage?.path ? path.join(ROOT, storage.path) : MEETINGS;
  const tail = `.${storage?.suffix || 'meeting'}.md`;
  const roots = [[own, tail]];
  const under = storage?.under;
  const parent = under?.collection ? compiledStorage(under.collection) : null;
  if (under?.path && parent?.path && existsSync(path.join(ROOT, parent.path))) {
    for (const e of readdirSync(path.join(ROOT, parent.path), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory() && !e.name.startsWith('.')) roots.push([path.join(ROOT, parent.path, e.name, under.path), tail]);
    }
  }
  return roots;
}
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic']);

// The scope boundary: a screenshot is only ever considered for a meeting whose slot it falls
// within ±1 hour. Outside that, out of scope — reported, never filed. See the block at `slackFrom`.
const SLACK_MS = 60 * 60000;

const die = (m) => { console.error(`✖ ${m}`); process.exit(1); };

// ── declared vars: resolved by the engine, never by a second .env read ─────────────────────────────
// `dt resolve '${env:NAME}'` is the one resolver for a declared var. Each skill script carries its
// own copy of this helper rather than importing across skills.
function resolveVar(name) {
  const engine = path.join(ROOT, 'node_modules/.bin/dreamteamer');
  if (!existsSync(engine)) return undefined;
  try {
    return execFileSync(process.execPath, [engine, 'resolve', `\${env:${name}}`],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch { return undefined; }   // undeclared, or no value on this machine
}

// ── INBOX_FOLDERS: a list of inbox roots, every one scanned ─────────────────────────────────────────
// Newline-separated. Splits on newlines, trims, drops blanks, and skips a root that does not exist on
// this machine with a printed note rather than dying. `override` mirrors `--files-folder`: a fixture
// pins this without touching `.env` or a real synced folder.
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

// ── the inbox log, working memory beside the payload ───────────────────────────────────────────────
// `<exact-payload-filename>.log`, append-only, narrative only: the payload's presence and location is
// the only truth this script or anything downstream decides from.
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

// At scan start: a `*.log` whose payload is gone is moot, so it moves to `<root>/trash/`. Removal is
// always a rename, never an unlink.
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
    // A filed shot has moved out of the inbox entirely (see `archive` below), so nothing is skipped.
    if (e.isDirectory()) walk(p, out);
    else if (IMAGE.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
};

const sha256 = (f) => `sha256:${createHash('sha256').update(readFileSync(f)).digest('hex')}`;

// ── the capture time ─────────────────────────────────────────────────────────────────────────────
// macOS names a screenshot "Screenshot YYYY-MM-DD at HH.MM.SS.png": a wall-clock time with no zone.
// It is kept as `wall` and turned into an instant per meeting, in that meeting's own zone, so the
// match does not depend on the zone of the machine running the scan. A file whose name carries no
// time falls back to mtime, which is already an instant, with `confident: false`.
function capturedAt(file) {
  const stem = path.basename(file, path.extname(file));
  const m = stem.match(/(\d{4})-(\d{2})-(\d{2})[ _]+at[ _]+(\d{1,2})[.:](\d{2})[.:](\d{2})/i);
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    return { at: `${y}-${mo}-${d}T${String(h).padStart(2, '0')}:${mi}:${s}`, wall: [+y, +mo, +d, +h, +mi, +s], source: 'filename', confident: true };
  }
  const t = statSync(file).mtime;
  return { at: t.toISOString(), instant: t.getTime(), source: 'mtime', confident: false };
}

// The UTC offset (ms) of an IANA zone at instant `t`.
function zoneOffset(t, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - t;
}

/**
 * The instant a wall-clock capture time names, read in a meeting's zone: its IANA `timezone` when it
 * has a valid one, else the offset written on its `starts`, else the machine zone. Returns the
 * instant and the zone used, so a scan row can say which reading it matched on.
 */
function wallToInstant([y, mo, d, h, mi, s], { timezone, startsOffset } = {}) {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  if (timezone) {
    try {
      const first = asUtc - zoneOffset(asUtc, timezone);
      return { instant: asUtc - zoneOffset(first, timezone), zone: timezone };
    } catch { /* not an IANA zone: fall through to the offset on starts */ }
  }
  if (startsOffset) {
    const o = /^([+-])(\d{2}):?(\d{2})$/.exec(startsOffset);
    const off = startsOffset === 'Z' ? 0 : o ? (o[1] === '-' ? -1 : 1) * (+o[2] * 60 + +o[3]) * 60000 : null;
    if (off !== null) return { instant: asUtc - off, zone: startsOffset };
  }
  return { instant: new Date(y, mo - 1, d, h, mi, s).getTime(), zone: 'machine' };
}

// ── record reads (frontmatter only, no yaml dependency) ─────────────────────────────────────────────
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
  for (const [root, tail] of meetingRoots()) for (const f of walkRecords(root, tail)) {
    const fm = fmOf(readFileSync(f, 'utf8'));
    const id = idOf(f, root, tail);
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
    // Two windows:
    //   exact  — inside the slot (or the real recording span). A hit here is trusted.
    //   slack  — the slot widened by ±SLACK_MS, to rescue a shot from a call that started late or
    //            overran. Slack never competes with an exact hit, so a generous window on a 12:00
    //            meeting cannot reach into the 14:00 one.
    // A shot outside every meeting's ±1h window is out of scope: reported, left in the inbox, never
    // filed. When in doubt, ask; do not widen.
    out.push({ id, name: field(fm, 'name'), company: field(fm, 'company'),
      timezone: field(fm, 'timezone'), startsOffset: /(Z|[+-]\d{2}:?\d{2})$/.exec(field(fm, 'starts') ?? '')?.[1],
      from, to, slackFrom: from - SLACK_MS, slackTo: to + SLACK_MS,
      basis, recordings: mine.map((c) => c.id), screenshots: listOf(fm, 'screenshots') });
  }
  return out.filter((m) => !Number.isNaN(m.from) && m.from !== null);
}

// "Is this shot already filed?" is answered by the filesystem, not by a record: a filed shot has
// moved out of the inbox, and `archive` refuses a same-name collision at the destination. sha256 is
// reported per file so a caller can compare bytes; nothing stores it. A shot renamed before it is
// re-added files again under the new name, which is visible in the folder.

// Where the shots are filed: `meetings/` under `${env:FILES_FOLDER}`, derived by name and never
// carried as a folder id of its own. `scan` reports it as `files_subfolder`.
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
// A `gdrive://…` value (what a cloud session without a synced folder resolves to) is not a local
// path. `archive` would join it into `mkdirSync`/`renameSync` as a relative path and create
// directories inside the repo, so anything that is not an absolute path is refused.
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
      if (file.endsWith('.log')) continue;   // `*.log` is never a payload; `walk` already filters by image extension
      const c = capturedAt(file);
      if (from && c.at.slice(0, 10) < from) continue;
      if (to && c.at.slice(0, 10) > to) continue;
      const fp = sha256(file);
      // The capture instant is read in each meeting's own zone (see `wallToInstant`).
      const when = new Map(ms_.map((m) => [m, c.wall ? wallToInstant(c.wall, m) : { instant: c.instant, zone: 'mtime' }]));
      const tOf = (m) => when.get(m).instant;
      // Exact hits first; only if there are none does slack get a say. Tightest window wins inside a
      // tier, so a 30-minute call beats an all-day block that happens to contain the same instant.
      const exact = ms_.filter((m) => tOf(m) >= m.from && tOf(m) <= m.to);
      const slack = ms_.filter((m) => tOf(m) >= m.slackFrom && tOf(m) <= m.slackTo && !exact.includes(m));
      const tier = exact.length ? 'exact' : 'slack';
      const hits = (exact.length ? exact : slack).sort((a, b) => (a.to - a.from) - (b.to - b.from));
      // The same shot can sit in more than one inbox root. The first occurrence is the candidate;
      // every later one with the same fingerprint is flagged rather than counted as a second `new` row.
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
          captured_instant: new Date(tOf(m)).toISOString(), zone: when.get(m).zone,
          offset_into_recording: m.basis === 'recording' ? `+${String(Math.floor((tOf(m) - m.from) / 60000)).padStart(2, '0')}:${String(Math.floor(((tOf(m) - m.from) % 60000) / 1000)).padStart(2, '0')}` : null })),
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
  // 'seen' at first touch, only if this payload has no log yet.
  if (!existsSync(logPathOf(file))) logEvent(file, 'seen', { sha256: sha256(file), size: statSync(file).size });
  // One local move into one folder per meeting, nested under the full meeting id (`<year>/<month>/<id>`,
  // slashes and all) with a `screenshots/` leaf, so two meetings sharing a title never share a folder.
  const dest = path.join(filesFolder, MEETING_FILES, meetingId, 'screenshots');
  mkdirSync(dest, { recursive: true });
  const target = path.join(dest, path.basename(file));
  if (existsSync(target)) {
    logEvent(file, 'refused', { reason: 'already-filed-at-destination' });
    die(`already filed: ${target}`);
  }
  renameSync(file, target);
  // Fully processed = payload filed + log deleted; the meeting's `screenshots_folder` is the durable pointer.
  rmSync(logPathOf(file), { force: true });
  console.log(JSON.stringify({ archived_to: target }, null, 2));
  process.exit(0);
}

die(`unknown verb: ${verb}`);
