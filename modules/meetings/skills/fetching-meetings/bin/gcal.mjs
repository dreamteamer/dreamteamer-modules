#!/usr/bin/env node
// Read Google Calendar DIRECTLY from the Google API, using the credentials that
// `workspace-mcp` already stores per account. Same account, same data, same credentials,
// different transport — the substitution `fetching-meetings` explicitly sanctions.
//
//   node bin/gcal.mjs calendars <email>
//   node bin/gcal.mjs events <email> <calendarId> <timeMin> <timeMax> [--show-deleted]
//   node bin/gcal.mjs event <email> <calendarId> <eventId>
//
// Output is JSON on stdout — the whole point of this file.
//
// WHY THIS EXISTS RATHER THAN THE MCP CALENDAR TOOLS (verified in the installed source,
// workspace-mcp 1.22.2, 2026-07-30): every tool returns `-> str`, a human-formatted string,
// and the codebase has NO structured-output option. The formatter drops three fields the
// meeting sync is built on:
//   • `status`      — confirmed/cancelled/tentative. Never emitted, even for a single event.
//                     Decision 97 used it to tell a CANCELLED instance from one that never
//                     existed; without it the sync creates duplicate records.
//   • `accessRole`  — `list_calendars` emits only summary/primary/id. This is step 3's guard:
//                     a `freeBusyReader` result is a config bug, and undetectable without it.
//   • attendee `resource` — how room bookings are excluded instead of becoming contacts.
// It also has no `showDeleted` and no `timeZone` param, and hardcodes `singleEvents: True`.
//
// If upstream ever ships structured output, this file is the thing to delete.

import { readFileSync, existsSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const CRED_DIR = process.env.WORKSPACE_MCP_CREDENTIALS_DIR
  ?? resolve(homedir(), '.config/google-workspace-mcp/credentials');
const KEYS_PATH = process.env.GOOGLE_CLIENT_SECRET_PATH
  ?? resolve(homedir(), '.config/google-calendar-mcp/gcp-oauth.keys.json');

const die = (m) => { console.error(m); process.exit(1); };

// ⚠ JSON goes out through out(), NEVER console.log — and out() LOOPS. Two separate bugs bite
// here, and fixing only the first still truncates at exactly the same byte:
//   1. console.log to a PIPE is asynchronous, and every path here ends in process.exit(),
//      which discards whatever is still buffered (decision 100).
//   2. writeSync to a pipe performs ONE write(2), which returns a SHORT COUNT once the 64KB
//      pipe buffer is full. A single writeSync therefore truncates too — measured at 65126
//      bytes of a ~200KB range fetch, invalid JSON, zero exit status, both times.
// So: write in a loop until every byte is out, retrying EAGAIN on a non-blocking pipe.
// ⚠ Decision 100's engine fix is a single `fs.writeSync` and has bug 2 unfixed — `dt --json`
// still truncates above ~64KB. Worth carrying this loop over there.
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

const [cmd, email, ...rest] = process.argv.slice(2);
if (!cmd || !email) die('usage: gcal.mjs <calendars|events|event> <email> [...]');

const token = await accessToken(email);

if (cmd === 'calendars') {
  const items = await paged(token, 'users/me/calendarList', {});
  // accessRole is the field the MCP formatter drops and step 3's guard depends on.
  out(items.map((c) => ({
    id: c.id, summary: c.summary, primary: !!c.primary,
    accessRole: c.accessRole, timeZone: c.timeZone, selected: !!c.selected,
  })));
  process.exit(0);
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
  process.exit(0);
}

if (cmd === 'event') {
  const [calendarId, eventId] = rest;
  if (!calendarId || !eventId) die('usage: gcal.mjs event <email> <calendarId> <eventId>');
  // 404 here is what distinguishes "never existed" from `status: cancelled` (decision 97).
  out(await api(token, `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`));
  process.exit(0);
}

die(`unknown command: ${cmd}`);
