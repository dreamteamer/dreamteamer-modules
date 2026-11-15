# Setting up Google Workspace

This is the authoritative setup reference for `@dreamteamer/connectors-google-workspace`. An agent
helping a person set up their workspace reads it from the installed package root (for example
`node_modules/@dreamteamer/connectors-google-workspace/SETUP.md`) and follows it in the person's own
language. The module is **optional**: declining it leaves every other capability untouched.

The package carries two setup units: `google-workspace` (the sections below, up to the last one) and
`meetings`, which calendars the calendar sync reads (the last section, `The meetings unit — work
calendars`).

## Scope

Owns: the local `workspace-mcp` runtime, the OAuth client file location, the local credential
directory, and each account's consent and live read. Does not own: which calendars count as work
(the `meetings` unit, below), Git identities, transcription, or any other account.

## Commands

| command | effect |
|---|---|
| `npx dreamteamer google-setup inspect [--json]` | Local checks only. No write, no network, no process, no secret read. |
| `npx dreamteamer google-setup plan [--account <email>]… [--json]` | The checks plus next actions, each with its effects, state and exact command. Writes nothing. |
| `npx dreamteamer google-setup apply create-credential-store --target <dir> --parent-id <id> --workspace <root> [--json]` | Creates exactly the previewed credential directory, owner-only. The only write this module performs. Copy the argv from the plan's `command`. |
| `npx dt-google doctor --json` | The original four-row report, from the same inspect. |
| `npx dreamteamer doctor` | Shows this module's local rows under `google-workspace`. Missing setup is a warning, never a failure; the never-locally-verifiable authorization row is left out. |

The `google-setup` command exists once the engine has compiled this module (`dt compile`; the module needs engine 0.48.0 or later).
Every JSON result names the workspace (`workspace.root`, `workspace.name`); check it is the one the
person means before acting.

## Inputs to ask for

- `GOOGLE_CLIENT_SECRET_PATH` — absolute path to the person's **Desktop** OAuth client file, outside Git.
- `WORKSPACE_MCP_CREDENTIALS_DIR` — absolute path to a local credential directory outside the
  workspace and outside synced folders.
- Each account to connect, named explicitly. Never infer an account.

The engine's `dt install` / `dt setup google-workspace` take both as `--input credentials_dir=…` and
`--input client_secret=…` (or from the environment, or the declared default for the store) and record
them in the workspace `.env` (`record-settings`), so `dt status` and the next `dt setup` read them
back. `dt-google` itself, run by hand, reads the **process environment** only: export the two keys in
the shell that runs it, or run the owner's steps through `dt setup google-workspace --authorize`,
which hands the `.env` values to `dt-google`.

## Reading a check

Each row has a `status`:

| status | meaning | what to say |
|---|---|---|
| `ready` | A local fact holds (the runtime exists, placement is safe). | ready locally |
| `configured` | A path or file exists. **Not** proof that OAuth works. | configured, unverified |
| `unverified` | Only a live step can establish it. Never inferred from `ok`. | unverified |
| `missing` | An input or a local action can fix it. | needs input or action |
| `blocked` | Waits on something this module does not do (an owner install, a move, another row). | blocked, with the reason |

`google.account-authorization` is always `unverified` in inspect. A capability is **ready** only after
`verify-account-read` (or a fresh `authorize-account`) succeeded for that account on this computer in
this conversation. If the person declines Google, report it as **skipped** — not as a failure.

## Actions

Run `plan` first and show the person each action's `effects`. Ask for specific approval per action.
Re-run `plan` after every action: state comes from what is on disk, never from an earlier success.

1. **`create-credential-store`** — `runBy: agent`. Effect: one new owner-only directory outside the
   workspace. Outside the person's home **only the last folder of the path** is made, inside a parent
   that already exists; under the home the missing folders between are made too, each owner-only, so
   the default `~/.config/google-workspace-mcp/credentials` can be made on a machine that never ran
   the bridge. Nothing else is created, and no existing permission is ever changed. The plan refuses
   (`blocked`) when:
   - the path is not canonical (it passes through a symlink, or holds `.` or `..`); the reason names
     the canonical form to configure instead;
   - the nearest existing parent belongs to another user or others can write to it, or (outside the
     home) the parent is missing;
   - the path is inside the workspace, or holds a file or symlink;
   - a directory already exists there but other users can access it. Restrict it yourself after
     reviewing it; it is never reported `done`.
   An owner-only existing directory is `done`. The preview binds the canonical target and the
   parent's identity (`--target`, `--parent-id`). `apply` refuses as stale, changing nothing, when the
   configured path no longer matches the target, the parent was replaced, or anything appeared at the
   path before the directory was created.
2. **`authorize-account`** — `runBy: owner`, live. Effects: network (starts the pinned server through
   `uvx`, which may download it once), Google consent for read-only Gmail, Drive and Calendar scopes,
   and one credential file written by the server. The person runs `npx dt-google auth <account>`
   themself, opens the printed Google URL, inspects the account and scopes, and approves or stops.
   Exit 0 with `state: verified_read` is a verified read for that account. Never retry in a loop;
   never pass `--allow-write` without separate explicit approval for broader scopes.
3. **`verify-account-read`** — `runBy: owner`, live. For an account that already has a stored
   credential: `npx dt-google call <account> search_drive_files '{"query":"trashed = false","page_size":1}'`.
   Exit 0 is the evidence. The output is the person's private data: do not repeat it, store it or
   put it in a report — report the exit status only.

Installing `uv` is the owner's machine-level decision: name the official instructions and wait. This
module never installs software, opens a browser, refreshes or deletes tokens, or changes scopes.

## Final report

Per account: **ready** (verified read in this session), **configured, unverified** (credential stored,
no live read), **blocked** (name the blocking row), or **skipped** (the person declined). Name the next
action for anything not ready. Never include a path, token, file listing or message content.

## Limits

- Local checks prove presence, never consent, expiry or scopes.
- Windows: the MCP bridge refuses to start; `authorize-account` is reported blocked there.
- `google-setup` and `dt-google` read the process environment only; the engine's `dt setup` is what carries the `.env` values to them.
- Offline tests use synthetic files and a mock server; they prove no live Google access.

## The meetings unit — work calendars

The second unit of this package, `meetings`: the calendar sync's own setup. The `meetings` module
(meeting records, screenshots and contact stamps) works with **no setup at all**. Everything below is
for the optional calendar sync (`/fetch-meetings`, the `fetching-meetings` skill); the person may skip
it.

### Scope

One setup unit, `meetings`. Owns: `WORK_CALENDARS` (which calendars count as work, their default
company and the account that reads each), and the local prerequisites of the calendar reader
`gcal.mjs`. Does not own: Google consent or the credential directory (the `google-workspace` unit,
above), transcription (the `recordings` module), or `FILES_FOLDER`/`INBOX_FOLDERS`.

### Commands

Run from the workspace root. The engine drives the unit the same way however the package arrived — its
own npm package or an inline copy. `dt status` labels it `connectors-google-workspace › meetings`.

| command | effect |
|---|---|
| `dt status` | The unit's line: `configured`, `blocked` or `ready`, with the next command. Read-only. |
| `dt doctor` | The unit's checks as rows. Read-only, offline. |
| `dt setup meetings --input calendar="<calendar> \| <company> \| <account>"` | Merges the rows into `WORK_CALENDARS` in `.env` (repeat `--input` per row). `--json` lists what is pending. |
| `dt setup meetings --verify --authorize` | The owner's live check, in a terminal. |

### Inputs to ask for

One row per work calendar: the calendar id, the default `companies` id (or `mixed` for a calendar
holding several companies' meetings) and the account email that reads it. See the
`fetching-meetings` skill for which calendars count as work.

### Reading a check

| status | meaning | what to say |
|---|---|---|
| `configured` | The value or file exists. **Not** proof the account can read the calendar. | configured, unverified |
| `unverified` | Only the live step can establish it. Never inferred from `ok`. | unverified |
| `missing` | An input or action can fix it. | needs input or action |
| `blocked` | Waits on another row, or a fix by hand is needed — the reason says which. | blocked, with the reason |

`meetings.account-access` is `unverified` until a live check passes. Check rows carry counts and line
numbers, never a calendar id, account address or path.

### Actions

1. **`add-calendar-rows`** — an env action: the unit merges the rows into the `WORK_CALENDARS` value
   (rows already present are kept; nothing new is `done`), and the engine writes `.env` — that key
   only, every other line byte for byte, the value never printed. A mixed batch adds the valid rows
   and names the malformed ones by input number.

   **It changes nothing, and says why, when:** `.env` could be committed, holds the key twice or has a
   temporary file from an interrupted write beside it (the engine's refusals); `WORK_CALENDARS` is set
   in the process environment, which would shadow `.env`; an existing row is malformed; or a requested
   row names an existing calendar and account with a different company — edit that by hand.
2. **Account consent** — the owner's step, owned by the `google-workspace` unit: follow
   `authorize-account` above, or the one-time setup in the `fetching-meetings` skill. This unit never
   starts consent.
3. **`verify-calendar-access`** — the owner's, live, under `dt setup meetings --verify --authorize`.
   Effects: network (token refresh at Google and one calendar-list read per account). Evidence: every
   row reports `verdict: full`, and a dated receipt makes the line `ready · verified`. The output names
   private calendars: report only how many rows are `full`, `free-busy` or `absent`.

The calendar reader reads `GOOGLE_CLIENT_SECRET_PATH` and `WORKSPACE_MCP_CREDENTIALS_DIR` from the
**process environment** (defaults under `~/.config`), and `WORK_CALENDARS` from the environment or
`.env`. Inspect looks exactly where the reader will.

### Final report

**ready** only after `verify-calendar-access` showed every row `full`; **configured, unverified** when
rows and credential files exist without a live check; **blocked** with the blocking row; **skipped**
when the person declined calendar sync (`dt setup meetings --skip`). Name the next action for each.

### Limits

- File presence proves nothing about consent, expiry, scopes or calendar access.
