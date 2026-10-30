# @dreamteamer/core

Every core noun of a workspace from one install line: people and the roles and responsibilities
they hold, companies, contacts and engagements, tasks, projects with their decisions and goals,
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
`scripts/compose-core.mjs` in the modules repo; `compose.json` lists every copy with its origin and
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

## what a descriptor cannot say

The small modules' READMEs hold the reasoning behind each noun and travel with their packages; this
one adds only the composition rule above. `FILES_FOLDER` and `INBOX_FOLDERS` are the template
variables the meetings, recordings and files nouns need — declare them in `dreamteamer.vars` and set
them in `.env` before `dt resolve` can render a path.
