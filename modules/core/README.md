# @dreamteamer/core

Every core noun of a workspace from one install line: people and the roles and responsibilities
they hold, companies, contacts and engagements, tasks, projects with their decisions, risks and teams,
meetings with recordings, preps, summaries and analyses, files on mounted drives, the assets a view
draws, the artifacts a person opens, sessions of work and the metrics that count them.

```bash
npm install @dreamteamer/core
npx dreamteamer compile
```

## composed, not written twice

This package is a COMPOSITION of the small official modules — assets, users, companies, contacts,
engagements, tasks, projects, meetings, recordings, meeting-docs, files — plus what no small module
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

A session record is one person's working trace, so a workspace usually keeps them local: a
`.gitignore` line for `data/sessions/` keeps every record readable by `dt list` and `dt check` and
out of the shared history. To keep the metrics current without anyone remembering, bind the reader
to the harness's `Stop` hook in the workspace's `.claude/settings.json` — the module ships the
reader, not the binding:

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
need engine 0.38, which is core's floor.

## what a descriptor cannot say

The small modules' READMEs hold the reasoning behind each noun and travel with their packages; this
one adds only the composition rule above. `FILES_FOLDER` and `INBOX_FOLDERS` are the template
variables the meetings, recordings and files nouns need — declare them in `dreamteamer.vars` and set
them in `.env` before `dt resolve` can render a path.
