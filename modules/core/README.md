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
removed — and keeps a copy of the transcript under `${env:FILES_FOLDER}/sessions/`, since the harness
sweeps its own after a month. `/session:analyze` reads that transcript as a reviewer and writes
`analysis` and a one-line `description` onto the record. Both are the `managing-sessions` skill; the
reader is `bin/session-save.mjs` (`--json` prints the fields and writes nothing).

A session record is one person's working trace, so the collection lives OUTSIDE the repo: its
`storage.path` is `${env:SESSIONS_FOLDER}`, which core requests in its `dreamteamer.vars`, the
workspace declares in its own `dreamteamer.vars` (compile says so until it does) and `.env` sets per
machine. A record is `<SESSIONS_FOLDER>/<yyyy>/<mm>/<id>.session.md`; `dt list`, `dt get` and
`dt check` read the folder, `dt status` names it under `storage:`, and `dt commit` reports it as
outside every git repo here — session records are never committed, and need no `.gitignore` line.
With `SESSIONS_FOLDER` unset, compile warns and every record verb on `sessions` refuses, naming the
var: set it in `.env`, declare it beside `FILES_FOLDER` in the workspace's `dreamteamer.vars`, and
recompile. The transcript copy is separate, under `${env:FILES_FOLDER}/sessions/`. To keep the
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

## live sessions: a session starts on a record and claims it

A `sessions` record can also be written when work STARTS. A module binds a collection in
`session-bindings/<id>.session-binding.yaml` — the record state that opens a session (`available_when`),
the state that ends the work (`done_when`), the `agent` and `harness`, the `command` it starts with,
`concurrency` (`one`: a second start is refused unless `--join`; `many`) and `stale_after` (minutes
without a heartbeat, default 30). Compile validates every binding and refuses a bad one by name.

```bash
dt sessions open [--collection <c>] [--json]      # what a binding makes available and nobody holds
dt session start <collection>/<id> [--agent <id>] [--join]   # claim it: a running sessions record
dt next <collection>/<id>                         # "in session by agents/<a> since <time>" while it runs
dt session end <session> [--outcome <text>]       # yours only; ended, the record is free again (--force: a person's)
dt list sessions --filter status=running          # who is working on what
```

The claim is the session: a `running` record listing the ref in `records`, with a fresh `heartbeat`.
It is advisory — `start` refuses, `dt next` and `dt sessions open` say so, and no write is blocked.
Sessions live in `${env:SESSIONS_FOLDER}`, so a claim is seen at once by every worktree and agent on
this machine, and by no other machine. A Claude Code session keeps its heartbeat with the `Stop` hook
`dt install --print-adapters` prints (`dt session heartbeat --hook`, keyed by the harness session id);
a session silent past its binding's `stale_after` is `abandoned` and its claim lapses. A session's
`end` and `heartbeat <id>` belong to its own harness session (or its worker's `--agent`): another
caller is refused naming the holder, and a person frees a stuck claim with `--force`, which the
holder's Stop hook reports once. When a session's own binding no longer opens its record (its
stage is done), `dt next` says so and names `dt session end`, and the next stage's binding is open
beside it — listed by `dt sessions open` as held by a finished stage. The line in
`dt next` needs an engine with the `next` extension contribution; on an older engine every other verb
works. The `managing-sessions` skill has the procedure and an example binding.

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
