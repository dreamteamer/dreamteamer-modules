---
name: fetching-meetings
description: Use when the user wants to fetch, sync, snapshot, or back up their calendar meetings into data/meetings/ for a week or a date range — e.g. "sync my work meetings this week", "fetch next week's meetings to files", "update data/meetings". Covers which Google Calendars count as work, deduping across calendars, company classification, Hebrew titles, and the data/meetings file convention.
---

# Fetching calendar meetings to data/meetings

Snapshot **work** meetings from Google Calendar into one markdown file per meeting under `data/meetings/`. The markdown vault is the source of truth; this is a manual on-demand snapshot (no live sync). Events may carry **Hebrew (or other non-English) titles** — read the naming rules below before writing files.

## reading the calendar — `bin/gcal.mjs`, direct to the Google API

Calendar reads go through **`.dreamteamer/skills/fetching-meetings/bin/gcal.mjs`**, which
calls the Google Calendar API directly using the credentials `workspace-mcp` stores per account. It
prints **raw JSON**. There is no calendar MCP server any more — `@cocal/google-calendar-mcp` was
removed on 2026-07-30 (decision 104) once one Google server covered everything else.

```
node .dreamteamer/skills/fetching-meetings/bin/gcal.mjs calendars <account>
node .../gcal.mjs events <account> <calendarId> <timeMin> <timeMax> [--show-deleted]
node .../gcal.mjs event  <account> <calendarId> <eventId>       # 404 = never existed
```

`<account>` is an **email** — the 3rd column of the `WORK_CALENDARS` row — and it is **required**;
there is no default and no merge-across-accounts behaviour to guard against any more.

**Why a script and not the `workspace-mcp` calendar tools**, which do exist and are registered:
every one of them returns a human-formatted **string** (`-> str`) and the codebase has **no
structured-output option** — verified across the installed source at 1.22.2. The formatter drops
three fields this skill is built on:

| dropped | what breaks |
|---|---|
| **`status`** (confirmed/**cancelled**/tentative) | never emitted, even for a single event. Step 7's rule 3 and the cancelled-vs-never-existed check (decision 97) both die |
| **`accessRole`** | `list_calendars` emits only summary/primary/id — step 3's degraded-read guard becomes undetectable, which is what produced the browser-scrape era |
| attendee **`resource: true`** | room bookings become contacts instead of being excluded |

Plus no `showDeleted`, no `timeZone`, and `singleEvents: True` hardcoded. So the sync uses the API
directly — **same account, same data, same credentials, different transport**, which is the
substitution this skill has always allowed. Never substitute a different *source*.

**Verified 2026-07-30** across all four `WORK_CALENDARS` rows via two accounts: `status`
(37 confirmed / 5 cancelled on one calendar's month), `accessRole` (`owner`/`writer`/`reader`),
attendee `resource` (**4 rooms — matching the hand count exactly**), `responseStatus`
(incl. 5 declined), `showDeleted`, and `timeZone` all present; a single-event diff matched the
stored record on every field.

### accounts are emails, and one account reads several calendars

- **One OAuth client for every account** — it identifies the *app*, not the person.
- **One credential file per account**, named for the email, under
  `~/.config/google-workspace-mcp/credentials/`. Adding an account touches neither `.mcp.json`
  nor `.env` except for the `WORK_CALENDARS` row that points at it.
- **Add or re-consent an account:** through the `workspace-mcp` server's own auth flow (its
  `start_google_auth` tool, or `gws.mjs auth <email>` from the toolbelt recipe's `using-google-workspace`
  skill). It prints ONE consent URL. ⏱ **The URL dies after 10 minutes** (`store_oauth_state`'s 600s
  default) — a stale click fails with *"Invalid or expired OAuth state parameter"*. Re-run for a fresh
  link rather than waiting.
- **One account often reads several rows.** In the synthetic cast, Dana's personal Google account
  reads the employer's shared calendar at `writer`, the consultancy's at `reader` and her own at `owner`
  — but the employer's OWN domain account sees a colleague's calendar only as **`freeBusyReader`**
  under the personal login, which is exactly why such a calendar needs its own row and its own account.

A Workspace domain (as opposed to a gmail account) can have an admin policy that blocks unverified third-party apps — consent then fails with `admin_policy_enforced` / "access blocked". That is not fixable from this repo: an admin allowlists the OAuth client id.

**Known setup failures, so nobody re-debugs them:**

| symptom | cause | fix |
|---|---|---|
| `Error 403: access_denied` — "*has not completed the Google verification process … currently being tested*" | the OAuth app's publishing status is **Testing** | Google Auth Platform → Audience → **PUBLISH APP**. Then consent shows an "unverified app" warning (expected — it is your own app) instead of blocking. Adding yourself as a Test user also works but **expires refresh tokens every 7 days**, so sync dies weekly looking like a bug |
| `OAuth credentials not found` / `ENOENT … gcp-oauth.keys.json` | the env var is not in the **process** environment — the repo `.env` does not reach a shell or `.mcp.json` | For a manual `npx … auth`, `export` the vars first. **Never use `~` in the value** — it is passed through verbatim and fails to open. ⚠ `.mcp.json` tries to default both paths with `${VAR:-${HOME}/…}`, and **that nesting is undocumented** (Claude Code documents `${VAR:-default}`, with no statement about a `${}` inside the default). It has never actually been exercised through the MCP server, because the auth that works ran via the CLI. If a calendar tool fails on a path containing a literal `${`, this is why — replace it with a plain `${HOME}/…` (decision 83) |
| auth succeeds but every calendar call returns empty | **not** a missing consent-screen scope — an EMPTY Data Access list is normal, because the grant comes from the `scope` parameter the server sends at runtime, and that list is for verification review. Look instead at which account consented and that calendar's `accessRole` | re-auth the account that actually owns the calendar; check `accessRole` per calendar at runtime |
| a `web` top-level key in `gcp-oauth.keys.json` | the client was created as **Web application** | recreate as **Desktop app** — the flow needs a localhost redirect. A correct file has `installed` and `redirect_uris: ["http://localhost"]` |

**If the tools are not available, work out WHICH of two cases it is** — they need opposite responses:

1. **Setup was never done** → say so and **stop**. Do not fall back to another calendar source and do
   not guess at events. ⚠ **The test is the credential file, NOT the existence of `tokens.json`.**
   `tokens.json` belonged to `@cocal/google-calendar-mcp`, deleted 2026-07-30 (decision 104); it does
   not exist on a fully working install, so treating it as the setup marker makes this branch fire
   permanently and reports a healthy vault as unconfigured. Authorization is true iff
   `~/.config/google-workspace-mcp/credentials/<email>.json` exists. Check that, not a stale marker:

   ```bash
   ls ~/.config/google-workspace-mcp/credentials/
   ```

2. **Setup is done but this session didn't load the tools** — e.g. `.mcp.json` changed after the session
   started, which is exactly what happened on the first real sync (2026-07-29). Then calling the Google
   Calendar **API directly with the same credentials** is legitimate: same account, same data, same
   credentials, different transport — that is what `bin/gcal.mjs` does, and it is the preferred path
   for a sync because it returns the raw Calendar v3 JSON. Follow this file's *rules* rather than
   abandoning the sync. Say which transport you used in the report.

The line that matters is **source of truth, not plumbing**: never substitute a different *source*
(a browser scrape standing in for the API, a guess, a memory). Swapping transport over the same
credentials is not that.

**One-time setup**, in order:

1. **One GCP project** + enable the **Google Calendar API**.
2. **OAuth consent screen**, External, publishing status **"In production"** — in Testing, refresh
   tokens die every 7 days and the sync fails weekly looking like a bug.
3. **OAuth client → Desktop app** (not Web — see the failure table), download to
   `~/.config/google-calendar-mcp/gcp-oauth.keys.json` — the same client the Workspace server uses.
4. **Authenticate once per account** — see the accounts block above. Calendar scope must be ticked at
   consent or `gcal.mjs` refuses up front.
5. **`WORK_CALENDARS` in the repo `.env`** — one row per calendar, 3rd column = the account **email**
   that reads it. See "Which calendars count as work".
6. **Verify per calendar, not per account:** run `gcal.mjs calendars <email>` for each account and
   check every `WORK_CALENDARS` id appears at `reader` or better under the account its row names.
   A row pointing at an account that only sees the calendar as `freeBusyReader` is a misconfigured
   row — a work-domain calendar read through a personal login is the usual case, which is exactly
   why such a calendar gets its own row.

> **In a dreamteamer workspace** the `meetings` collection descriptor is the authority on record
> shape and ids — read it before writing (`using-dreamteamer` → `references/records.md`). The file
> convention below matches its id pattern; verbatim attendee strings that aren't `contacts/` refs
> go in `attendees_raw`. Prefer `dreamteamer add meetings` over hand-writing files where practical.

## File convention

```
data/meetings/<YYYY>/<MM>/<YYYY-MM-DD>--<HH-MM>--<company>--<slug>.meeting.md
```
`HH-MM` = start time in `Asia/Jerusalem` (files sort by start within a day) — the same id the
descriptor's `id.generate` derives from `starts`, so `dreamteamer add meetings` and a hand-written
file land on the same path. If date+time+company+slug would collide with an existing *different*
event, append `-2`, `-3`. **`data/meetings/`
holds only `.meeting.md` files** — never a sibling `.transcript.md`/`.summary.md`/`.asr.json`. A
transcript belongs to a `meeting-recordings` record (`transcribing-recordings`), a summary is its
own record in `data/meeting-summaries/`, and raw ASR is a gitignored cache.

Frontmatter is metadata only — no free-text notes/description in the body unless the user asks,
and even then it goes in frontmatter (`description:`), not the body:
```yaml
---
name: "הכנה להכשרה (Prep for training)"    # the field is `name`, NOT `title` — quote if it contains a colon
starts: "2026-06-29T17:00:00+03:00"
ends: "2026-06-29T18:00:00+03:00"
timezone: Asia/Jerusalem
company: <company>
calendar: <you>@<company>.example   # the calendar the event was actually read from
origin: calendar                    # provenance MECHANISM — see the provenance block below
synced: "2026-07-28T19:40:00+03:00" # when this sync wrote the record
status: confirmed
organizer: <organizer>@<company>.example
location: <real room only — e.g. "Floor 8 meeting room + Teams"; omit generic "Microsoft Teams meeting">
conferenceUrl: <Meet/Teams join link if any>
attendees:                          # `contacts/` REFS ONLY — never raw emails here
  - contacts/<organizer-id>
  - contacts/<operator-id>
attendees_raw:                      # the verbatim strings, quoted
  - "<organizer>@<company>.example (organizer)"
  - "<you>@<company>.example (self)"
eventId: 0rrs5m6fep45o9hv1vubjb9aob
htmlLink: <google event link>
description: <optional — any free-text note, e.g. "Manually logged (no calendar sync)" or a
  calendar-view caveat; omit the field entirely when there's nothing to say>
author: agents/dreamteamer (<your model>)
source: calendar:<you>@<company>.example
creation_context: synced from <calendar-id> on <date>
confidence: normal        # `low` + a reason here when the event was a free/busy stub
---

# הכנה להכשרה (Prep for training)
```
Body is just the `# title`. **It is NOT where a transcript goes** — transcripts live on
`meeting-recordings` records since 2026-07-28 (migration M2), and this body is the meeting's
prep brief, written by `/create-meeting`.

### The provenance block — every synced meeting carries it

- **`source: calendar:<calendar-id>`** — the calendar the event was actually *read from*, which is not
  always the calendar it belongs to (a company event mirrored onto Personal is read from whichever won
  the dedup in step 4).
- **`synced:`** — a date-time with the Jerusalem offset, stamped on **every** run including re-syncs.
  That is what makes "which meetings haven't been refreshed since X" a range filter instead of a guess.
- **`origin: calendar`** — always, for anything this skill writes. `recording` is for shim meetings
  inferred from a recording, `manual` for hand-logged, `migration` for records carried over from an older system.
- **`author` / `creation_context` / `confidence`** — the quad. A free/busy stub is `confidence: low`
  with the reason in `creation_context` ("free/busy access only; title and attendees unavailable").

### Attendees become contacts — every one of them, every sync

For each attendee: resolve against `contacts` **by email first, then by name**. When there is no match,
**create a placeholder** — `status: draft`, `name` from the Google `displayName` when present else the
email local-part title-cased, `email`, `company` when the domain maps, and the quad with
`source: calendar:<id>`, `confidence: low`, and the raw attendee string in `creation_context`.

`attendees` holds the `contacts/` refs; `attendees_raw` keeps the verbatim strings, as it does today.

**Three resolution rules that are not "email → contact", learned on the first real sync:**

- **The operator usually has SEVERAL addresses** — one per employer plus a personal one (in the
  synthetic cast: `dana.o@northwind.example`, `dana@bright.example`, `dana.oren@gmail.example`). All
  resolve to **one** `contacts/dana-oren`. Never create a second self-contact from an unfamiliar work
  address.
- **One human, several employers.** `sam.d@bright.example` and `sam.d@northwind.example` are the same
  person → one `contacts/sam-diaz`. A new domain for a known name is a signal to check, not to create.
- **Not every address is a person.** `all@northwind.example` is a distribution list — exclude it rather than
  minting a contact called "All". Same for `no-reply@`, `noreply@`, room/resource addresses (the API
  flags those with `resource: true`) and anything that reads like a group alias.

⚠ **CLI gotcha when writing `attendees_raw`:** array values are **comma-split**, so
`--attendees_raw "dana.o@northwind.example (self, organizer)"` silently becomes **two** entries. Use a
separator that isn't a comma — `(self + organizer)` — or write the file directly.

**Do not scrape here.** Enrichment costs money per run and is `/scrape-contact`'s job — a `draft`
contact shows that command as *available*, which is the queue. Creating placeholders is the whole
contribution of this step.

### Titles & slugs (read carefully — Hebrew is common)
- **`name:`** = the cleaned event summary. First **strip cruft**: `FW:`/`RE:` prefixes, trailing punctuation, and forwarded `-----Original Appointment-----` boilerplate. For a **non-English (Hebrew) title**, write `<original> (English gloss)` — original script first, short English translation in parentheses. **Quote** the YAML value when it contains a colon or other YAML-special char.
- **`slug`** = always **English**, lowercase, kebab-case, ~2–4 words, derived from the *topic*:
  - Translate/transliterate Hebrew → a short English topic slug, leading with the key noun (`הכנה להכשרה` → `prep-for-training`). When two meetings share vocabulary, pick distinct lead nouns so the slugs don't collide.
  - Drop qualifiers and separators: `Tentative`, parentheticals, `/`, `&`, `()`. Use the **topic** when names are incidental (`Alice/Bob - Workshop Slides` → `workshop-slides`); keep the **names** only when the title is essentially just names (`Alice & Bob & Carol & Dan` → `alice-bob-carol-dan`).
  - free/busy stub → `busy-block`.

### Conference link & location
- **Google Meet** events: use the `conferenceUrl` field directly.
- **Microsoft Teams** events: Google returns **no** `conferenceUrl` — extract the short `https://teams.microsoft.com/meet/...` link from the `description`, **keeping its full `?p=<passcode>` query string** (ignore the long `/l/meetup-join/...` URL and the dial-in number). Put the real room in `location` (gloss Hebrew room names to English); drop the generic `פגישה של Microsoft Teams` / "Microsoft Teams meeting" placeholder.

### Times & timezone
Fetch with `gcal.mjs events`, which already sends `timeZone=Asia/Jerusalem` so the response is Jerusalem-local. `starts`/`ends`/`HH-MM` are the event's start/end **converted to Asia/Jerusalem** wall-clock. If an event's source `timeZone` differs (e.g. `Europe/Sofia`, a US zone), still normalize to Jerusalem.

`starts`/`ends` are **one `date-time` each**, carrying the Jerusalem offset — `+03:00` in summer,
`+02:00` in winter (Israel switches on the last Friday in March and the last Sunday in October).
Google returns exactly this shape in `start.dateTime`, so pass it through rather than reassembling
it. Writing the wall clock alone (`2026-06-29T17:00`) is also accepted — `dreamteamer add meetings`
stamps the local offset on during validation — but only do that on a machine set to Jerusalem time.
Keep `timezone:` too: the offset says `+03:00`, only the zone name says which zone that was.

This replaced the older `date` + `start:` + `end:` string trio (migrated 2026-07-28). Those three
could not be sorted or range-filtered without being reassembled by hand; one date-time can:
`dreamteamer list meetings --sort -starts`, or
`--where '{"starts":{"_gte":"2026-07-01"}}'`.

## Which calendars count as "work"

The work calendars, their default company and the account that reads each one are **not hardcoded
here** — read them from the `WORK_CALENDARS` block in the repo-root `.env` (columns: `calendar-id |
default-company | account-email`). Each row is one calendar to snapshot; the third column is the
account **email** to pass as `<account>` when fetching it. Add or remove
calendars by editing `.env`, never this file — the skill ships free of personal accounts so it can
be extracted to a public plugin. Run `gcal.mjs calendars <account>` to verify access and surface any work-looking
calendar that isn't yet in `WORK_CALENDARS` (tell the user to add it rather than syncing it silently).

**Access is per-calendar-per-account, and it decides detail** — check each response's `accessRole`: a `freeBusyReader` calendar returns events with **no `summary`/`attendees`** → write a free/busy **stub**. `owner`/`writer`/`reader` give full details. Note: a `visibility: private` event on a full-access calendar still returns full detail — write it in full; **only `freeBusyReader` access forces a stub**.

**A `freeBusyReader` result is a CONFIGURATION BUG, not a fact to work around.** Every row should be read by an account that holds its calendar directly, so free/busy should never appear. If it does, the row names the wrong account or that account's grant lapsed → **authenticate the owning account** (`gws.mjs auth <email>`) and fix the row. Do not scrape, and do not silently accept stubs: say which calendar degraded and why. Stub-writing stays specified below because a *newly added* calendar can legitimately be free/busy before its account is authenticated.

A **stub** keeps only the fields that exist: `name: Busy (private)` (filename slug `busy-block`), plus `starts`, `ends`, `timezone`, `company`, `calendar`, `origin: calendar`, `synced`, `status`, `visibility: private`, `eventId`, `htmlLink`, and the quad with `confidence: low` — no `organizer`/`attendees`/`conferenceUrl`/`location`. Body: one line noting free/busy access only. The start time in the filename disambiguates multiple stubs on one day. Stubs are **included by default**, but when a range yields many (e.g. a whole month of them) confirm with the user before writing.

**Ignore (never work):** any calendar the server returns that is **not in `WORK_CALENDARS`** — holiday feeds, music/event feeds, and family/shared calendars. Only `WORK_CALENDARS` rows are synced.

## Company classification

Classify by attendee email **domain**, not by which calendar the event sits on:
- Map the attendee email **domain** to a company: a domain matching a `WORK_CALENDARS` row uses that row's `default-company`; an external **client** domain not in the registry classifies to that client by name (normalize obvious typos to the canonical spelling).
- A **consultancy** calendar (one whose `default-company` does client work) follows the client: an all-internal meeting → the consultancy's own company; a meeting that includes a **client** domain → the client.
- **No external domain** (internal / self-only event): classify by the **title/subject** keywords instead. Normalize to the canonical company spelling (fix obvious typos).
- Attendee domain decides company **regardless of time of day** — an evening or late-night meeting with a work domain (e.g. a company domain at 21:00) is still that company's work meeting, not a personal one.

## Exclusions (apply to every calendar, not just Personal)

- **Declined** events (self `responseStatus: declined`) — skip. Tentative / `needsAction` are kept.
- **All-day** events and recurring **admin/accounting/"tasks"** items (e.g. "Bi Monthly Accounting Tasks") — skip. (They also have no start time, so they can't fit the filename.)
- **Personal-life** items even when on a work calendar — a gym class, family, errands.
- **Ambiguous** side-project / "team" placeholders — **ask** before including.

Match these keywords against the **translated/English meaning** of the title when it is not in English — a Hebrew "placeholder … team" is a team placeholder → ask; a Hebrew "breathing" is a gym class → skip.

## Steps

1. **Resolve the date range.** The Israeli work week is **Sun–Thu**, timezone `Asia/Jerusalem`. For "this/next week" query the whole **Sun 00:00 → following Sun 00:00** (exclusive buffer) and keep Sun–Thu. Confirm today's weekday with `date "+%Y-%m-%d %A"`.
2. **Fetch** each work calendar with `gcal.mjs events` — account email, calendar id, the range,
   `timeZone="Asia/Jerusalem"`, ordered by start time, and **`account` = the row's 3rd column**. One
   call per row, never one merged call: the merge across accounts loses which calendar an event came
   from, and `source:`/`calendar:` depend on it.
3. **Guard against a degraded read — never write over good data with worse data.** Check each
   response's `accessRole` (see "Which calendars count as work"). A `freeBusyReader` result means the
   row's account does not hold that calendar → **report it as a configuration bug and name the fix**
   (re-authenticate the owning account, then correct the row). Then, whatever the reason a fetch came back thin:

   **Never downgrade an existing record.** If a meeting file already exists with a real `name` (not
   `name: Busy (private)`) and this run would write a `busy-block` stub over it, **leave the existing
   file untouched**. Same for a fetch that fails outright — a missing calendar is a gap in this run's
   coverage, not a licence to delete or blank records it could not see. Report every record the guard
   protected.

   ⚠ **Historical note — do not reintroduce the browser scrape.** Until 2026-07-30 this step ran a
   Playwright scrape of the Google Calendar agenda view (`lib/resolve-blocked.mjs`) to recover titles
   for the one calendar stuck on free/busy. It **produced wrong times, not merely incomplete ones**:
   the first API-backed sync corrected a weekly recorded as 11:00–12:00 that was actually 10:45–11:30,
   and a 1:1 recorded at 16:45 that was actually 17:15 — and a wrong time propagates into filenames,
   prep briefs and tasks that quote it. It was deleted once every account was authenticated directly
   (decision 96). If a calendar is thin, **fix the auth**; a stub is honestly empty, a scraped time is
   confidently wrong. Any meeting record still carrying browser-derived times is **suspect until
   re-synced** — see "Correcting browser-era records" below.

4. **Dedup by `eventId`** across calendars — company events are often mirrored onto Personal. Keep one copy; prefer the company calendar as the `calendar:` source. For a Personal-**only** work event, `calendar:` is the personal calendar id (the `WORK_CALENDARS` row whose company is `mixed`/personal). Never dedup by time (distinct events can share a start).
5. **Classify & filter** — company per the rules above; drop everything in Exclusions.
6. **Confirm scope BEFORE writing** when anything is ambiguous — a side-project placeholder, an event with no company signal, or a large batch of free/busy stubs. Don't write, then ask.
7. **Write idempotently — and ADOPT shims.** Match an existing record in this order:

   1. **by `eventId`** — the normal case, an update.
   2. **by same date + start within ±15 MINUTES, when the existing record has NO `eventId`** and its
      `origin` is `recording`/`manual`/`migration`. That is a shim the calendar can now identify:
      give it the real `eventId`, `organizer`, `attendees`, `conferenceUrl`, `htmlLink`, and flip
      `origin` to `calendar`. This is **adoption, not creation** — creating a new record beside a shim
      duplicates a real meeting whose recording and summary already point at it. **Never adopt across a
      `recordings:` ref you would orphan**; re-writing preserves those refs.
      ⚠ **The window must be minutes, not exact.** A recording shim's `starts` is when the *recording*
      began, which is a few minutes after the meeting did — `16:04` vs a `16:00` calendar start, `16:33`
      vs `16:30`, both real (2026-07-30). An exact wall-clock match misses them and silently creates
      duplicates.
   3. **by same start, when the existing record's `eventId` is NOT in the live fetch** — take it over
      and write the new id. Google gives a **new `eventId`** to a recurring instance that was cancelled
      and re-created: on 2026-07-30 the records for the 07-26 and 07-29 `[WEEKLY]` instances held ids that
      `gcal.mjs event` returns as `status: cancelled`, while live events sat at the same or a nearby time
      under different ids. Without this rule the sync writes a second record for a meeting it already
      has. **`eventId` is stable for an event, NOT for a slot** — verify with a direct `gcal.mjs event` on
      the recorded id before assuming a record is stale.

   ⚠ **A `freeBusyReader` `eventId` does not survive the access upgrade.** Both `busy-block` stubs
   written under free/busy access returned **404** from `gcal.mjs event` once the account held the calendar
   directly — the ids were free/busy artifacts, not real event ids. So rule 1 cannot bridge a
   free/busy → full-detail transition, and a stub will look like a *different* meeting from the real one
   occupying its slot. Reconcile those by slot and delete the stub (4 were deleted on 2026-07-30 after
   confirming empty bodies and zero inbound refs) rather than trusting the id.

   Then: `grep -rl "^eventId: <id>$" data/meetings`. If found, delete it and rewrite (time/title/slug may have changed → the path can move); if the new content equals the old, leave it. Otherwise create the file. **Exception: never downgrade a non-stub file to a `busy-block` stub.** If the existing file has a real name (not `name: Busy (private)`) and this run would write a stub (a degraded read — see step 3), leave the existing file untouched. **Re-writing a file preserves its `recordings:` refs** — dropping them would break the symmetric-ref invariant and `check` will say so.
8. **When a correction moves the time, RENAME rather than rewrite** — `HH-MM` is in the id, so a
   corrected time means a new path. Use `dreamteamer rename meetings/<old-id> <new-id>`: it moves the
   file and rewrites every inbound ref in one commit (11 refs across 11 files, in the worst real case).
   Four things it will not do for you:

   - ⚠ **It does NOT update `starts`/`ends`.** `rename` moves the path and the refs and touches **no
     fields** — so a renamed record's id says `16-00` while `starts` still says the old time, and every
     `--sort starts` / `--where starts` query reads the stale value. **A time correction is always TWO
     operations**: `rename`, then `set <id> starts=… ends=…`. Verified the hard way on 2026-07-30, twice.
   - **Raw prose is not rewritten.** Only `[[wikilinks]]` and real refs are maintained (decision 7). The
     verb *warns* about prose occurrences — fix those by hand; there were 3 in a task body.
   - **Rename the mirroring summary too**, so `data/meeting-summaries/` keeps matching ids.
   - **Descriptions can now be lying.** A record whose `description` asserts the old time ("weekly, 11:00")
     is false after the correction. Re-read and replace any description that references what changed.

9. **Report** the breakdown by company and list everything excluded or pending confirmation. Name the
   counts that matter: updated / **adopted** / created / excluded, and any record left alone by the
   no-downgrade guard.

⚠ **A sync is a snapshot of one moment, and the calendar keeps moving.** On 2026-07-30 a `Sam / Dana`
meeting for the previous day was `created: 2026-07-30T07:23:43Z` — *after* that morning's range fetch.
The sync correctly saw nothing, `/match-recording-to-meeting` correctly fell through to a shim, and a
re-fetch of the single date hours later found the real event. So:

- **"Not on the calendar" means "not on the calendar when I looked."** Never conclude an event does not
  exist; say which fetch, at what time, found nothing. Back-dated and retroactively-added meetings are
  normal.
- **When the operator says a meeting exists, re-fetch that single date before arguing.** They are reading
  the live calendar; you are reading a snapshot.
- **A shim created this way is meant to be adopted, not deleted.** Re-syncing the date walks step 7's
  rule 2 and takes it over — which is why the shim carries `origin: recording` and the recording's ref
  survives the rename.
- Use **`--show-deleted`** when a date looks wrong: it reveals cancelled instances sitting beside live
  ones (on that same date, a cancelled 14:00 `[WEEKLY]` sat next to the confirmed one under a different id).

## Correcting browser-era records (a finite, known backlog)

Records written while a calendar was free/busy carry
`description: … resolved from the calendar agenda view (browser) …`. **Their times are suspect** — but
one pass over 20 such records (2026-07-30) showed the damage is **narrower and differently shaped**
than a filename-level diff suggests, so measure before you claim:

- **Only 2 of 20 times were actually wrong**, and one of those was a meeting that *moved* rather than a
  scrape error. A recurring meeting whose instances sit at different times per week looks like a scrape
  error and is not one. **Diff against `gcal.mjs event`, never against the pattern of neighbouring records.**
- **Nothing was invented.** The one record that looked fabricated (`2026-07-27--13-00--harbor-mutual-workplan`,
  absent from a range fetch) is a **real** event with `status: cancelled` — a range query omits cancelled
  events, so absence from a list proves nothing. Only a direct `gcal.mjs event` on the recorded id
  distinguishes *cancelled* from *never existed*, and it returns **404** for the latter.
- **The stubs were the real duplicates.** Free/busy `busy-block` records carry ids that 404 after the
  access upgrade, so they cannot be matched by id to the real meeting sitting in their slot.

Find them:

```
grep -rl "agenda view (browser)" data/meetings      # browser-derived, times suspect
grep -rl "^name: Busy (private)" data/meetings      # stubs the scrape never resolved
```

Re-syncing the range is what corrects them, with three things to watch that a plain re-sync does not
handle by itself:

- **A corrected time is a RENAME, not a rewrite** — `HH-MM` is in the id. Use `dreamteamer meetings
  rename` and follow step 8 (prose refs, the mirroring summary, and any `description` that asserts the
  old time).
- **A phantom + a stub for the same real meeting must MERGE, not coexist.** The stub usually holds the
  right `eventId` and time; the phantom holds the right title and any `recordings:`/summary refs. Keep
  one record — the correct time — and carry the refs across, or a recording ends up pointing at a
  meeting that never happened.
- **An event the scrape invented has no API counterpart at all.** Confirm against a fetch of that exact
  date before deleting: absent from the API and browser-derived is a phantom; absent from the API and
  `origin: recording` is a shim to adopt (step 7), not a deletion.

Once a record is re-synced from the API, **drop the browser caveat from its `description`** — leaving it
in place keeps a corrected record looking suspect forever.

## Common mistakes

- Using a Mon–Sun week — it's **Sun–Thu, `Asia/Jerusalem`**.
- Kebab-casing a Hebrew title — slugs are **English**; translate the topic.
- Trusting the calendar table for access — check `accessRole` at runtime with `gcal.mjs calendars`, per account. A `freeBusyReader` result is a wrong `WORK_CALENDARS` row, not a fact; fix the auth, don't accept the stubs quietly.
- **Passing the wrong `<account>`** — a calendar read by an account that only sees it as `freeBusyReader` degrades silently. `<account>` is required, so there is no merge hazard any more.
- **Reintroducing a browser scrape** for a thin calendar — it produced wrong *times* twice (see step 3). Fix the auth instead.
- **Trusting a browser-era record's time** — anything synced before 2026-07-30 on a then-free/busy calendar is suspect until re-synced.
- Expecting a `conferenceUrl` on Teams events — scrape the short `/meet/` link from the description.
- Keeping an all-day admin task (no start time breaks the filename) or a declined event.
- Duplicating events that appear on both Personal and a company calendar — dedup by `eventId`.
- Creating duplicate files on re-sync — match an existing `eventId` first.
- **Creating a new meeting beside an `origin: recording` shim** — match by date+time when the existing
  record has no `eventId` and *adopt* it (step 7), or you duplicate a meeting whose recording and
  summary already point at the shim.
- **Minting a contact for a distribution list or a room** — `all@…`, `no-reply@`, resources.
- **Creating a second self-contact** from one of the operator's other work addresses.
- **Passing a comma inside an array value on the CLI** — `--attendees_raw "a@b (self, organizer)"`
  splits into two entries. Use `(self + organizer)`.
- **Renaming a meeting and leaving its summary or its description behind** — both go stale silently.
