# Updating @dreamteamer/core

One section per release, newest first. Each says what you have to **do** in a workspace that
installs this module; most of the time it is `dt compile`, then `dt check`.

```bash
npm install @dreamteamer/core@latest
npx dreamteamer compile
npx dreamteamer check
```

---

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

**An overlay of yours.** If your own module overlays `teams` with `extends: "@dreamteamer/core/teams"`,
it keeps working — core still owns teams.

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
