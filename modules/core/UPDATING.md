# Updating @dreamteamer/core

One section per release, newest first. Each says what you have to **do** in a workspace that
installs this module. From 0.12.0 core is a module preset, so an update is the engine's verb, which
moves every installed member with it:

```bash
npx dreamteamer update @dreamteamer/core
npx dreamteamer check
```

---

## 0.12.0 — core is a module preset of seventeen small modules (CR-dt-008) — engine 0.49.0

core ships no collections, skills, commands, scripts or extension any more: its manifest's
`dreamteamer.preset` names seventeen small modules at exact versions — assets, users, companies,
contacts, engagements, tasks, projects, meetings, recordings, meeting-docs, files, workflows, and five that
were core's own until now: **sessions, metrics, roles, responsibilities and artifacts**. `dt update
@dreamteamer/core` installs each member and pins it; ownership of every collection moves from `core` to
the member that authors it, at the same storage path with the same ids, so **no record moves**. `manager`
and `reports` on `users` now come from `@dreamteamer/users` itself (0.3.0).

Do these, in this order, from the workspace root:

```bash
npx -p @dreamteamer/protocol@0.2 dt-nav migrate   # only when .vscode/settings.json sets dreamteamer.navGroups, navOrder or navHidden
npx dreamteamer update --engine                   # dreamteamer 0.49.0 or later
npx dreamteamer update @dreamteamer/core          # the preset: installs the seventeen members
npx dreamteamer update @dreamteamer/rnd           # when you have rnd: 0.11.0 stands alone of core
npx dreamteamer check
```

The first step saves the nav you have today into `nav.yaml` before the update changes which module owns
each collection; `dt update @dreamteamer/core` refuses while those settings are set and `nav.yaml` is
absent, naming that command. Without nav settings the nav redraws from core's fragment (folders Work,
People, CRM, Meetings, Library, Activity); with a `nav.yaml` nothing you placed moves.

**The `Stop` hook.** A hook that runs core's copy of the session reader now names the sessions package:

```json
"command": "node node_modules/@dreamteamer/sessions/bin/session-save.mjs --write --hook --quiet"
```

**The scripts** moved with their modules: `dt-sessions-migrate` is `@dreamteamer/sessions`'s,
`dt-migrate-lanes-to-tags` is `@dreamteamer/tasks`'s, `dt-workflows` is `@dreamteamer/workflows`'s. Core
0.12 ships no `bin/` folder, so every path under `node_modules/@dreamteamer/core/bin/` stops resolving —
most file names change too:

| core 0.11 (`node_modules/@dreamteamer/core/bin/…`) | from 0.12.0 |
|---|---|
| `projects-check-records.mjs` | `node_modules/@dreamteamer/projects/bin/check-records.mjs` |
| `users-check-records.mjs` | `node_modules/@dreamteamer/users/bin/check-records.mjs` |
| `meetings-migrate-attendees.mjs` | `node_modules/@dreamteamer/meetings/bin/migrate-attendees.mjs` |
| `recordings-transcribe.mjs` | `node_modules/@dreamteamer/recordings/bin/transcribe.mjs` |
| `tasks-migrate-lanes-to-tags.mjs` | `node_modules/@dreamteamer/tasks/bin/migrate-lanes-to-tags.mjs` |
| `workflows-install.mjs` | `node_modules/@dreamteamer/workflows/bin/install.mjs` |
| `session-save.mjs` | `node_modules/@dreamteamer/sessions/bin/session-save.mjs` |
| `sessions-migrate.mjs` | `node_modules/@dreamteamer/sessions/bin/sessions-migrate.mjs` |

The two that bite are the record checks a workspace's `npm run check` chains after `dreamteamer check`
(core's README gave that line): left alone, `npm run check` dies with `MODULE_NOT_FOUND` after `dt check`
itself passed. In `package.json`, replace

```json
"check": "dreamteamer check && node node_modules/@dreamteamer/core/bin/projects-check-records.mjs && node node_modules/@dreamteamer/core/bin/users-check-records.mjs"
```

with

```json
"check": "dreamteamer check && node node_modules/@dreamteamer/projects/bin/check-records.mjs && node node_modules/@dreamteamer/users/bin/check-records.mjs"
```

keeping anything your line chains after them.

**Env keys and variables** are declared by the member that reads them, no longer by core — nothing to
change in `.env`: `LINKEDIN_USER_AGENT` (contacts), `WORK_CALENDARS` (meetings), `TRANSCRIPTION_HOME`,
`FILES_FOLDER` and `INBOX_FOLDERS` (recordings), `FILES_FOLDER` (files), `SESSIONS_FOLDER` (sessions).

`npm install @dreamteamer/core` on its own installs a package with no collections: a preset is expanded
by `dt install` and `dt update`, never by npm.

## 0.11.0 — on engine 0.48.0: the engine writes `.env` (CR-dt-007)

Nothing to do but `dt update @dreamteamer/core` on dreamteamer 0.48.0 or later, then `dt compile`; nothing a
workspace's records do changes. The composed meetings, recordings and files units name their `.env` keys as
env actions and the engine writes them. **`bin/meetings-setup.mjs` is gone** — `dt setup meetings --input
calendar="<calendar> | <company> | <account>"` replaces it, and the root SETUP.md says so. `@dreamteamer/setup`
is deprecated: `dt status`, `dt doctor` and `dt setup` are the engine's. Also composed in: recordings' fixes for
hub-cache snapshot weights and a multi-line `INBOX_FOLDERS`.

## 0.10.0 — the CLI-first module lifecycle (CR-dt-006)

Nothing to do but `dt update @dreamteamer/core` on dreamteamer 0.47.0 or later, then `dt compile`. What
changes is how core's modules are SET UP: each composed module's setup unit is driven by the engine —
`dt status` shows one honest line per unit, `dt setup <unit>` resumes, repairs, verifies or signs in,
and `dt install` records the inputs you give in `.env`. core declares `provides` for the modules it
composes, so installing one of them beside core is refused with the reason. `@dreamteamer/setup`'s
board is gone; `dt-setup` is a one-release shim onto `dt status` and `dt setup`.

## 0.9.1 — compact task navigation by default

Run `dt compile`, then `dt check`. Task records, IDs, fields and all lifecycle values are unchanged.

- Board and List show `suggested`, `todo`, `doing` and `blocked`, including creation dates.
- Other built-in task views are hidden from navigation but retain their routes. Done and closed tasks remain in collection history.
- Existing workspace-specific display overrides may still apply. Compare before removing only redundant presentation overrides; do not rewrite or delete task records.

## 0.9.0 — sessions are plain records; session-bindings is gone (breaking)

**Engine floor 0.42.0** — a record's sessions are said by `dt next` through the `next` contribution.

- **`sessions` records live in `data/sessions/`**, committed like any other record. `SESSIONS_FOLDER`
  names only where transcript copies go (`transcript: ${env:SESSIONS_FOLDER}/<yyyy>/<mm>/<id>.jsonl`);
  unset, every record verb works. The fields `status`, `binding` and `heartbeat` are gone; the list
  shows `records`.
- **`dt session bind <ref>…`** (and `/session:bind`) adds records of any collection to the current
  session, writing it when absent, in the workspace the session runs in (never a `git_modules/` layer).
  Again changes nothing; another session on the same record is named in one line, never refused.
- **`dt next <ref>`** lists the sessions that bound the record, read when asked.
- **`dt session end`** stamps `ended` once; **`dt session send <session> <text>`** asks a past session
  through a fork with no tools, no MCP servers and no hooks.
- **Removed:** the `session-bindings` collection and its validation, `dt session start`, `dt sessions`,
  the claim, the stale sweep, the orientation paragraph and the contributed `Stop` hook. A
  `session-bindings/` folder still shipped by a layer or a package compiles with one
  `session-bindings/<file>: retired in core 0.9.0, ignored` line, exit 0. `dt session heartbeat [--hook]`
  stays through 0.9.x as a silent exit-0 no-op, so 0.8.0's Stop entry never blocks a stop.

What to do:

```bash
npm install @dreamteamer/core@0.9.0 dreamteamer@'>=0.42.0'
node node_modules/@dreamteamer/core/bin/sessions-migrate.mjs           # the plan, nothing written
node node_modules/@dreamteamer/core/bin/sessions-migrate.mjs --write   # apply it
npx dreamteamer compile && npx dreamteamer check
npx dreamteamer commit sessions/<id> …                                # the moved records, by id
```

The migration moves each session under `SESSIONS_FOLDER` whose transcript was recorded in this
workspace (or whose `repo` path is inside it) to `data/sessions/`, keeping its id, and lists the rest as
`left` — a machine folder may be shared by two workspaces; `--take <id>` moves one explicitly. It moves
`${env:FILES_FOLDER}/sessions/` transcripts under `SESSIONS_FOLDER` and rewrites the field, drops the
three removed fields, deletes the workspace's own `session-bindings/` sources, and removes 0.8.0's
`session heartbeat --hook` Stop entry from `.claude/settings.json`. It stages nothing: the moved
records become visible to everyone who reads the workspace, so commit them yourself. A second run
prints zeros.

## 0.8.0 — live sessions: a session starts on a record, claims it, and other agents see it

**From 0.5.4, the last published core, read 0.6.0 below first**: it renames the transcriber's
variables, and a workspace that set them has to change its `.env`. For 0.8.0 itself there is nothing to
do but compile. To use it, bind a collection and merge the hook:

- **`sessions` gains five fields** — `status` (`running` · `ended` · `abandoned`), `records`,
  `binding`, `host`, `heartbeat` — all optional, so every existing session record checks as before
  (one written by `/session:save` has no `status` and is not live). The list shows `status`.
- **A new source kind and collection, `session-bindings`.** A module writes
  `session-bindings/<id>.session-binding.yaml`; compile refuses a bad one naming the file. Nothing
  binds a collection until a module does — the rnd lifecycle's bindings come with `@dreamteamer/rnd` 0.6.0.
- **New verbs**: `dt session start | end | heartbeat`, `dt sessions open`. A workspace module or an
  extension that already contributes a verb named `session` or `sessions` now collides with core and
  is refused at load, naming both — rename yours or disable one.
- **A session is ended by its own holder.** `dt session end` and `dt session heartbeat <id>` act only
  on a session whose harness session id is the caller's (`$CLAUDE_CODE_SESSION_ID` / `--session-id`) or,
  where none was stored, whose worker is the caller's `--agent`; `--force` is a person's way to free
  a stuck claim. A finished stage — the session's binding no longer opens its record — is named in
  `dt next` and does not block the next stage's start.
- **The Stop hook.** `dt install --print-adapters` now prints `Stop: … session heartbeat --hook`
  beside the engine's `SessionStart`; merge it into `.claude/settings.json` (it sits beside the
  `session-save.mjs` Stop hook if you have one). Another extension hooking `Stop` collides and is
  refused, naming both.
- **The extension entry is `src/entry.js`** (it activates the files entry, `src/extension.js`, beside
  the sessions code). Nothing to do unless you imported core's entry by path.
- **`dt next <ref>` says "in session by …"** only on an engine with the `next` extension contribution
  (engine 0.42.0 or later); on 0.39–0.41 that line is absent and nothing else changes.

## 0.7.0 — teams comes from users (users 0.2.0, projects 0.4.0)

Nothing to do but compile. `teams` moved from `@dreamteamer/projects` to `@dreamteamer/users` in
the small modules, and core composes both, so a workspace on core has the same collections, the same
`teams` fields in the same order, and the same mirrors (`users.teams`, `users.led_teams`,
`teams.projects`). Your team records check exactly as they did.

What changed is provenance: `compose.json` lists the base descriptor at
`collections/users/teams.collection.yaml` (from `users`), and `collections/projects/teams.collection.yaml`
is now an overlay carrying only `teams.projects`. The manifest's description reads `users` with
`teams`, `roles` and `responsibilities`, and `projects` with `decisions` and `risks`; a harness file
your compile writes from it (the orientation block in `CLAUDE.md`, `AGENTS.md`) changes by that line.

**An overlay of yours.** An overlay of `teams` is a descriptor with `name: teams` and `overlay: true`
(compile refuses an `extends:` key); it adds to whichever installed module owns `teams` — core, then;
`@dreamteamer/users` from core 0.12.0.

## 0.6.0 — the transcriber keeps everything in one folder, `$TRANSCRIPTION_HOME` (recordings 0.3.0) — breaking

0.6.0 was never published on its own: a workspace upgrading from 0.5.4 gets it with 0.8.0. **Change
your `.env` if it sets any transcriber variable.** The three variables and three sibling folders
become one optional variable and one folder, with no migration path:

| was (0.5.4) | is (0.6.0 and later) |
|---|---|
| `TRANSCRIBING_MODELS_DIR` → `~/.cache/dreamteamer/transcription-models` | `$TRANSCRIPTION_HOME/models/` (`diarization/`, `whisper-ct2/`, `whisper-ggml/`) |
| `TRANSCRIBING_VENV_DIR` → `~/.cache/dreamteamer/transcription-venv` | `$TRANSCRIPTION_HOME/venv/` |
| `TRANSCRIBING_CACHE_DIR` → `~/.cache/dreamteamer/transcription-cache` | `$TRANSCRIPTION_HOME/asr/` |

`TRANSCRIPTION_HOME` defaults to `~/.cache/dreamteamer/transcription`. The old variables move
nothing: delete them, set `TRANSCRIPTION_HOME` only if you want another folder, and move (or let
`dt-setup` fetch again) the model weights into `models/`. A run whose models are missing now stops
before decoding, naming each missing path, instead of falling back to one speaker or downloading
mid-run. `@dreamteamer/recordings` 0.3.0 carries the same change for a workspace on the small modules.

## 0.5.4 and earlier

See the small modules' READMEs; core carried no upgrade notes before 0.6.0.
