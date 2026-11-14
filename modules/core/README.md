# @dreamteamer/core

Every core noun of a workspace from one install line: people with the teams they form and the
roles and responsibilities they hold, companies, contacts and engagements, tasks, projects with their
decisions and risks, meetings with recordings, preps, summaries and analyses, files on mounted drives,
the assets a view draws, the artifacts a person opens, sessions of work and the metrics that count them,
and the workflows that run chains of those commands over sets of records.

```bash
dt install @dreamteamer/core
```

## a module preset

From 0.12.0 core is a **module preset**: its manifest's `dreamteamer.preset` maps seventeen small
modules to exact versions, and ships nothing else but this README, UPDATING.md and the nav fragment
`nav.yaml`. `dt install @dreamteamer/core` (dreamteamer 0.49.0 or later) installs every member at the
version the preset names, pins each one and core itself in `package.json`, and compiles; `dt update
@dreamteamer/core` moves every installed member to the new preset's pins together. npm alone does not
expand a preset — `npm install @dreamteamer/core` installs a package with no collections; use `dt
install`.

Each member is an ordinary package with its own README and UPDATING: read those for the reasoning behind
each noun, its commands and its setup. A member is yours to remove (`npm uninstall
@dreamteamer/metrics`, then `dt compile`): compile warns that the preset names it, `dt status` lists it as
`not installed — dt install @dreamteamer/metrics`, and `dt update @dreamteamer/core` never puts it back. A
member moved on its own (`dt update @dreamteamer/tasks@<version>`) is allowed; `dt status` says which
version the preset names.

| member | what it keeps | setup |
|---|---|---|
| `@dreamteamer/assets` | `assets` — the pictures a view draws | none |
| `@dreamteamer/users` | `users` (with `manager` and `reports`) and `teams` | none |
| `@dreamteamer/companies` | `companies` | none |
| `@dreamteamer/contacts` | `contacts`, enriched from LinkedIn | `LINKEDIN_USER_AGENT` |
| `@dreamteamer/engagements` | `engagements` — one per company sold to or worked for | none |
| `@dreamteamer/tasks` | `tasks` | none |
| `@dreamteamer/projects` | `projects`, `decisions`, `deliverables`, `risks` | none |
| `@dreamteamer/meetings` | `meetings`, synced from Google Calendar | unit `meetings` (`WORK_CALENDARS`) |
| `@dreamteamer/recordings` | `meeting-recordings`, transcribed offline | unit `recordings` (`TRANSCRIPTION_HOME`, `FILES_FOLDER`, `INBOX_FOLDERS`) |
| `@dreamteamer/meeting-docs` | `meeting-preps`, `meeting-summaries`, `meeting-analyses` | none |
| `@dreamteamer/files` | `files` and `file-drives` | unit `files` (`FILES_FOLDER`) |
| `@dreamteamer/workflows` | `workflows`; ships `customer-factory` (`npx dt-workflows install`) | none |
| `@dreamteamer/sessions` | `sessions`, `dt session bind · end · send`, the workers row of `agents` | `SESSIONS_FOLDER` (optional) |
| `@dreamteamer/metrics` | `metrics` | none |
| `@dreamteamer/roles` | `roles`, and `roles` on `users` | none |
| `@dreamteamer/responsibilities` | `responsibilities`, and `responsibilities` on `users` | none |
| `@dreamteamer/artifacts` | `artifacts` — a built page someone opens | none |

`dt status` shows one line per member's setup unit; `dt setup <unit>` resumes, repairs or verifies one.

## the nav

`nav.yaml` here is core's nav fragment: on install the engine places each member's collection into the
workspace's own `nav.yaml` — folders Work, People, CRM, Meetings, Library and Activity — but only a
collection the workspace's file does not name yet. After that the file is yours: drag rows in the
editor or `dt web`, or edit it by hand.

## 0.12.0 — core is a module preset (CR-dt-008)

The 127 composed copies, `compose.json`, the extension, the scripts and `SETUP.md` left core: every
collection, skill, command and script now comes from the member that authors it, at the same storage path
and with the same ids, so no record moves. UPDATING.md has the four steps.

## 0.10.0 — on engine 0.47.0 (CLI-first module lifecycle, CR-dt-006)

Nothing to do but `dt compile` after `dt update @dreamteamer/core` on dreamteamer 0.47.0 or later (the engine floor is `>=0.47.0`). New: every composed module's setup unit, driven by the engine (`dt status`, `dt setup <unit>`); `provides` lists the modules it composes (installing one of them beside core is refused, both ways).
