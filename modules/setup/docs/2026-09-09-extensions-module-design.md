# extensions — one installable module for the core of a work vault

**Status:** built 2026-09-09 from the dogfood vault's tracked sources, scrubbed, gated; restructured into a package of six modules the same day. This note
records the decisions that are not visible in the tree.

> ⚠ **Superseded in part, later the same day.** The sixth module is `perspective`, not
> `introspection`: 0.2.0 renamed it outright — namespace, collections, suffixes, fields and record
> ids — and re-keyed its evidence and model records from the RUN to the CONTRIBUTOR, so a second
> retrospective updates a person's operating model instead of writing a parallel copy beside it.
> `CHANGELOG.md` has the list and `npx dt-extensions migrate` is how an existing workspace moves.
>
> Every `introspection` below is left exactly as written. This note records what was decided on the
> day it was decided, and a document edited to agree with the present is no longer evidence of
> anything — which is why `tests/no-old-spelling.test.mjs` exempts this file by name.

## the ask

A dreamteamer module package holding the core of the dogfood vault — tasks, meetings, recordings,
files, assets, contacts and introspection — with no personal-information leakage, and without
finance, family, R&D, content or services (yet).

## the structural decision, revised the same day: a PACKAGE of modules

The first cut (morning of 2026-09-09) was one flat module at the repo root, because the engine's
`git-modules` contract was one repository = one module and a `modules/` folder at a module root was a
compile error. The operator's correction — *"i expect this to be in modules folders, ready for
`npm install @dreamteamer/extensions` cherry picking"* — named the shape that was actually wanted, and
it needed one engine feature rather than a layout trick:

- **engine (0.24.0, unreleased at the time of writing):** a dependency or a `git_modules/` clone whose
  root carries `modules/` is a **bundle** — its sub-modules are discovered on that channel and the root
  itself is never compiled; and a **bare `dreamteamer.disable` entry names a whole module**, dropped at
  discovery so compile, status and install all see the same set. Inline `modules/*` never nest. Seven
  tests in `test/integration/module-packages.test.js`.
- **this repo:** `modules/{assets,contacts,tasks,meetings,recordings,introspection}`, each with its own
  manifest, provenance template, declared `dependencies`/`peerDependencies` and `engine` range; a root
  `package.json` named `@dreamteamer/extensions` carrying the `dreamteamer` marker and `files: [modules]`.
  The three ways in (npm, git module, copy) and the cherry-pick are in the README.

The alternative — one npm package per module, `@dreamteamer/tasks` and so on — was not taken: the
engine discovers only the WORKSPACE's declared dependencies, never transitive ones, so a consumer would
list six packages by hand and the "one install" the operator asked for would not exist. Nothing stops
publishing per-module packages from this monorepo later if a consumer wants one area without the rest.

**This still reverses, for these collections, the recipes decision (129) that domain modules are copied
rather than installed** — and the copy path is kept as the third way in for exactly that reason. The
stated cost of 129 stands: a consumer that wants a different `contacts` forks or upstreams. The funnel,
which every workspace has wanted differently, stays out.

### the module boundaries, and the one the gate caught

`assets ← contacts ← meetings ← recordings`, `tasks ← meetings`, `introspection` alone; `contacts`
peers `meetings` (its `recent_meeting`). The first draft had `meetings` hand-declare its `recordings`
mirror with `x-inverse-of` and peer `meeting-recordings` — the compiles-alone gate refused `meetings`
without `recordings` ("there is no collection meeting-recordings"), because a peer excuses a reference
but not a mirror. The relation now belongs to the module that holds the foreign key: `meeting-recordings.meeting`
carries `x-inverse: recordings`, and the engine stamps `meetings.recordings` onto the meeting collection
only when the recordings module is installed. The transcript-gated bindings (summarise · extract tasks ·
analyse) live in `recordings` for the same reason: they hop through that field.

The npm-channel walk caught a second one: `recordings` declared `local-assets` for its 1.6 GB of model
weights, and compile refuses a local asset under `node_modules/` (npm owns that folder — `npm ci` wipes it).
The declaration is gone; the transcription script takes `TRANSCRIBING_MODELS_DIR` instead, so the weights
can live outside the package on the npm channel, and beside the skill on the git and copy channels.

## what is in, what is out, and the closure

The nine unprefixed collections (across five modules) are the transitive closure of the ask: `contacts` needs `companies`
and `assets` (avatars, logos); the meeting chain needs `contacts`, `companies`, `tasks` and all five
`meeting-*` collections; `meeting-analyses` needs `tasks`. Two fields were cut to close it:
`companies.clients` and `companies.leads` (inverse refs into the absent funnel), and
`contacts.source_person_id` (a migration artifact of the source vault).

"files" is not a collection anywhere in the source vault and none was invented: it is the **file
convention** — `${env:FILES_FOLDER}` and `${env:INBOX_FOLDERS}` as declared template variables, the
two ingest skills that move bytes through them, and `codec: file` assets.

`tasks.lane` lost its enum. The six values were the source vault's own module list (Finance, Family,
Content, Services…), and the six per-lane board views with them. The field stays as a free string —
the extension's kanban groups rows by any field, not only an enum — and the descriptor says how a
consumer closes the set. Introspection arrived whole from `modules/introspection` (20 collections, the
skill, the command, nine views, the guard, the tests) and is one module of the six.

Skills in: `working-with-tasks` · `working-with-tags` · `fetching-meetings` · `preparing-for-meetings`
· `analyzing-meetings` · `ingesting-recordings` · `ingesting-meeting-screenshots` ·
`transcribing-recordings` · `scraping-contacts` · `running-introspectives`. Skills out, and why:
`using-google-workspace` (a toolbelt capability; the one file the meeting sync needs, `gcal.mjs`, has
only Node built-in imports and moved into `fetching-meetings/bin`), `browsing-as-account` (12 MB, a
machine's own browser profiles), `using-notebooklm`, `expert-social-marketing`, `working-with-routines`
(the `routines` collection was not asked for), `developing-dreamteamer`, `managing-git-and-claude-accounts`,
`querying-etherscan`, `querying-ai-subscription-usage-and-quota` (all bound to one machine or one
vault). Commands out: `/update-engagement-and-activity` (funnel), `/create-daily-plan` (`daily-plans`),
`/publish-engine`, `/publish-extension`.

## the leak gate

Three layers, and all three ran before the first push:

1. **a name grep** over the whole tree for the operator's names, every client and colleague name that
   appeared in the source (as listed in the vault's private `leak-scan.sh` plus the ones found in this
   extraction), the source vault's own names (the gate test spells them), `/Users/` paths and real
   email domains — every hit rewritten to the synthetic cast or to a measurement without its source;
2. **a Hebrew codepoint scan**, allow-listed to the four places where Hebrew is the subject (README);
3. **the vault's own `leak-scan.sh`**, worktree and history modes, from the private repo that holds
   the client names — it cannot ship here.

Two things were deleted outright rather than scrubbed: `scraping-contacts/references/harvest-photos-prompt.md`
(a one-off prompt listing ~100 real people) and a Drive folder id hard-coded in the screenshot scanner
(install-specific; the destination is now derived by name under `${env:FILES_FOLDER}` only).

## the git_modules root rule, applied to every script

The introspection module learned on 2026-09-08 that a clone under `git_modules/` with its own lockfile
gets mistaken for the workspace by a "walk up to `package-lock.json`" resolver. Four scripts in the CRM
half carried that resolver without the fix (`ingesting-recordings/bin/detect.mjs`,
`ingesting-meeting-screenshots/bin/detect.mjs`, `fetching-meetings/bin/touch-contacts.mjs`,
`scraping-contacts/bin/import-avatars.mjs`) — harmless inline in the source vault, live the moment this
module is consumed. All four now skip a candidate directly inside `git_modules/`, and
`tests/resolvers-skip-git-modules.test.mjs` fails on any future resolver that does not. This repo also
gitignores `package-lock.json`.

## verification

- the package's own `npm test` — structure, compiles-alone (each module in a virgin workspace with
  only its declared dependencies, on the pinned engine), the leak gate, the resolver rule, and every
  module's suite — standalone and from a consuming workspace;
- the npm channel walked on the engine clone: `npm pack` → install the tarball into a virgin workspace
  → six modules discovered → `disable` two → four; and the git channel the same way;
- the three leak layers above.

Counts and exit codes as measured are in the source vault's decision log for 2026-09-09.

## deferred, in order

1. releasing engine 0.24.0 (the bundle discovery) and publishing the package to npm — both are the operator's go, never an agent's;
2. carrying the source vault's future changes across hunk by hunk (no sync script, by design);
3. per-module npm packages from this monorepo, if a consumer ever wants one area without the install;
4. the funnel (`clients`/`leads`) as a seventh module, if it stabilises.
