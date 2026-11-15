#!/usr/bin/env node
// Reads Google Calendar directly from the Calendar v3 API, with the per-account credentials
// `workspace-mcp` stores, and prints the raw JSON.
//
//   node bin/gcal.mjs rows                         # WORK_CALENDARS as JSON rows; no network
//   node bin/gcal.mjs access                       # every row's accessRole, plus writable calendars no row names
//   node bin/gcal.mjs calendars <email>
//   node bin/gcal.mjs events <email> <calendarId> <timeMin> <timeMax> [--show-deleted]
//   node bin/gcal.mjs event <email> <calendarId> <eventId>
//
// Output is JSON on stdout. The meeting sync depends on three fields a formatted calendar tool drops:
//   • `status`      — confirmed/cancelled/tentative. Tells a cancelled instance from one that never
//                     existed, which keeps a re-sync from duplicating records.
//   • `accessRole`  — a `freeBusyReader` result is a misconfigured calendar row, and is undetectable
//                     without it. `calendars` and `access` carry it; `events` prints only the items.
//   • attendee `resource` — how room bookings are excluded instead of becoming contacts.
// It also passes `showDeleted` and `timeZone`.

import { readFileSync, existsSync, writeSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname, basename, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CRED_DIR = process.env.WORKSPACE_MCP_CREDENTIALS_DIR
  ?? resolve(homedir(), '.config/google-workspace-mcp/credentials');
const KEYS_PATH = process.env.GOOGLE_CLIENT_SECRET_PATH
  ?? resolve(homedir(), '.config/google-calendar-mcp/gcp-oauth.keys.json');

const die = (m) => { console.error(m); process.exit(1); };

// JSON goes out through out(), never console.log, and out() loops. console.log to a pipe is
// asynchronous, and process.exit() discards whatever is still buffered. A single writeSync to a pipe
// performs one write(2), which returns a short count once the 64KB pipe buffer is full. So write in
// a loop until every byte is out, retrying EAGAIN on a non-blocking pipe.
const out = (v) => {
  const buf = Buffer.from(JSON.stringify(v, null, 2) + '\n');
  let off = 0;
  while (off < buf.length) {
    try { off += writeSync(1, buf, off, buf.length - off); }
    catch (e) { if (e.code === 'EAGAIN') continue; throw e; }
  }
};

function clientKeys() {
  if (!existsSync(KEYS_PATH)) die(`no OAuth client at ${KEYS_PATH}`);
  const j = JSON.parse(readFileSync(KEYS_PATH, 'utf8'));
  return j.installed ?? j.web ?? die(`${KEYS_PATH} has neither "installed" nor "web"`);
}

// One access token per run. Credentials are read-only here: this never writes the store,
// so it can never corrupt what the MCP server depends on.
async function accessToken(email) {
  const path = resolve(CRED_DIR, `${encodeURIComponent(email).replace(/%40/g, '@')}.json`);
  if (!existsSync(path)) die(`${email} has no credential (${path}).\nAuthenticate that account through the workspace-mcp server's auth flow (start_google_auth), then re-run.`);
  const cred = JSON.parse(readFileSync(path, 'utf8'));
  const scopes = cred.scopes ?? (cred.scope ?? '').split(/\s+/).filter(Boolean);
  if (!scopes.some((s) => s.includes('/auth/calendar'))) {
    die(`${email} holds no calendar scope — it was granted before calendar was enabled,\n`
      + `or the calendar boxes were unticked at consent. Re-consent that account with the calendar scope ticked.`);
  }
  if (!cred.refresh_token) die(`${email} credential has no refresh_token`);

  const k = clientKeys();
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: k.client_id, client_secret: k.client_secret,
      refresh_token: cred.refresh_token, grant_type: 'refresh_token' }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) die(`token refresh failed for ${email}: ${r.status} ${JSON.stringify(j)}`);
  return j.access_token;
}

async function api(token, path, params = {}) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!r.ok) die(`API ${r.status} on ${path}: ${JSON.stringify(j).slice(0, 400)}`);
  return j;
}

// Pages to the end — a range query that silently stops at one page is how meetings go missing.
async function paged(token, path, params) {
  const items = [];
  let pageToken;
  do {
    const j = await api(token, path, { ...params, maxResults: 2500, pageToken });
    items.push(...(j.items ?? []));
    pageToken = j.nextPageToken;
  } while (pageToken);
  return items;
}

// ── WORK_CALENDARS: one row per calendar, `calendar-id | default-company | account-email` ─────────
// Blank lines and `#` lines are skipped. The company column is the `companies` record a row's events
// default to, passed through as written, or `mixed` for a calendar that holds several companies'
// meetings: a mixed row prints `company: null`, and every event on it is classified on its own. Errors name the line, so a bad row is fixable from the
// message alone.
export function parseWorkCalendars(text) {
  const rows = [];
  const errors = [];
  String(text ?? '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const cols = line.split('|').map((c) => c.trim());
    const at = `WORK_CALENDARS line ${i + 1}`;
    if (cols.length !== 3) { errors.push(`${at}: ${cols.length} column(s), expected calendar-id | default-company | account-email`); return; }
    const [calendar, company, account] = cols;
    if (!calendar) { errors.push(`${at}: no calendar id`); return; }
    if (!company) { errors.push(`${at}: no default company — name a companies id, or \`mixed\``); return; }
    if (!/^[^\s@]+@[^\s@]+$/.test(account)) { errors.push(`${at}: account "${account}" is not an email`); return; }
    if (rows.some((r) => r.calendar === calendar && r.account === account)) { errors.push(`${at}: ${calendar} is already read by ${account} on an earlier line`); return; }
    const mixed = company === 'mixed';
    rows.push({ calendar, company: mixed ? null : company, mixed, account });
  });
  return { rows, errors };
}

// ── access: each row against what its account's calendar list says ──────────────────────────────
// `calendarsByAccount` maps an account email to that account's `calendars` output. A row is `full`
// at owner/writer/reader, `free-busy` at freeBusyReader, and `absent` when its account does not list
// the calendar at all. `unlisted` is every calendar an account can WRITE that no row names: the
// candidates for a missing WORK_CALENDARS row, reported and never synced.
export const FULL_ACCESS = new Set(['owner', 'writer', 'reader']);
export function classifyAccess(rows, calendarsByAccount) {
  const out = rows.map((r) => {
    const cal = (calendarsByAccount[r.account] ?? []).find((c) => c.id === r.calendar);
    const accessRole = cal?.accessRole ?? null;
    const verdict = !cal ? 'absent' : FULL_ACCESS.has(accessRole) ? 'full' : accessRole === 'freeBusyReader' ? 'free-busy' : 'absent';
    return { ...r, accessRole, verdict };
  });
  const named = new Set(rows.map((r) => r.calendar));
  const unlisted = Object.entries(calendarsByAccount).flatMap(([account, cals]) =>
    (cals ?? []).filter((c) => (c.accessRole === 'owner' || c.accessRole === 'writer') && !named.has(c.id))
      .map((c) => ({ account, id: c.id, summary: c.summary, accessRole: c.accessRole })));
  return { rows: out, unlisted };
}

// ── where WORK_CALENDARS comes from ─────────────────────────────────────────────────────────────
// The process environment wins; otherwise the workspace `.env`, read through the engine's own
// `parseEnvValues`, so a quoted multi-line value parses exactly as the engine parses it. The
// workspace is the folder holding package-lock.json, skipping one directly inside `git_modules/`.
function workspaceRoot(from) {
  for (let d = from; d !== dirname(d); d = dirname(d)) {
    const inGitModules = basename(dirname(d)) === 'git_modules';
    if (!inGitModules && existsSync(join(d, 'package-lock.json'))) return d;
  }
  return null;
}

async function workCalendarsText() {
  if (process.env.WORK_CALENDARS) return process.env.WORK_CALENDARS;
  const root = workspaceRoot(dirname(fileURLToPath(import.meta.url))) ?? workspaceRoot(process.cwd());
  if (!root) die('no workspace above this script or the current folder (no package-lock.json)');
  const envFile = join(root, '.env');
  if (!existsSync(envFile)) die(`WORK_CALENDARS is unset: no .env in ${root} and nothing in the environment`);
  let parseEnvValues;
  try {
    const entry = createRequire(join(root, 'package.json')).resolve('dreamteamer');
    ({ parseEnvValues } = await import(pathToFileURL(entry).href));
  } catch (e) { die(`cannot load the dreamteamer engine from ${root}: ${e.message}`); }
  const value = parseEnvValues(readFileSync(envFile, 'utf8')).get('WORK_CALENDARS');
  if (!value || !value.trim()) die(`WORK_CALENDARS is unset in ${envFile}`);
  return value;
}

async function readRows() {
  const { rows, errors } = parseWorkCalendars(await workCalendarsText());
  if (errors.length) die(errors.join('\n'));
  if (!rows.length) die('WORK_CALENDARS holds no rows');
  return rows;
}

async function main(argv) {
  const [cmd, email, ...rest] = argv;
  if (cmd === 'rows') { out(await readRows()); return; }
  if (cmd === 'access') {
    const rows = await readRows();
    const calendarsByAccount = {};
    for (const account of [...new Set(rows.map((r) => r.account))]) {
      calendarsByAccount[account] = (await paged(await accessToken(account), 'users/me/calendarList', {}))
        .map((c) => ({ id: c.id, summary: c.summary, accessRole: c.accessRole }));
    }
    out(classifyAccess(rows, calendarsByAccount));
    return;
  }
  if (!cmd || !email) die('usage: gcal.mjs <rows|access|calendars|events|event> [<email> ...]');

  const token = await accessToken(email);

  if (cmd === 'calendars') {
    const items = await paged(token, 'users/me/calendarList', {});
    // accessRole is what the skill's degraded-read guard depends on.
    out(items.map((c) => ({
      id: c.id, summary: c.summary, primary: !!c.primary,
      accessRole: c.accessRole, timeZone: c.timeZone, selected: !!c.selected,
    })));
    return;
  }

  if (cmd === 'events') {
    const [calendarId, timeMin, timeMax] = rest;
    if (!calendarId || !timeMin || !timeMax) die('usage: gcal.mjs events <email> <calendarId> <timeMin> <timeMax> [--show-deleted]');
    const showDeleted = rest.includes('--show-deleted');
    const items = await paged(token, `calendars/${encodeURIComponent(calendarId)}/events`, {
      timeMin, timeMax, singleEvents: true, orderBy: 'startTime',
      timeZone: process.env.TZ_OVERRIDE ?? 'Asia/Jerusalem',
      showDeleted: showDeleted ? 'true' : undefined,
    });
    out(items);                                    // raw payload — nothing dropped, on purpose
    return;
  }

  if (cmd === 'event') {
    const [calendarId, eventId] = rest;
    if (!calendarId || !eventId) die('usage: gcal.mjs event <email> <calendarId> <eventId>');
    // 404 here is what distinguishes "never existed" from `status: cancelled`.
    out(await api(token, `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`));
    return;
  }

  die(`unknown command: ${cmd}`);
}

/** Run as a script, including through a symlink: both sides are realpathed before they are compared,
 *  or a `git_modules/<name>` link makes the guard false and the script exits 0 having done nothing. */
const isMain = () => {
  if (!process.argv[1]) return false;
  const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
  return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
};

if (isMain()) { await main(process.argv.slice(2)); process.exit(0); }
