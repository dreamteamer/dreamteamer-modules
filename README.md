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
npx dreamteamer init
dt install @dreamteamer/core @dreamteamer/rnd
```

On engine 0.48 or later `init` installs and compiles by itself; there is no separate compile step.
`dt install` (engine 0.49 or later) pins each package and everything it depends on in your
`package.json`, writes their nav fragments into `nav.yaml`, and compiles. `npm install` alone does
not expand a preset: `npm install @dreamteamer/core` installs a package with no collections.

- [`@dreamteamer/core`](modules/core) — every core noun from one install: users with their teams,
  roles and responsibilities, companies, contacts and engagements, tasks, projects with decisions and
  risks, meetings with recordings, preps, summaries and critiques, files on mounted drives, the
  assets a view draws, artifacts, sessions and metrics, and workflows. From 0.12.0 it is a *module
  preset of seventeen*: a pinned list of the small modules below, which `dt install` expands into your
  own dependencies, so any one of them can later be dropped or updated on its own. Nothing is
  composed. Its nav fragment files those rows into six folders — Work, People, CRM, Meetings, Library,
  Activity — that `nav.yaml` then keeps as yours to rearrange.
- [`@dreamteamer/rnd`](modules/rnd) — what a workspace builds: products, design docs, change
  requests, implementation plans, user stories, screens, prototypes, tests, reviews, issues,
  features, research, personas — and the lifecycle that moves them, `/rnd:design` to `/rnd:deploy`,
  gated per record. It stands alone — `wikis` and `notebooklm` are modules of their own, installed
  beside it by whoever keeps notebooks or wikis — and its nav fragment places its rows under one R&D
  namespace with Product and Knowledge folders.

Then `npx dreamteamer status` prints each installed module's setup line — `configured`, `blocked` or
`ready`, with the next command — and `npx dreamteamer doctor` the checks behind it; `npx dreamteamer
setup <unit>` is the fix (the engine's, since dreamteamer 0.47). The module docs write `dt` for the
same CLI where an agent is the reader. A bare clone with no `.env` is a working workspace; everything optional
degrades by name.

## the modules

Each module states its own engine floor (`dreamteamer.engine` in its `package.json`): from `>=0.33.0`
for the plain content modules up to `>=0.48.0` for those whose setup unit has the engine write `.env`,
and `>=0.49.0` for `core`, `rnd` and `knowledge`, the first engine that installs a preset and merges a
nav fragment; `npx dreamteamer install` refuses a module whose floor the installed engine does not meet.
A module declares what it depends on, and `npx dreamteamer install @dreamteamer/<id>` installs it with
that closure as direct dependencies — the engine loads only the modules your `package.json` names. Each
module's README has its exact install line. A module that ships no nav fragment draws its rows flat,
alphabetical by title, until you file them; installing the seventeen members one by one draws the same
rows as `core` does, unfolded.

**Work — people, commitments, meetings** (the seventeen members of the `core` preset)

| module | what it gives a workspace | needs |
|---|---|---|
| [`@dreamteamer/users`](modules/users) | the people and agents work is assigned to, and the teams they form | — |
| [`@dreamteamer/roles`](modules/roles) | the positions people hold — team leader, backend developer — listed on each user | users |
| [`@dreamteamer/responsibilities`](modules/responsibilities) | areas of ownership — release sign-off, a client relationship — and who carries each | users |
| [`@dreamteamer/assets`](modules/assets) | icons, logos and avatars as file records, 200 KB each at most | — |
| [`@dreamteamer/companies`](modules/companies) | organisations: the record every other module points at | assets |
| [`@dreamteamer/contacts`](modules/contacts) | people you deal with, each at a company | companies · assets |
| [`@dreamteamer/engagements`](modules/engagements) | one record per relationship with a company: lead, client, closed | companies |
| [`@dreamteamer/tasks`](modules/tasks) | who owes what by when: inbox, board, by person | users |
| [`@dreamteamer/projects`](modules/projects) | the plan and everyone in it: projects, decisions, deliverables, risks — staffed with users' teams | users |
| [`@dreamteamer/meetings`](modules/meetings) | meetings as records, attendees as contacts, screenshots filed beside each call | contacts · companies · users |
| [`@dreamteamer/recordings`](modules/recordings) | recordings imported by content hash, matched to their meeting, transcribed offline (Hebrew and English, on the GPU where there is one) | meetings |
| [`@dreamteamer/meeting-docs`](modules/meeting-docs) | a prep before the call, a summary after it, a critique on the transcript, and the tasks it produced | engagements · meetings · recordings · tasks · contacts · companies |
| [`@dreamteamer/files`](modules/files) | files on mounted drives as records, kept level by `dt files sync`, with your notes on each | — |
| [`@dreamteamer/workflows`](modules/workflows) | a chain of commands over sets of records, written once, run with `/workflow:run` | — |
| [`@dreamteamer/artifacts`](modules/artifacts) | built pages a person opens — a pitch, a prototype, a report — kept as a folder with `index.html` | — |
| [`@dreamteamer/ui-html`](modules/ui-html) | a page on a record: the `html-page` mixin, a field of static HTML the desktop app draws in a sandboxed frame | — |
| [`@dreamteamer/sessions`](modules/sessions) | sittings of work — a coding-agent session, a person's block — with `dt session` and the metrics read from a transcript | users |
| [`@dreamteamer/metrics`](modules/metrics) | named measures tracked over time, the definition and its dated readings in one record | users |

**Knowledge and review**

| module | what it gives a workspace | needs |
|---|---|---|
| [`@dreamteamer/rnd`](modules/rnd) | the R&D lifecycle on products, designs, plans, tests and reviews, standing alone (above) | — |
| [`@dreamteamer/wikis`](modules/wikis) | local corpora of markdown, grepped with nothing installed, asked by meaning once `qmd` is | — |
| [`@dreamteamer/notebooklm`](modules/notebooklm) | `dt notebooklm`: the workspace as NotebookLM sources, each notebook a record it is restored from | — |
| [`@dreamteamer/search`](modules/search) | `dt-find`: an effort ladder over the workspace's own records — exact words, meaning, a hedged query, the reference graph | — |
| [`@dreamteamer/routines`](modules/routines) | recurring commitments: a calendar rule and the next date owed | — |
| [`@dreamteamer/perspective`](modules/perspective) | a person's operating model, read off their own past work | — |

**Tools that run code**

| module | what it gives a workspace | needs |
|---|---|---|
| [`@dreamteamer/proofs`](modules/proofs) | `dt prove`: behaviour proofs of skills, commands and scripts, answered by exit code | — |
| [`@dreamteamer/worktrees`](modules/worktrees) | `dt worktree` and `dt land`: a second checkout, and bringing its records home | — |
| [`@dreamteamer/code`](modules/code) | `dt-editor`: the browser editor over local files, with a Claude coordinator (not published to npm) | — |
| [`@dreamteamer/docker-workspaces`](modules/docker-workspaces) | `dt-docker`: a workspace as a local Docker container, moved between machines as one encrypted file | — |

The UI for people is the dreamteamer desktop app, which loads the engine in-process and owns the protocol between
its windows and a workspace. `@dreamteamer/web` (`dt web`), `@dreamteamer/http` (`dt serve`),
`@dreamteamer/protocol`, `@dreamteamer/ui` and `@dreamteamer/ui-legacy` were retired from this repository; the
versions already on npm still install.

## Optional personal workspace capabilities

The following modules are published like the rest, each installed on its own. They ship no accounts,
private records, client configuration or tokens.

| module | capability | needs |
|---|---|---|
| [`@dreamteamer/work`](modules/work) | goals and strategies, with linked tasks, sessions, decisions and their saved views | engine >=0.53.0; install Projects, Tasks and Sessions for full composition |
| [`@dreamteamer/workspaces`](modules/workspaces) | desired Work Areas and Workspaces, operator and team catalog, offline review | engine >=0.53.0; no provisioning |
| [`@dreamteamer/knowledge`](modules/knowledge) | raw thought capture, reader-facing briefs and cross-domain synthesis | companies · meetings; engine >=0.49.0 |
| [`@dreamteamer/connectors-google-workspace`](modules/connectors-google-workspace) | explicit-account local bridge to a pinned public MCP server, read-only by default; the Google Calendar sync into meetings (`/fetch-meetings`, `WORK_CALENDARS`) | meetings; owner-controlled OAuth setup and local Python runtime |
| [`@dreamteamer/connectors-linkedin`](modules/connectors-linkedin) | the LinkedIn scraper: `/scrape-contact` and the two contacts views (needs a LinkedIn link, needs review) | contacts · companies · assets; Docker and a LinkedIn sign-in |
| [`@dreamteamer/git-identities`](modules/git-identities) | folder-scoped Git configuration proposals and read-only authorship/alias checks | owner-reviewed Git and SSH setup |

Tasks in `core` use a compact Board and List by default, including suggestions and creation dates; historical routes remain available.

Choose capabilities independently. The account modules do not authorize accounts, apply machine
configuration, import CRM records or prove remote access. The setup board reports unverified
authentication as a gap. Meetings and transcription are the `meetings` and `recordings` modules, members of
the `core` preset; the calendar sync that fills `meetings` is `connectors-google-workspace`, and the LinkedIn
enrichment of `contacts` is `connectors-linkedin`. Content-production and service-usage dashboards are not part of
this profile.

## making a module yours

A different title, an extra field, a different list — that is an **overlay** in your own module,
never an edit to the installed one. An overlay is a descriptor with the base collection's `name` and
`overlay: true`; its module declares the owning module as a dependency, by its full package name:

```yaml
# modules/mine/collections/contacts.collection.yaml
# and in modules/mine/package.json:  "dreamteamer": { "dependencies": ["@dreamteamer/contacts"] }
name: contacts
overlay: true
title: Kontakte
fields:
  pronouns:
    type: string
    description: How to refer to them.
```

Then `npx dreamteamer compile`; the merged descriptor is what the runtime reads, and
`npx dreamteamer check` validates every record against it. `npx dreamteamer add-field contacts
--name pronouns --module mine` writes the same file for you. An overlay adds or tightens fields and
never removes one, and compile refuses it while its module does not depend on the base's.

## versions and releases

Each module is released on its own, as one git tag `<id>-v<version>` pushed by a person;
`.github/workflows/release.yml` re-runs the leak gate and the suite, then publishes to npm with
provenance. A module's `README.md` carries its release notes; `UPDATING.md`, where a module ships
one, says what a workspace has to do after upgrading. Nothing is composed: from 0.12.0
`core` is a preset — its `package.json` pins each member to an exact version under `dreamteamer.preset`
— and is re-released when a member it pins is released.

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
push that branch as above. Those refusals are a floor, not a review: the rest of an outside change —
a test, a dependency — runs in CI and again in the release job that publishes, so read it whole
before taking it in.

## working on this repo

```bash
npm install
npm test                                   # every gate, against the engine in devDependencies
DT_ENGINE_DIR=../dreamteamer npm test      # the same, spawning dt from an engine checkout
node scripts/test-candidate.ts ../dreamteamer [--only=… | --module=…]
                                           # the checkout packed and installed over node_modules/dreamteamer
                                           # (dreamteamer/testing too), the suite run, the published engine put back
node scripts/test.ts --module=users       # tests/ + one module's suite — what its release tag runs
node scripts/test.ts --shard=2/4          # one of CI's four balanced shards (--list to see its files)
```

The code is TypeScript, run as it is in a checkout (Node's type stripping, Node 22.18 or later). npm cannot
run TypeScript from `node_modules`, so a module ships its build: `npm run build` (`scripts/build.ts`, also
each module's `prepack` and the first step of `npm test`) compiles `src/`, `lib/` and `bin/` into `dist/`,
and a module's skills (`.mts` beside each `SKILL.md`) into `dist/skills`, which `dt compile` stages from
(`dreamteamer.skills`). Nothing generated sits beside its source. A module's script is run by name, not by
path: `npx dreamteamer run @dreamteamer/<id> <script>` (each module lists its own under
`dreamteamer.scripts`). `dist/` is gitignored, so a clone linked into a workspace is built after each edit.

`npm test` installs every module into fresh workspaces twice — once from its packed tarball, the way
npm delivers it, and once as a copied folder — and checks that each compiles with only what it
declares, that the modules work together on real records, that every module's own suite passes, and
that nothing private leaked in. The transcription skill's Python tests run separately, against the
skill's own environment:

```bash
uv run --project modules/recordings/skills/transcribing-recordings --with pytest \
  python -m pytest -q modules/recordings/test/transcribing-recordings
```

To try an unreleased module in a real workspace, install it from this clone:
`npx dreamteamer install ./<clone>/modules/<id>`.

The house rules — no personal data (the synthetic cast is Dana Oren, Sam Diaz, Northwind, Harbor
Mutual), every module compiles alone, a module ships only what its `files` names, and a module that
needs a sibling at a version says so as an npm `peerDependencies` floor, which npm and `npx dreamteamer compile`
both refuse below — are in `CLAUDE.md`. Apache-2.0.
