# @dreamteamer/meetings

Your meetings as records, with the invite's attendee list as the Calendar API returns it, the same
people resolved to contacts, and the screenshots taken during a call filed beside it. The anchor the
other meeting modules hang off. A meeting is written by hand, by `/create-meeting`
(`@dreamteamer/meeting-docs`), or by the Google Calendar sync, which ships in
`@dreamteamer/connectors-google-workspace`.

```bash
npm install @dreamteamer/meetings @dreamteamer/contacts @dreamteamer/companies @dreamteamer/users @dreamteamer/assets
npx dreamteamer compile
```

| alone | with others |
|---|---|
| meetings written by hand, each attendee's latest meeting stamped on their contact, screenshots filed per meeting | **`@dreamteamer/connectors-google-workspace`** adds the Google Calendar sync (`/fetch-meetings`) · **recordings** adds the audio and transcript (`meetings.recordings`) · **meeting-docs** adds the prep, the summary and the critique (`meetings.prep`, `.summary`, `.analyses`) and the pipeline that writes them |

| needs | for |
|---|---|
| `@dreamteamer/contacts` | attendees |
| `@dreamteamer/companies` | the company a call is with |
| `@dreamteamer/users` | the people of yours in the room |
| `@dreamteamer/assets` | contacts and companies need it for avatars and logos |
| `INBOX_FOLDERS` and `FILES_FOLDER` declared | filing screenshots only |

## setup

None. Meeting records, screenshots and contact stamps work with nothing set up, and the module asks for
no account and no `.env` key. Its two commands are `/fetch-meeting-screenshots` and
`/update-contacts-from-meetings`; the second runs `npx dreamteamer run @dreamteamer/meetings touch-contacts`.

The Google Calendar sync — `/fetch-meetings`, the `fetching-meetings` skill, `WORK_CALENDARS` and the
`meetings` setup unit (`dt setup meetings …`) — ships in `@dreamteamer/connectors-google-workspace`:

```bash
npx dreamteamer install @dreamteamer/connectors-google-workspace
```

Three people fields, modelled after the source: `attendees` is the Calendar API's attendee list as
objects (`email`, `displayName`, `responseStatus`, `organizer`, `self`, `optional`; rooms dropped),
`attendees_contacts` is those people as `contacts` refs — the list every reader uses — and `ours` is
the subset who are `users`. `organizer` is the API's object too. `attendees` and `organizer` carry
addresses, so they are `sensitive` and never travel in an export. The calendar sync writes the two API
fields with `npx dreamteamer run @dreamteamer/meetings event-people` from the raw event; the refs are a plain `npx dreamteamer set`.

## upgrading from 0.1.1

0.1.1 kept the refs in `attendees` and the API's attendees flattened to strings in `attendees_raw`,
and `organizer` was an address. 0.1.2 deletes `attendees_raw` outright — a record carrying it fails
`dt check` with `unknown field "attendees_raw"` — and ships the migration:

```bash
npx dreamteamer compile                                                   # on the 0.1.2 module
npx dreamteamer run @dreamteamer/meetings migrate-attendees         # the plan, nothing written
npx dreamteamer run @dreamteamer/meetings migrate-attendees --write
npx dreamteamer check
```

It moves the refs to `attendees_contacts`, parses each `attendees_raw` string back into the API
object it was formatted from, turns the organizer address into `{ email }`, and carries any string
with no address (somebody's note about who was in the room, on a meeting with no invite behind it)
verbatim into the meeting's page under one heading, so nothing is dropped and nothing is guessed. A
second run changes nothing. Readers that named `attendees` — `/update-contacts-from-meetings`, the
transcriber's speaker count, meeting-docs' preps and summaries — read `attendees_contacts` from
their matching 0.1.2 releases.

A meeting's `privacy` is `open` or `restricted`. A `restricted` meeting holds a third party's private
material, so the meeting-docs pipeline stops after transcription. An export cannot withhold that one
record: `sensitive` applies to a whole collection or a whole field, never to a record, so an exporter
has to read `privacy` itself, and marking `meetings` sensitive would withhold every meeting.

## 0.4.0 — the Google Calendar sync leaves core (cr-modules-018)

`/fetch-meetings`, the `fetching-meetings` skill (with `gcal.mjs`), the `meetings` setup unit, `SETUP.md`
and `WORK_CALENDARS` moved to `@dreamteamer/connectors-google-workspace`. To keep them:

```bash
npx dreamteamer install @dreamteamer/connectors-google-workspace
```

The setup unit keeps its id, so `dt setup meetings …`, a `dreamteamer.setup.skipped` entry `meetings` and
the receipt under `.dreamteamer/setup/meetings/` work as before once the connector is installed. Without
it, `WORK_CALENDARS` stays in `.env`, unread. The two record-writing scripts stay here and moved to the
module's `bin/`: `.dreamteamer/skills/fetching-meetings/bin/touch-contacts.mjs` is now
`node_modules/@dreamteamer/meetings/bin/touch-contacts.mjs`, and the same for `event-people.mjs`; each
writes the workspace it is run from. No field changes and no record moves; nothing to migrate.

## 0.3.1 — the nav is nav.yaml (cr-dt-008)

`display.nav.order` and `display.nav.section` removed from its descriptor — the nav is `nav.yaml` at the workspace root (engine 0.49), which you arrange; `display.nav.icon` stays. Nothing to do.

## 0.3.0 — on engine 0.48.0: the engine writes `.env` (CR-dt-007)

Nothing to do but `dt update @dreamteamer/meetings` on dreamteamer 0.48.0 or later, then `dt compile`; nothing a
workspace's records do changes. the calendar rows are now an env action: the unit merges them into `WORK_CALENDARS`, the engine writes `.env` and prints which inputs it skipped. **`bin/setup.mjs` is gone** — `dt setup meetings --input calendar="<calendar> | <company> | <account>"` replaces it; SETUP.md says so.

## 0.2.0 — on engine 0.47.0 (CLI-first module lifecycle, CR-dt-006)

Nothing to do but `dt compile` after `dt update @dreamteamer/meetings` on dreamteamer 0.47.0 or later (the engine floor is `>=0.47.0`). New: the `meetings` setup unit: `--input 'calendar=<id> | <company or mixed> | <account>'` (repeatable; a mixed batch merges the valid rows and names the malformed) merges into `.env`; `dt setup meetings --verify --authorize` runs the live check and writes a receipt only when every calendar answers `full`.
