---
name: fetching-meetings
description: Use when the user wants to fetch, sync, snapshot, or back up their calendar meetings into `meetings` records for a week or a date range — e.g. "sync my work meetings this week", "fetch next week's meetings to files", "update my meetings". Covers which Google Calendars count as work (`WORK_CALENDARS`, read by `gcal.mjs rows`), deduping across calendars, company classification, non-English titles, and the meeting record convention.
---

# Fetching calendar meetings into `meetings` records

Snapshot **work** meetings from Google Calendar into one `meetings` record per meeting. The records
are the source of truth; this is a manual, on-demand snapshot, not a live sync. Events may carry
**non-English titles** — read the naming rules below before writing records.

## reading the calendar — `bin/gcal.mjs`, direct to the Google API

Calendar reads go through **`.dreamteamer/skills/fetching-meetings/bin/gcal.mjs`**, which calls the
Google Calendar v3 API directly with the credentials `workspace-mcp` stores per account, and prints
**raw JSON**.

```
node .dreamteamer/skills/fetching-meetings/bin/gcal.mjs rows                  # WORK_CALENDARS as JSON rows, no network
node .dreamteamer/skills/fetching-meetings/bin/gcal.mjs access                # each row's accessRole + writable calendars no row names
node .dreamteamer/skills/fetching-meetings/bin/gcal.mjs calendars <account>
node .dreamteamer/skills/fetching-meetings/bin/gcal.mjs events <account> <calendarId> <timeMin> <timeMax> [--show-deleted]
node .dreamteamer/skills/fetching-meetings/bin/gcal.mjs event  <account> <calendarId> <eventId>   # 404 = never existed
```

`<account>` is an **email** — the `account` of the `WORK_CALENDARS` row that `rows` prints — and it is
**required**. `events` prints the event items only; the calendar's `accessRole` comes from `access`
(or `calendars`), which is why the degraded-read check runs before the fetch (step 2), not on it.

**Why a script and not a calendar tool that returns formatted text:** the sync is built on three
fields a formatted reply drops.

| field | what depends on it |
|---|---|
| **`status`** (confirmed/**cancelled**/tentative) | telling a cancelled instance from one that never existed (step 7) |
| **`accessRole`** | the degraded-read guard (step 2), read by `access` |
| attendee **`resource: true`** | excluding room bookings instead of minting contacts for them |

The script also passes `showDeleted` and `timeZone`. It is the same account, the same data and the
same credentials over a different transport. Never substitute a different *source*.

### accounts are emails, and one account reads several calendars

- **One OAuth client for every account** — it identifies the *app*, not the person. `gcal.mjs`
  reads it from `GOOGLE_CLIENT_SECRET_PATH`, default `~/.config/google-calendar-mcp/gcp-oauth.keys.json`.
- **One credential file per account**, named for the email, under
  `~/.config/google-workspace-mcp/credentials/` (override with `WORKSPACE_MCP_CREDENTIALS_DIR`).
  Adding an account touches nothing in the workspace except the `WORK_CALENDARS` row that points at it.
- **Add or re-consent an account** through the `workspace-mcp` server's own auth flow (its
  `start_google_auth` tool). It prints one consent URL, and that URL expires after 10 minutes — a
  stale click fails with *"Invalid or expired OAuth state parameter"*. Re-run for a fresh link.
- **One account often reads several rows.** Dana's personal Google account may read the employer's
  shared calendar at `writer`, a consultancy's at `reader` and her own at `owner` — while a
  colleague's calendar on the employer's domain shows only as **`freeBusyReader`** under that
  personal login. Such a calendar needs its own row and its own account.

A Workspace domain (as opposed to a gmail account) can have an admin policy that blocks unverified
third-party apps — consent then fails with `admin_policy_enforced` / "access blocked". Only an admin
can fix that, by allowlisting the OAuth client id.

**Known setup failures:**

| symptom | cause | fix |
|---|---|---|
| `Error 403: access_denied` — "*has not completed the Google verification process … currently being tested*" | the OAuth app's publishing status is **Testing** | Google Auth Platform → Audience → **PUBLISH APP**. Consent then shows an "unverified app" warning (expected — it is your own app). Adding yourself as a Test user also works, but refresh tokens then expire every 7 days and the sync fails weekly |
| `OAuth credentials not found` / `ENOENT … gcp-oauth.keys.json` | the path variable is not in the **process** environment — the workspace `.env` does not reach a shell | `export` the variable first, and never use `~` in its value — it is passed through verbatim and fails to open |
| auth succeeds but every calendar call returns empty | the wrong account consented, or that account sees the calendar at too low an `accessRole`. An empty Data Access list on the consent screen is normal — the scope is requested at runtime | re-auth the account that owns the calendar; check `accessRole` per calendar with `gcal.mjs access` |
| a `web` top-level key in `gcp-oauth.keys.json` | the client was created as **Web application** | recreate it as **Desktop app** — the flow needs a localhost redirect. A correct file has `installed` and `redirect_uris: ["http://localhost"]` |

**If the calendar cannot be read, work out which of two cases it is** — they need opposite responses:

1. **Setup was never done** → say so and **stop**. Do not fall back to another calendar source and do
   not guess at events. The account is authorized iff
   `~/.config/google-workspace-mcp/credentials/<email>.json` exists:

   ```bash
   ls ~/.config/google-workspace-mcp/credentials/
   ```

2. **Setup is done but the session has no calendar tools loaded** → use `gcal.mjs`, which needs
   only the stored credentials. Follow this file's rules rather than abandoning the sync, and say
   which transport you used in the report.

The line that matters is **source of truth, not plumbing**: never substitute a different *source*
(a browser scrape standing in for the API, a guess, a memory). Swapping transport over the same
credentials is not that.

**One-time setup**, in order:

1. **One GCP project** with the **Google Calendar API** enabled.
2. **OAuth consent screen**, External, publishing status **"In production"** — in Testing, refresh
   tokens expire every 7 days.
3. **OAuth client → Desktop app** (not Web — see the failure table), downloaded to
   `~/.config/google-calendar-mcp/gcp-oauth.keys.json` or wherever `GOOGLE_CLIENT_SECRET_PATH` points.
4. **Authenticate once per account** — see the accounts block above. The calendar scope must be
   ticked at consent or `gcal.mjs` refuses up front.
5. **`WORK_CALENDARS` in the workspace `.env`** — one row per calendar, 3rd column = the account
   **email** that reads it. See "Which calendars count as work".
6. **Verify per calendar, not per account:** run `gcal.mjs access`. Every row must come back
   `verdict: full` (`owner`, `writer` or `reader` under the account its row names). A `free-busy` row
   is misconfigured, and an `absent` row names an account that does not list the calendar at all.

> The `meetings` collection descriptor is the authority on record shape, ids and where a record is
> stored — read it before writing (`using-dreamteamer` → `references/records.md`). Write with
> `npx dt add meetings` and `npx dt set`: both validate before anything reaches disk, and `dt add`
> places the file where the descriptor says. Never compute the path by hand.

## Record convention

The id is

```
<YYYY>/<MM>/<YYYY-MM-DD>--<HH-MM>--<company>--<slug>        # with a company
<YYYY>/<MM>/<YYYY-MM-DD>--<HH-MM>--<slug>                   # with none yet
```

derived by the descriptor's `ids.from` from `starts`, `company` and `name`. `HH-MM` is the start
time, so records sort by start within a day. The file lands where the descriptor places it: the
base module stores meetings under the meetings collection's storage path, and a workspace overlay
may store them elsewhere, under their company for example. Run `npx dt add meetings` and read the
path it prints. `starts` and `name` are required; a meeting with no company yet takes the shorter
id. If date+time+company+slug would collide with an existing *different* event, pass `--id` with
`-2`, `-3` appended. A meeting record holds only the meeting: a transcript belongs to a
`meeting-recordings` record and a summary to a `meeting-summaries` record, when those modules are
installed.

Frontmatter carries the metadata. `description` holds the invite's own description text, exactly as
the organizer wrote it. It is `sensitive`, like `attendees_raw`: a Teams invite carries its join link
and `?p=` passcode there, so an export leaves it out. Any caveat about the sync goes in
`creation_context`:

```yaml
---
name: "Workshop prep (Préparation de l'atelier)"   # the field is `name`, NOT `title` — quote if it contains a colon
starts: "2026-06-29T17:00:00+02:00"
ends: "2026-06-29T18:00:00+02:00"
timezone: Europe/Paris
company: companies/northwind
calendar: dana.o@northwind.example   # the calendar the event was actually read from
origin: calendar                     # provenance MECHANISM — see the provenance block below
synced: "2026-06-28T19:40:00+02:00"  # when this sync wrote the record
status: confirmed
organizer: sam.d@northwind.example
location: Floor 8 meeting room       # a real room only; omit a generic "Microsoft Teams meeting"
conferenceUrl: https://meet.google.example/abc-defg-hij
attendees:                           # `contacts/` REFS ONLY — never raw emails here
  - contacts/sam-diaz
  - contacts/dana-oren
ours:                                # the attendees who are your own people, as `users/` refs
  - users/dana-oren
attendees_raw:                       # the verbatim strings, quoted
  - "sam.d@northwind.example (organizer)"
  - "dana.o@northwind.example (self)"
eventId: 0rrs5m6fep45o9hv1vubjb9aob
htmlLink: https://calendar.google.example/event?eid=0rrs5m6fep45o9hv1vubjb9aob
description: the organizer's invite text, when there is any
author: agents/claude-code           # the harness that ran the sync; the model goes in creation_context
source: calendar:dana.o@northwind.example
creation_context: synced from dana.o@northwind.example by gcal.mjs (model claude-opus)
confidence: normal                   # `low` + the reason in creation_context for a free/busy stub
---
```

The record is written with no body. The title is `name`, so the body carries no `# title` heading:
it is the `notes` field, the meeting's own page, empty until someone writes about the call. Write it
with `--notes "…"` on `dt add` or `npx dt set meetings/<id> notes="…"`. A transcript never goes here.

`privacy` is `open` unless a person set it to `restricted`. The sync never sets or changes it, and an
update leaves it as it is.

### The provenance block — every synced meeting carries it

- **`source: calendar:<calendar-id>`** — the calendar the event was actually *read from*, which is
  not always the calendar it belongs to (a company event mirrored onto a personal calendar is read
  from whichever copy won the dedup in step 4).
- **`synced:`** — a date-time with its offset, stamped on **every** run including re-syncs. That is
  what makes "which meetings have not been refreshed since X" a range filter.
- **`origin: calendar`** — always, for anything this skill writes. `recording` is for a shim meeting
  inferred from a recording, `manual` for one entered by hand, `migration` for one carried over from
  another system.
- **`author` / `creation_context` / `confidence`** — `author` is `agents/claude-code`: the harness
  that ran the sync, in the `agents/<harness>` form every module's `author` field takes, never the
  name of the agent or the model (`agents/dreamteamer` names the routing agent, not the harness).
  The model goes in `creation_context`. A free/busy stub is
  `confidence: low` with the reason in `creation_context` ("free/busy access only; title and
  attendees unavailable").

### Attendees become contacts — every one of them, every sync

For each attendee: resolve against `contacts` **by email first, then by name**. When there is no
match, **create a placeholder** — `status: draft`, `name` from the Google `displayName` when present
else the email local-part title-cased, `email`, `company` when the domain maps, and the provenance
fields with `source: calendar:<id>`, `confidence: low`, and the raw attendee string in
`creation_context`.

`attendees` holds the `contacts/` refs; `attendees_raw` keeps the verbatim strings.

**`ours` is the subset of attendees who are your own people**, as `users/` refs. Resolve each
attendee against `users` by `email`, then by `handles`; an attendee who matches a user goes in `ours`
as well as in `attendees`. Never create a user here: a person with no `users` record is in
`attendees` only. `ours` is what a user's own record lists as their meetings (`users.meetings`).
Empty is normal for a call none of your people attended.

**Three resolution rules that are not "email → contact":**

- **You usually have several addresses** — one per employer plus a personal one (`dana.o@northwind.example`,
  `dana@bright.example`, `dana.oren@gmail.example`). All resolve to **one** `contacts/dana-oren`.
  Never create a second self-contact from an unfamiliar work address.
- **One human, several employers.** `sam.d@bright.example` and `sam.d@northwind.example` are the same
  person → one `contacts/sam-diaz`. A new domain for a known name is a signal to check, not to create.
- **Not every address is a person.** `all@northwind.example` is a distribution list — exclude it
  rather than minting a contact called "All". Same for `no-reply@`, `noreply@`, room and resource
  addresses (the API flags those with `resource: true`) and anything that reads like a group alias.

**Array values on the CLI are comma-split**, so `--attendees_raw "dana.o@northwind.example (self, organizer)"`
becomes **two** entries. Use a separator that is not a comma — `(self + organizer)`.

**Do not enrich here.** Enrichment is `/scrape-contact`'s job when the contacts module ships it — a
`draft` contact is the queue. Creating placeholders is the whole contribution of this step.

### Titles & slugs
- **`name:`** = the cleaned event summary. First **strip cruft**: `FW:`/`RE:` prefixes, trailing
  punctuation, and forwarded `-----Original Appointment-----` boilerplate. For a **non-English
  title**, write `<original> (English gloss)` — the original script first, a short English
  translation in parentheses. **Quote** the YAML value when it contains a colon or another
  YAML-special character.
- **`slug`** = always **English**, lowercase, kebab-case, about 2–4 words, derived from the *topic*:
  - Translate or transliterate a non-English title into a short English topic slug, leading with
    the key noun (`Préparation de l'atelier` → `workshop-prep`). When two meetings share
    vocabulary, pick distinct lead nouns so the slugs do not collide.
  - Drop qualifiers and separators: `Tentative`, parentheticals, `/`, `&`, `()`. Use the **topic**
    when names are incidental (`Dana/Sam - Workshop Slides` → `workshop-slides`); keep the **names**
    only when the title is essentially just names (`Dana & Sam & Priya` → `dana-sam-priya`).
  - A free/busy stub → `busy-block`.

### Conference link & location
- **Google Meet** events: use the `conferenceUrl` field directly.
- **Microsoft Teams** events: Google returns **no** `conferenceUrl` — extract the short
  `https://teams.microsoft.com/meet/...` link from the event description, **keeping its full
  `?p=<passcode>` query string** (ignore the long `/l/meetup-join/...` URL and the dial-in number).
  Put the real room in `location` (gloss a non-English room name to English); drop the generic
  "Microsoft Teams meeting" placeholder in any language.

### Times & timezone
`gcal.mjs events` asks Google for times in the zone named by `TZ_OVERRIDE`, default
`Asia/Jerusalem` — set `TZ_OVERRIDE` to your own IANA zone in the shell that runs it. `starts`,
`ends` and `HH-MM` are the event's start and end in that zone, even when an event's own `timeZone`
differs.

`starts`/`ends` are **one `date-time` each**, carrying the local offset. Google returns exactly this
shape in `start.dateTime`, so pass it through rather than reassembling it. Writing the wall clock
alone (`2026-06-29T17:00`) is also accepted — `npx dt add meetings` stamps the machine's offset on
during validation — so only do that on a machine set to the same zone. Keep `timezone:` too: the
offset says `+02:00`, only the zone name says which zone that was, across DST.

One date-time sorts and range-filters directly: `npx dt list meetings --sort -starts`, or
`--where '{"starts":{"_gte":"2026-07-01"}}'`.

## Which calendars count as "work"

The work calendars, their default company and the account that reads each one live in
`WORK_CALENDARS` in the workspace `.env`, one row per line: `calendar-id | default-company |
account-email`, as a quoted value when it spans lines. **`gcal.mjs rows` is the reader**: it takes the
value from the process environment when one is set, otherwise from `.env` through the engine's own
parser, and prints one JSON object per row (`calendar`, `company`, `mixed`, `account`), or exits 1
naming the line of a malformed row. Add or remove calendars by editing `.env`, never this file.

- **`default-company`** is the `companies` record a row's events default to, before the
  classification rules below override it.
- **`mixed`** in that column means the calendar holds several companies' meetings and has no
  default: `rows` prints `company: null, mixed: true`, and every event on it is classified on its own
  by the rules below. An event a mixed row cannot classify goes to step 6's confirmation.
- **A calendar no row names** that the account can write is listed by `gcal.mjs access` under
  `unlisted`: report each one that looks like work (by its summary or domain) by id, and ask whether
  to add a row, without syncing it.

**Access is per calendar, per account, and it decides detail** — read each row's `accessRole` from
`gcal.mjs access`:
a `freeBusyReader` calendar returns events with **no `summary`/`attendees`** → write a free/busy
**stub**. `owner`/`writer`/`reader` give full detail. A `visibility: private` event on a full-access
calendar still returns full detail — write it in full; **only `freeBusyReader` access forces a stub**.

**A `freeBusyReader` result is a configuration bug, not a fact to work around.** Every row should be
read by an account that holds its calendar directly. If free/busy appears, the row names the wrong
account or that account's grant lapsed → **authenticate the owning account** and fix the row. Do not
scrape, and do not silently accept stubs: say which calendar degraded and why. Stub-writing stays
specified below because a newly added calendar can legitimately be free/busy before its account is
authenticated.

A **stub** keeps only the fields that exist: `name: Busy (private)` (slug `busy-block`), plus
`starts`, `ends`, `timezone`, `company`, `calendar`, `origin: calendar`, `synced`, `status`,
`visibility: private`, `eventId`, `htmlLink`, and the provenance fields with `confidence: low` and
"free/busy access only" in `creation_context` — no `organizer`/`attendees`/`conferenceUrl`/`location`,
and no body.
The start time in the id disambiguates several stubs on one day. Stubs are **included by default**,
but when a range yields many, confirm with the user before writing.

**Ignore (never work):** any calendar that is **not in `WORK_CALENDARS`** — holiday feeds,
music/event feeds, family and shared calendars.

## Company classification

Classify by attendee email **domain**, not by which calendar the event sits on:
- Map the attendee email **domain** to a company: a domain matching a `WORK_CALENDARS` row uses that
  row's `default-company`; an external **client** domain not in `.env` classifies to that client
  (normalize obvious typos to the canonical spelling).
- A **consultancy** calendar (one whose `default-company` does client work) follows the client: an
  all-internal meeting → the consultancy's own company; a meeting that includes a **client** domain
  → the client.
- **No external domain** (an internal or self-only event): classify by the **title** keywords
  instead, normalized to the canonical company spelling.
- The attendee domain decides the company **regardless of time of day** — an evening meeting with a
  work domain is still that company's work meeting.

## Exclusions (apply to every calendar)

- **Declined** events (your own `responseStatus: declined`) — skip. Tentative and `needsAction` are kept.
- **All-day** events and recurring **admin/accounting/"tasks"** items — skip. (They have no start
  time, so they cannot fit the id.)
- **Personal-life** items even when on a work calendar — a gym class, family, errands.
- **Ambiguous** side-project or "team" placeholders — **ask** before including.

Match these keywords against the **translated meaning** of a non-English title.

## Steps

1. **Resolve the date range.** For "this/next week", query the whole week (Monday or Sunday 00:00
   to the next one, exclusive) and keep the days you work; ask when that is unclear. Confirm today's
   weekday with `date "+%Y-%m-%d %A"`.
2. **Read the rows and check access** with `gcal.mjs access` — one call for every row. A `free-busy`
   row means the row's account does not hold that calendar, and an `absent` row means the account
   does not list it → **report it as a configuration bug and name the fix** (re-authenticate the
   owning account, then correct the row). Report the `unlisted` calendars as above.
3. **Fetch** each work calendar with `gcal.mjs events` — the row's `account`, its `calendar` and
   the range. One call per row, never one merged call: `source:` and `calendar:` depend on which
   calendar an event came from. **Guard against a degraded read — never write over good data with
   worse data.** Whatever the reason a fetch came back thin:

   **Never downgrade an existing record.** If a meeting already exists with a real `name` (not
   `name: Busy (private)`) and this run would write a `busy-block` stub over it, **leave it
   untouched**. Same for a fetch that fails outright — a missing calendar is a gap in this run's
   coverage, not a licence to delete or blank records it could not see. Report every record the
   guard protected. If a calendar is thin, fix the auth: a stub is honestly empty, a scraped time is
   confidently wrong.

4. **Dedup by `eventId`** across calendars — company events are often mirrored onto a personal
   calendar. Keep one copy; prefer the company calendar as the `calendar:` source. For a work event
   that is only on the personal calendar, `calendar:` is that calendar's id. Never dedup by time —
   distinct events can share a start.
5. **Classify & filter** — company per the rules above (per event on a `mixed` row); drop everything
   in Exclusions.
6. **Confirm scope BEFORE writing** when anything is ambiguous — a side-project placeholder, an event
   with no company signal, or a large batch of free/busy stubs. Do not write, then ask.
7. **Write idempotently — and ADOPT shims.** Match an existing record in this order:

   1. **by `eventId`** (`npx dt list meetings --filter eventId=<id> --json`) — the normal case, an
      update.
   2. **by same date + start within ±15 MINUTES, when the existing record has NO `eventId`** and its
      `origin` is `recording`, `manual` or `migration`. That is a shim the calendar can now identify:
      give it the real `eventId`, `organizer`, `attendees`, `conferenceUrl`, `htmlLink`, and set
      `origin` to `calendar`. This is **adoption, not creation** — a new record beside a shim
      duplicates a real meeting whose recording and summary already point at it. The window is
      minutes, not exact, because a recording shim's `starts` is when the *recording* began, a few
      minutes after the meeting did.
   3. **by same start, when the existing record's `eventId` is NOT in the live fetch** — take it
      over and write the new id. Google gives a **new `eventId`** to an instance of a weekly series
      that was cancelled and re-created, and the old id then returns `status: cancelled` from
      `gcal.mjs event`. **`eventId` is stable for an event, not for a slot** — check the recorded id
      with a direct `gcal.mjs event` before assuming a record is stale.

   **A `freeBusyReader` `eventId` does not survive the access upgrade.** A stub's id returns **404**
   from `gcal.mjs event` once the account holds the calendar directly, so rule 1 cannot bridge a
   free/busy → full-detail transition. Reconcile a stub with the real meeting in its slot by slot,
   and remove the stub once its body is empty and nothing references it.

   Update a matched record with `npx dt set`; when nothing changed, leave it. Otherwise create it
   with `npx dt add meetings`. **Never downgrade a non-stub record to a `busy-block` stub** (step 3).
   **Updating a record preserves fields other modules own**, such as `recordings` — never drop them —
   and `privacy`, which only a person sets.

   **The invite is the authority on the time, unless the record says otherwise.** A record whose
   `note` says its time was corrected by hand (`time corrected by hand: <why>`) keeps its `starts`,
   `ends` and id: report the invite's time beside it and leave both unchanged. Write that note
   whenever a time is corrected by hand, or the next sync moves it back.
8. **When the invite moves the time, RENAME as well as set** — `HH-MM` is in the id, so a new time
   means a new path. `npx dt rename meetings/<old-id> <new-id>` moves the file and rewrites every
   inbound ref. Skip a record step 7 protects by its `note`. Four things `rename` does not do for you:

   - **It does not update `starts`/`ends`.** `rename` moves the path and the refs and touches no
     fields, so a time correction is always two operations: `rename`, then
     `npx dt set meetings/<new-id> starts=… ends=…`.
   - **Raw prose is not rewritten.** Only `[[wikilinks]]` and real refs are maintained; the verb
     warns about prose occurrences — fix those by hand.
   - **Rename a summary that mirrors the meeting's id too**, when meeting-docs is installed.
   - **A `description` can now be wrong.** One that asserts the old time ("weekly, 11:00") is false
     after the correction. Re-read and replace any text that names what changed.

9. **Stamp the attendees' contacts** with `bin/touch-contacts.mjs`, which ships in this skill and is
   what `/update-contacts-from-meetings` runs. Run it over every meeting this sync created, adopted or
   changed the attendees of:

   ```bash
   node .dreamteamer/skills/fetching-meetings/bin/touch-contacts.mjs meetings/<id> [meetings/<id> …]
   ```

   It sets each attendee's `recent_meeting` and `recent_meeting_date` to their latest meeting that
   has already started and is not cancelled, only ever moving forward, so a future meeting stamps
   nobody and a re-run changes nothing. `--all` backfills from every meeting; `--dry-run` prints the
   changes without writing.
10. **Report** the breakdown by company and list everything excluded or pending confirmation. Name the
   counts: updated / **adopted** / created / excluded, any record left alone by the no-downgrade
   guard or by a hand-corrected time, the configuration bugs from step 2, the `unlisted` calendars,
   and the contacts step 9 moved.

**A sync is a snapshot of one moment, and the calendar keeps moving.** A meeting can be added to the
calendar after the range fetch that should have seen it, including one back-dated to yesterday. So:

- **"Not on the calendar" means "not on the calendar when I looked."** Never conclude an event does
  not exist; say which fetch, at what time, found nothing.
- **When the user says a meeting exists, re-fetch that single date before arguing.** They are
  reading the live calendar; you are reading a snapshot.
- **A shim is meant to be adopted, not deleted.** Re-syncing the date walks step 7's rule 2 and takes
  it over.
- A range query omits cancelled events, so absence from a list proves nothing. Use
  **`--show-deleted`** when a date looks wrong: it reveals cancelled instances of a weekly series
  sitting beside the live ones under different ids, and a direct `gcal.mjs event` returns **404**
  only for an event that never existed.

## Common mistakes

- Assuming a work week — ask which days count, and set `TZ_OVERRIDE` to your zone.
- Kebab-casing a non-English title — slugs are **English**; translate the topic.
- Trusting a calendar's access without checking — run `gcal.mjs access` before fetching. A
  `free-busy` or `absent` row is a wrong `WORK_CALENDARS` row; fix the auth rather than accepting the
  stubs quietly.
- **Passing the wrong `<account>`** — a calendar read by an account that sees it only as
  `freeBusyReader` degrades silently.
- **Scraping the calendar in a browser** for a thin calendar — it produces wrong *times*. Fix the
  auth instead.
- Expecting a `conferenceUrl` on Teams events — take the short `/meet/` link from the description.
- Keeping an all-day admin task (no start time breaks the id) or a declined event.
- Duplicating events that appear on both a personal and a company calendar — dedup by `eventId`.
- Creating duplicate records on re-sync — match an existing `eventId` first.
- **Creating a new meeting beside an `origin: recording` shim** — match by date and time when the
  existing record has no `eventId` and *adopt* it (step 7).
- **Minting a contact for a distribution list or a room** — `all@…`, `no-reply@`, resources.
- **Creating a second self-contact** from one of your other work addresses.
- **Passing a comma inside an array value on the CLI** — `--attendees_raw "a@b (self, organizer)"`
  splits into two entries. Use `(self + organizer)`.
- **Renaming a meeting and leaving its summary or its description behind** — both go stale silently.
- **Moving a hand-corrected time back to the invite's** — a record whose `note` says its time was
  corrected by hand keeps it (step 7).
- **Writing a `# title` body** — the title is `name`; the body is `notes` and starts empty.
