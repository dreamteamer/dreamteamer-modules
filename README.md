# dreamteamer-modules

The official modules for [dreamteamer](https://www.npmjs.com/package/dreamteamer), the workspace
compiler for coding agents. A dreamteamer workspace is a git repo of typed records — people,
meetings, tasks, products, designs — that `dreamteamer compile` turns into a runtime every coding
agent reads: the schemas, the skills that say how each kind of record is handled, the commands, the
views. A **module** is a package of those sources: the collections it declares, the skills and
commands that operate on them, and sometimes a verb or two of its own. This repo holds every
official module, one npm package each under `@dreamteamer/<id>`, versioned and released on its own.

## start here

Two packages give a workspace almost everything:

```bash
npm install dreamteamer @dreamteamer/core @dreamteamer/rnd
npx dreamteamer init
npx dreamteamer compile
```

- [`@dreamteamer/core`](modules/core) — every core noun from one install: users with their teams,
  roles and responsibilities, companies, contacts and engagements, tasks, projects with decisions and
  risks, meetings with recordings, preps, summaries and critiques, files on mounted drives, the
  assets a view draws, artifacts, sessions and metrics, and workflows. It is a *composition* of the
  small modules below, so you install **core or the small modules, never both**.
- [`@dreamteamer/rnd`](modules/rnd) — what a workspace builds: products, design docs, change
  requests, implementation plans, user stories, screens, prototypes, tests, reviews, issues,
  features, research, personas — and the lifecycle that moves them, `/rnd:design` to `/rnd:deploy`,
  gated per record. It composes `wikis` and `notebooklm`.

Then `npx dt-setup doctor` ([`@dreamteamer/setup`](modules/setup)) prints one board of every
optional capability — transcription, Google, NotebookLM, retrieval — READY, DEGRADED or UNAVAILABLE,
with the fix on each row. A bare clone with no `.env` is a working workspace; everything optional
degrades by name.

## the modules

Every module needs engine `>=0.33.0`; `rnd` and `workflows` need `>=0.38.0`, `core` `>=0.39.0`. A module
declares what it depends on, and you install the closure as direct dependencies — the engine loads
only the modules your `package.json` names. Each module's README has its exact install line.

**Work — people, commitments, meetings** (all composed into `core`)

| module | what it gives a workspace | needs |
|---|---|---|
| [`@dreamteamer/users`](modules/users) | the people and agents work is assigned to, and the teams they form | — |
| [`@dreamteamer/assets`](modules/assets) | icons, logos and avatars as file records, 200 KB each at most | — |
| [`@dreamteamer/companies`](modules/companies) | organisations: the record every other module points at | assets |
| [`@dreamteamer/contacts`](modules/contacts) | people you deal with, each at a company, enriched from LinkedIn | companies · assets |
| [`@dreamteamer/engagements`](modules/engagements) | one record per relationship with a company: lead, client, closed | companies |
| [`@dreamteamer/tasks`](modules/tasks) | who owes what by when: inbox, board, by person | users |
| [`@dreamteamer/projects`](modules/projects) | the plan and everyone in it: projects, decisions, deliverables, risks — staffed with users' teams | users |
| [`@dreamteamer/meetings`](modules/meetings) | calendar meetings synced from Google Calendar, attendees as contacts, screenshots filed beside each call | contacts · companies · users |
| [`@dreamteamer/recordings`](modules/recordings) | recordings imported by content hash, matched to their meeting, transcribed offline (Hebrew and English, on the GPU where there is one) | meetings |
| [`@dreamteamer/meeting-docs`](modules/meeting-docs) | a prep before the call, a summary after it, a critique on the transcript, and the tasks it produced | engagements · meetings · recordings · tasks · contacts · companies |
| [`@dreamteamer/files`](modules/files) | files on mounted drives as records, kept level by `dt files sync`, with your notes on each | — |
| [`@dreamteamer/workflows`](modules/workflows) | a chain of commands over sets of records, written once, run with `/workflow:run` | — |

**Knowledge and review**

| module | what it gives a workspace | needs |
|---|---|---|
| [`@dreamteamer/rnd`](modules/rnd) | the R&D lifecycle on products, designs, plans, tests and reviews (above) | — |
| [`@dreamteamer/wikis`](modules/wikis) | local corpora of markdown, grepped with nothing installed, asked by meaning once `qmd` is (composed into `rnd`) | — |
| [`@dreamteamer/notebooklm`](modules/notebooklm) | `dt notebooklm`: the workspace as NotebookLM sources, each notebook a record it is restored from (composed into `rnd`) | — |
| [`@dreamteamer/search`](modules/search) | `dt-find`: an effort ladder over the workspace's own records — exact words, meaning, a hedged query, the reference graph | — |
| [`@dreamteamer/routines`](modules/routines) | recurring commitments: a calendar rule and the next date owed | — |
| [`@dreamteamer/perspective`](modules/perspective) | a person's operating model, read off their own past work | — |

**Tools that run code**

| module | what it gives a workspace | needs |
|---|---|---|
| [`@dreamteamer/setup`](modules/setup) | `dt-setup`: the capability board, the fixes, and `link` to preview this repo | — |
| [`@dreamteamer/proofs`](modules/proofs) | `dt prove`: behaviour proofs of skills, commands and scripts, answered by exit code | — |
| [`@dreamteamer/worktrees`](modules/worktrees) | `dt worktree` and `dt land`: a second checkout, and bringing its records home | — |
| [`@dreamteamer/http`](modules/http) | `dt serve`: a JSON REST api over the same validating store the CLI uses | — |
| [`@dreamteamer/code`](modules/code) | `dt-editor`: the browser editor over local files, with a Claude coordinator | — |
| [`@dreamteamer/docker-workspaces`](modules/docker-workspaces) | `dt-docker`: a workspace as a local Docker container, moved between machines as one encrypted file | — |

## making a module yours

Another label, an extra field, a different list — that is an **overlay** in your own module, never
an edit to the installed one. Name the module by its full package name (quoted: YAML reserves a
leading `@`) and declare it as a dependency:

```yaml
# modules/mine/collections/contacts.collection.yaml   — and "dependencies": ["@dreamteamer/contacts"]
name: contacts
extends: "@dreamteamer/contacts/contacts"
overlay: true
label: Kontakte
fields:
  pronouns:
    type: string
    description: How to refer to them.
```

Then `npx dreamteamer compile`; the merged descriptor is what the runtime reads, and `dt check`
validates every record against it.

## versions and releases

Each module is released on its own, as one git tag `<id>-v<version>` pushed by a person;
`.github/workflows/release.yml` re-runs the leak gate and the suite, then publishes to npm with
provenance. A module's `README.md` carries its release notes; `UPDATING.md`, where a module ships
one, says what a workspace has to do after upgrading. `core` and `rnd` are re-composed and
re-released when a module they compose changes (`scripts/compose-core.mjs`; `compose.json` in each
lists every copy with its origin and hash).

`main` is protected: a commit reaches it only when the `ci` and `leak-scan` checks passed on it, for
administrators too, and it is never force-pushed. So a change — the version bump included — goes in
through a branch:

```bash
git push origin <branch>                   # ci and leak-scan run on every pushed branch
# wait for ci and leak-scan to be green on the branch's head
git push origin <branch>:main              # a fast-forward; refused unless both passed on that commit
git tag <id>-v<version> && git push origin <id>-v<version>   # the publish
```

A pull request from a fork is never merged with the button: its own run can report checks with the
same names. Fetch it and take it in with `scripts/take-in.sh`, which re-commits it on a branch here
at new commits and refuses a change to the workflows, the leak allow-list or an npm script; then
push that branch as above.

## working on this repo

```bash
npm install
npm test                                   # every gate, against the engine in devDependencies
DT_ENGINE_DIR=../dreamteamer npm test      # the same, against an engine checkout
node scripts/test.mjs --module=users       # tests/ + one module's suite — what its release tag runs
node scripts/test.mjs --shard=2/4          # one of CI's four balanced shards (--list to see its files)
```

`npm test` installs every module into fresh workspaces twice — once from its packed tarball, the way
npm delivers it, and once as a copied folder — and checks that each compiles with only what it
declares, that the modules work together on real records, that every module's own suite passes, and
that nothing private leaked in. The transcription skill's Python tests run separately, against the
skill's own environment:

```bash
uv run --project modules/recordings/skills/transcribing-recordings --with pytest \
  python -m pytest -q modules/recordings/test/transcribing-recordings
```

To try an unreleased change in a real workspace, preview this clone there with
`npx dt-setup link <clone>` and `unlink` when done — a pre-commit guard refuses record commits
while a preview is on, because a record may not depend on an unpublished schema.

The house rules — no personal data (the synthetic cast is Dana Oren, Sam Diaz, Northwind, Harbor
Mutual), every module compiles alone, a module ships only what its `files` names, and a module that
needs a sibling at a version says so as an npm `peerDependencies` floor, which npm and `dt compile`
both refuse below — are in `CLAUDE.md`. Apache-2.0.
