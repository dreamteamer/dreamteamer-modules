#!/usr/bin/env node
// Reads Google Calendar directly from the Calendar v3 API, with the per-account credentials
// `workspace-mcp` stores, and prints the raw JSON.
//
//   node bin/gcal.mjs calendars <email>
//   node bin/gcal.mjs events <email> <calendarId> <timeMin> <timeMax> [--show-deleted]
//   node bin/gcal.mjs event <email> <calendarId> <eventId>
//
// Output is JSON on stdout. The meeting sync depends on three fields a formatted calendar tool drops:
//   • `status`      — confirmed/cancelled/tentative. Tells a cancelled instance from one that never
//                     existed, which keeps a re-sync from duplicating records.
//   • `accessRole`  — a `freeBusyReader` result is a misconfigured calendar row, and is undetectable
//                     without it.
//   • attendee `resource` — how room bookings are excluded instead of becoming contacts.
// It also passes `showDeleted` and `timeZone`.

import { readFileSync, existsSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

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

const [cmd, email, ...rest] = process.argv.slice(2);
if (!cmd || !email) die('usage: gcal.mjs <calendars|events|event> <email> [...]');

const token = await accessToken(email);

if (cmd === 'calendars') {
  const items = await paged(token, 'users/me/calendarList', {});
  // accessRole is what the skill's degraded-read guard depends on.
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
  // 404 here is what distinguishes "never existed" from `status: cancelled`.
  out(await api(token, `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`));
  process.exit(0);
}

die(`unknown command: ${cmd}`);
