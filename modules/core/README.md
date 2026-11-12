# @dreamteamer/core

Every core noun of a workspace from one install line: people with the teams they form and the
roles and responsibilities they hold, companies, contacts and engagements, tasks, projects with their
decisions and risks, meetings with recordings, preps, summaries and analyses, files on mounted drives, the assets a view
draws, the artifacts a person opens, sessions of work and the metrics that count them, and the
workflows that run chains of those commands over sets of records.

```bash
npm install @dreamteamer/core
npx dreamteamer compile
```

## Task navigation

Tasks default to a compact Board and List of unfinished work, including suggestions awaiting triage. Creation dates are visible. Alternate built-in task routes remain usable as deep links while staying out of navigation; task records and status meanings are unchanged.

## composed, not written twice

This package is a COMPOSITION of the small official modules — assets, users, companies, contacts,
engagements, tasks, projects, meetings, recordings, meeting-docs, files, workflows — plus what no small module
has (below). Each descriptor, skill and command is authored in its small module and copied here by
`scripts/compose-core.mjs` in the modules repo (the same script composes `rnd`); `compose.json` lists every copy with its origin and
hash, and a test fails when a copy differs. A collection copied from `contacts` sits under
`collections/contacts/`, a script from `users/bin/` is `bin/users-<script>`; the one rewrite a copy
undergoes is its package name, so `node node_modules/@dreamteamer/users/bin/check-records.mjs` reads
`node node_modules/@dreamteamer/core/bin/users-check-records.mjs` here.

Install core OR the small modules, never both: two modules shipping `users` is a name collision
compile refuses, and that is the right answer.

## what core adds

- `sessions` — one sitting of work by a person or an agent on a project: who, when, how long, what
  came out of it. The event, never the plan and never the commitment.
- `metrics` — a named measure with its unit, scope, target and dated readings. The series is the
  record, so "how is X trending" is one file.
- `roles` and `responsibilities` — shared lists a person names on `users.roles` and
  `users.responsibilities`; each lists its people back.
- `artifacts` — a built page someone OPENS, kept as a folder whose `index.html` runs from disk.
- on `users`: `roles`, `responsibilities`, `manager` and the generated `reports`.
- the workspace's `agents` drawn in the nav beside users, as the workers tasks and sessions name.

## sessions: save and analyze

`/session:save` reads the transcript the harness keeps for the current session and upserts
`sessions/<session id>` with what it holds — turns, tool calls, input and output tokens, cache read
and written, cost at list price, wall and API minutes, the models that answered, lines added and
removed — and keeps a copy of the transcript under `${env:SESSIONS_FOLDER}/`, since the harness
sweeps its own after a month. `/session:analyze` reads that transcript as a reviewer and writes
`analysis` and a one-line `description` onto the record. Both are the `managing-sessions` skill; the
reader is `bin/session-save.mjs` (`--json` prints the fields and writes nothing).

A session record is an ordinary record under `data/sessions/`, committed like any other — a
colleague who pulls the workspace lists it. `SESSIONS_FOLDER` (core requests it in `dreamteamer.vars`;
the workspace declares it and `.env` sets it per machine) names only where transcript copies go:
`transcript` reads `${env:SESSIONS_FOLDER}/<yyyy>/<mm>/<session id>.jsonl`. Unset, every record verb
still works and the record points at the harness's own copy. To keep the
metrics current without anyone remembering, bind the reader to the harness's `Stop` hook in the
workspace's `.claude/settings.json` — the module ships the reader, not the binding:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node node_modules/@dreamteamer/core/bin/session-save.mjs --write --hook --quiet",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

The hook writes metrics only; `outcome`, `analysis` and `description` stay the session's and the
reviewer's words. Namespaced commands (`commands/session/save.command.md` typed as `/session:save`)
need engine 0.38; an env-pointed `storage.path` needs 0.39, which is core's floor.

## binding records to a session, and asking one

```bash
dt session bind <collection>/<id>… [--session <id>]   # add records to the current session's `records` (/session:bind)
dt next <collection>/<id>                             # "worked on in sessions/<id> — …", one line per session
dt session end [<session>] [--outcome <text>]         # stamp `ended` once; the outcome is the body
dt session send <session> "<question>"                # ask a past session, through a fork with no tools
```

`records` takes any number of references to records of any collection. A session record is written to
the workspace the session runs in — never inside a `git_modules/` layer — so one harness session is
one record, and a layer's record is bound from the workspace that reads the layer. Binding again changes
nothing. There is no claim and no lock: when another session already lists a record, `bind` names it
in one line and binds anyway. A record's sessions are read when `dt next` asks, from every root the
open workspace reads; nothing is written to the bound record, so a layer opened on its own sees only
its own sessions.

`dt session send` resumes the session's transcript by its stored `session_id` with
`claude -p --resume <id> --fork-session`, with no tools, no MCP servers and no hooks, from a temporary
folder, the question on stdin: the session's own history is untouched and the fork can only answer. It
needs the transcript on this machine and a claude-code session, and refuses naming which otherwise.

Core 0.8.0's live sessions (session-bindings, `dt session start`, `dt sessions open`, the heartbeat
and the claim) are gone; a `session-bindings/` folder a layer or an older package still ships compiles
with one `retired … ignored` line. `bin/sessions-migrate.mjs` moves a 0.8.0 workspace (UPDATING 0.9.0).

## workflows

`workflows` comes from `@dreamteamer/workflows`: a record that names a chain of commands, the records
each one walks and where a person decides, run with `/workflow:run <id>`. Nothing about a run is
recorded — the records the commands touch are the progress. Core ships `customer-factory` (the week's
calls to its leads and suggested engagements) in `data/workflows/`, a folder compile does not read;
`npx dt-workflows install customer-factory` copies it into the workspace, which then owns and commits
it. The workflows module's README has the record's shape.

## what a descriptor cannot say

The small modules' READMEs hold the reasoning behind each noun and travel with their packages; this
one adds only the composition rule above. `FILES_FOLDER` and `INBOX_FOLDERS` are the template
variables the meetings, recordings and files nouns need — declare them in `dreamteamer.vars` and set
them in `.env` before `dt resolve` can render a path.
