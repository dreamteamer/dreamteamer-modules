# wikis — a notebook on top of a folder, and NotebookLM demoted to an adapter

**Status:** designed and built 2026-09-11 in one unattended pass. Records the decisions that are not
visible in the tree, the states of the completeness marker, and the exact line where the local
adapter stops.

## the ask

> implement notebook module locally, each notebook points to many wikis. wiki is a collection of md
> sources, can implement entire notebooklm api (see actual interface) on top of disk, test benchmark
> with [a real] notebook, download all sources, persist source completeness marker to track incomplete
> sources that need further scraping. notebook functionality becomes 0 prerequ. notebooks module
> after this should maintain similar posture, but implementing two adapters, google notebooklm as
> extra. re knowledgebase serialize as folder with internal structure md files / folders

(One word redacted: the ask named a live client corpus to benchmark against, and no client name
belongs in this repo. It is "a real notebook" throughout, and the numbers it produced keep their
digits and lose their subject.)

Five things, and the fourth is the load-bearing one. A corpus that is half downloaded and *looks*
finished is the failure this whole design is against.

## what was read

`modules/notebooks/` entire (one collection, one skill, two commands, two bindings, one view, a
README), `bin/notebook.mjs` (380 lines: `persona`, `restore`, `capture`), `bin/extensions.mjs`'s
dispatch, and the real vendor surface — `notebooklm --help` plus every group and command help on
**notebooklm-py 0.7.3**, enumerated before anything here was designed. That surface:

| area | commands |
|---|---|
| session | `login` `use` `status` `clear` `doctor` `auth` `completion` |
| notebooks | `list` `create` `delete` `rename` `summary` `metadata` |
| chat | `ask` `configure` `history` |
| `source` | `list` `add` `add-drive` `add-research` `get` `fulltext` `guide` `stale` `wait` `clean` `delete` `delete-by-title` `rename` `refresh` |
| `artifact` | `list` `get` `rename` `delete` `export` `poll` `wait` `retry` `suggestions` |
| `note` | `list` `create` `get` `save` `rename` `delete` |
| `share` · `research` · `profile` · `agent` · `skill` · `language` | account and plumbing groups |
| generate / download | `audio` `cinematic-video` `data-table` `flashcards` `infographic` `mind-map` `quiz` `report` `revise-slide` `slide-deck` `video` |

Two facts out of that read shaped the design. `source fulltext` takes `--format markdown` and
`-o FILE`, and **its `text` mode truncates at 2,000 characters** — so a fetch can succeed and still
be short, which is a state, not an error. And `source list --json` gives `index · id · title · type ·
url · status`, which is a complete inventory *before* a single byte is downloaded — so the folder
can be laid out complete-and-empty first, and filled second.

## the shape: a wiki is a folder, and every source is a file in it

```
${env:FILES_FOLDER}/wikis/<wiki-id>/
  wiki.yaml                                   what this folder is, when nothing else is around
  sources/
    001--share-based-payments.md              <nn>--<slug>.md — the number IS the corpus order
    002--comparing-two-standards.md
    regulation/031--circular-on-vesting.md    a section is a subfolder; the number stays global
  notes/                                      reserved; see "not in this pass"
```

A source file is frontmatter plus body — the same shape as a `codec: md, shape: file` record,
deliberately, just outside `data/`:

```markdown
---
kind: url
ref: https://northwind.example/roadmap/share-based-payments
title: 3.2 Share-Based Payments
adapter: notebooklm
upstream_id: 70ad5e21-…
fetched_at: 2026-09-11T09:12:04.000Z
completeness: complete
bytes: 48211
---

# 3.2 Share-Based Payments
…
```

**Why a tree and not a flat folder.** Three reasons, in the order they bite. The corpus this was
benchmarked on holds **129 sources**; flat, that is a directory nobody reads twice. Markdown's own
cross-links only work when the thing they point at is a real relative path, so a tree is what makes
one source able to cite another. And the number prefix carries the *order* — NotebookLM numbers
sources by add order, and `restore` replays that order — so `ls` is the order, with no manifest
lookup and no second copy of the ordering to disagree with the first. Gaps after a delete are honest
and are left alone.

**Why `wiki.yaml` is thin.** Identity, adapter, upstream, a persona, and the counts as of the last
sync. It holds nothing per-source, because a manifest that lists the sources is a second index of a
folder that already indexes itself, and the day the two disagree one of them is quietly wrong. It
exists at all for one reason the vault learned the expensive way: a folder found without its record
must be able to say what it is.

## the completeness marker

**It lives in the frontmatter of the source file itself**, and nowhere else. The file and its marker
cannot then diverge: copying the folder copies the truth, deleting the file deletes the claim, and
`grep -l 'completeness: pending'` is a fallback that works with no tooling at all.

**Every source is always a file, even one nothing has fetched yet.** That is the whole trick. A
source that has never been downloaded is a *stub* — frontmatter, no body, `completeness: pending` —
so the folder is the complete inventory from the first second, and "the corpus looks complete"
cannot be faked by a source simply being absent. Absence is what the old shape would have been, and
absence is invisible.

Five states. Each one is named by the **observation that distinguishes it from its neighbour**, and
none was invented for symmetry:

| state | the observation |
|---|---|
| `pending` | no fetch has been attempted — `fetched_at` is absent. The stub, and what a locally-added URL starts as. |
| `failed` | a fetch was attempted and the adapter exited **non-zero**. `reason` carries the adapter's own first stderr line. |
| `empty` | the fetch exited **0** and returned **fewer than 256 bytes** of body. The route works, the content is not there — a paywall, a JS-only page, a Drive doc the login cannot read. Distinct from `failed` because the remedy differs: `failed` says retry, `empty` says the route is wrong. |
| `partial` | the fetch exited 0 and something **declared it truncated** — `--format text`'s 2,000-character cap, or a known `expected_bytes` larger than what landed. Distinct from `complete` because the remedy is resume, not retry. |
| `complete` | exited 0, at least 256 bytes, nothing reported truncation. |

256 is a threshold, not a law: `--min-bytes` moves it, and the number is on the record of every file
it judged (`bytes`), so a re-classification never needs a re-download.

**"Find everything still incomplete" is one command:**

```
npx dt-extensions wiki incomplete            # every wiki; exit 1 if anything is not complete
npx dt-extensions wiki incomplete <id> --json
```

It walks the folders and reads frontmatter — the authority, never a cache. It **exits 1 when
anything is short**, so it gates a pipeline, and it prints `<wiki>/<file> · <state> · <reason>` so
the next scraping pass has its worklist without a second query.

The `wikis` **record** carries `sources_total`, `sources_complete`, `sources_incomplete` and
`synced_at` as a rollup. That is a cache and is labelled one in its own field descriptions: it exists
so a machine with no `FILES_FOLDER` mounted can still answer "which corpus is unfinished", and
`wiki verify` re-derives it from the folder and **names the drift** rather than hiding it.

## the collections — one new, two new fields, and no migration

**One new collection, `wikis`, in `modules/notebooks`.** Not a new module: the operator's ask was
that the notebooks module "maintain similar posture" with two adapters, so both collections stay in
one module and the `notebooks.wikis` reference needs no peer declaration.

Why a collection and not an array on `notebooks` — the three leanness questions:

- **Does the engine read it?** No. It is a module collection, which is the right layer for it; core
  knows entity kinds and `repos` and nothing else, deliberately.
- **Is this a recipe creeping into core?** No — nothing here goes near `dreamteamer` itself.
- **Could a plain field do it?** No, and this is the argument. A wiki is **shared**: the operator's
  own sentence is "each notebook points to many wikis", and the inverse is true too — one reference
  corpus serves several notebooks. An array entry cannot be shared, so N notebooks would carry N
  copies of the same folder path and the same sync state. And a wiki has a **lifecycle of its own**
  — it is pulled, re-pulled, verified, archived — which needs somewhere to live that is not inside
  whichever notebook happened to mention it first.

**Sources stay FILES, not records.** This is the central modelling call and it goes the other way.
129 sources for one corpus would be 129 git-tracked records indexing a folder that already indexes
itself, and their bytes could never be committed anyway — this repo's carve-out for committed
content is 200 KB *drawables*, and a downloaded corpus is neither small nor a drawable. The file IS
the record: frontmatter and body, the exact shape the engine's own `md`/`file` codec uses. What is
lost is `dt list` over sources; what replaces it is `wiki incomplete` and `wiki status`, one command
each, plus the rollup on the `wikis` record for the questions the record layer must answer offline.

**Two new fields on `notebooks`:**

- `wikis` — an array of `x-reference: wikis`. This field *is* the operator's sentence.
- `adapter` — `local | notebooklm`, **with no default**, and that is deliberate. A default of
  `notebooklm` would contradict "notebook functionality becomes 0 prerequ"; a default of `local`
  would silently relabel every existing record. Absent means **derived**, by a pure rule that is
  tested (`adapterOf`): `notebook_id` set → `notebooklm`; otherwise → `local`. The field exists only
  to override the derivation — which is needed exactly once, when a notebook that was restored to
  NotebookLM should stop being served from it.

**What migrates: nothing.** Existing records carry `notebook_id`, `sources[]` and `chat`; every one
of those keeps its meaning and its verbs. `notebook restore` and `notebook capture` are untouched,
`adapterOf` reports `notebooklm` for them because `notebook_id` is set, and the new fields are
optional. Growing a wiki out of an existing record is `wiki pull <record-id>` — additive: it writes
a new `wikis` record and appends its id to `notebooks.wikis`. No record is rewritten, no field is
removed, and a workspace that never runs a `wiki` verb sees no change at all.

## the adapter boundary, verb by verb

One interface, two implementations. `bin/notebook.mjs` remains the NotebookLM side; `bin/wiki.mjs`
is the local side; `lib/wiki.mjs` holds the rules both are judged by.

| interface verb | notebooklm | local (disk) |
|---|---|---|
| `create` | `create <title> --json` | `wiki init` — mkdir, write `wiki.yaml` |
| `list` | `list --json` | scan the wikis root |
| `metadata` | `metadata --json` | `wiki show` — `wiki.yaml` + live counts |
| `rename` | `rename --json` | rewrite `title` in `wiki.yaml` |
| `delete` | `delete -y` | ⚠ deliberately **not implemented** — `rm -r` is a shell command a person runs looking at it |
| `source list` | `source list --json` | walk `sources/`, read frontmatter |
| `source add` | `source add --type …` | `wiki add` — write the file, or a `pending` stub |
| `source get` | `source get --json` | read the frontmatter |
| `source fulltext` | `source fulltext -f markdown` | read the body |
| `source rename` | `source rename` | rewrite `title` (the filename is left; the number is the key) |
| `source delete` | `source delete` | unlink |
| `source refresh` | `source refresh` | `wiki pull --refresh` through the upstream adapter |
| `source stale` | `source stale --json` | `fetched_at` against `--max-age` |
| `configure` | `configure --persona` | store `persona` in `wiki.yaml` |
| — | — | `wiki search` · `wiki outline` · `wiki status` · `wiki incomplete` · `wiki verify` — no NotebookLM equivalent |

**What the local adapter CANNOT do, stated as a cost rather than faked:**

- **`ask`** — answering a question over the corpus needs a model. A local implementation costs an
  embedding index and an inference endpoint: an API key and a network call, which is precisely the
  prerequisite this design exists to remove. What it does instead is `wiki search <pattern>`, which
  returns `<file>:<line>` hits with the matching text — citations, mechanically true — and then hands
  the folder to the coding agent that is already reading it. **That agent IS the model.** That is not
  a consolation prize; it is why "0 prerequisites" is achievable at all.
- **`summary`** — same reason. `wiki outline` gives the mechanical substitute: every source's title
  and its `#`/`##` headings, in corpus order. It is a table of contents, and it does not pretend to
  be an insight.
- **`generate` / `download` (audio, video, slide-deck, quiz, report, …)** — Google's generation, full
  stop. **UNAVAILABLE**, with no local substitute offered, because a fake one would be worse than
  none. The cost of having it is the NotebookLM adapter, i.e. a Google login.
- **`source add-research` / `research`** — needs web search. **UNAVAILABLE**, same terms.
- **`ask --save-as-note` / `history`** — a folder has no conversation. Not applicable rather than
  missing.
- **`share`, `language`, `profile`, `auth`, `login`** — account plumbing. A folder's sharing is the
  filesystem's and its git remote's; there is nothing to implement.

**And one the local adapter cannot do that is worth being loud about: it fetches no URL.** This
package has zero runtime dependencies and adding an HTML-to-markdown converter to it is not a price
worth paying for a verb the notebooklm adapter and any agent's own fetch tool both already do. So
`wiki add <id> <url> --kind url` writes a **stub marked `pending`** and says so. That is not a
weakness of the marker; it is the marker earning its keep on its very first use.

## the CLI

```
npx dt-extensions wiki init <id> [--title <t>]
npx dt-extensions wiki list [--json]
npx dt-extensions wiki show <id> [--json]
npx dt-extensions wiki add <id> <ref> [--kind url|file|text] [--title <t>] [--section <s>]
npx dt-extensions wiki status [<id>] [--json]
npx dt-extensions wiki incomplete [<id>] [--json]           exit 1 when anything is short
npx dt-extensions wiki verify [<id>]                        re-derive markers and rollups, name drift
npx dt-extensions wiki search <id> <pattern> [--json]
npx dt-extensions wiki outline <id>
npx dt-extensions wiki pull <record-id|--notebook <uuid>> [--wiki <id>] [--refresh] [--limit N] [--dry-run]
```

`wiki pull` is the bridge and the benchmark in one: it reads a live notebook's source list, lays the
whole folder out as stubs **first**, then fetches each source's markdown and classifies it. It is
resumable by construction — a source already `complete` is skipped unless `--refresh` — which is the
practical consequence of putting the marker on disk rather than in a run log.

`bin/extensions.mjs` gains a `wiki` verb beside `notebook`, dispatched the same way, and its
unknown-verb message lists it. The pure rules live in `lib/wiki.mjs` and are what the tests exercise:
`classify` · `adapterOf` · `sourceFileName` · `parseSource`/`renderSource` · `summarise` ·
`pullPlan` · `outline` · `searchBody` · `wikiPaths` · `renderTemplate`.

⚠ `lib/wiki.mjs` carries its own `${env:…}` renderer rather than importing `bin/notebook.mjs`'s
private one. Two reasons: `lib/` must not depend on `bin/`, and `bin/notebook.mjs` is a file another
session may hold. The duplication is ~8 lines and is the same trade this package already makes for
its per-module provenance templates — duplication you can cherry-pick beats a dependency you must
import.

⚠ **`lib/wiki.mjs` reads `.env` for values, which the doctor deliberately never does.** The
distinction: the doctor's rule is that a *value* never reaches an output, and it holds — a `wiki`
verb resolves `FILES_FOLDER` into a path it is about to write to, on the operator's own machine.
Without this, `${env:FILES_FOLDER}` renders only when the variable happens to be exported, which is
almost never in a `npx` call.

## the benchmark, and the two things it changed

A real 129-source corpus, pulled live through the notebooklm adapter into a scratch folder. Numbers
are in the final report; the corpus, its subject and its account are not, and its bytes never entered
this repo.

| | |
|---|---|
| sources in the upstream notebook | **129** (86 web pages, 34 markdown, 9 PDF) |
| files written | **129** — the folder is the inventory, laid out as stubs before any byte was fetched |
| wall clock | **370 s** (~2.9 s per source, one vendor call each after the format was settled) |
| bytes on disk | **15.4 MB** — all of it under `FILES_FOLDER`, none of it in any repo |
| `complete` | **127** |
| `empty` | **2** — both exited 0 and returned 0 bytes; both are non-latin URLs the vendor's extractor could not read. The route is wrong, not the attempt, and `wiki incomplete` names both with their URL and exits **1** |
| `failed` · `partial` · `pending` | **0** each |
| re-running | plans 129 steps, **2 to fetch**, 127 skipped as already complete — resumable because the marker is on disk |

Two defects came out of RUNNING it that no fixture would have found, and both are now
rules with tests:

**1. The vendor reports failure as a JSON payload on STDOUT, and sometimes at exit 0.** The first
benchmark run marked all 129 sources `failed` with the reason `Command failed: notebooklm --quiet
source fulltext ...` — the command line echoed back, naming nothing — because the code branched on
the exit code and `stderr` was empty. What the vendor actually answered, verbatim (notebooklm-py
0.7.3, 2026-09-11):

```json
{"error": true, "code": "UNEXPECTED_ERROR",
 "message": "Unexpected error: The 'markdown' format requires the 'markdownify' package. Install it with: pip install 'notebooklm-py[markdown]'"}
```

— exit **2** with `-o`, exit **0** without it, `stderr` empty in both cases. So `vendorResult` reads
the PAYLOAD first, whatever the exit code says, and the recorded reason now names its own fix in one
sentence. And since `--format markdown` needs an extra a plain `uv tool install notebooklm-py` does
not bring, the fetch falls back to `--format text` **for that one error and no other** — retrying a
real failure in a lossier format is how a bad answer gets written down as a good one. The fallback
keeps the content (with `-o` the 2,000-character cap does not apply) and loses headings, tables and
links; the file records `format: text` and the run prints how many were degraded, with the fix.

**2. `failed` and `partial` are the two states a FILE cannot re-derive**, and `wiki verify` must
leave them alone. The exit code and the truncation flag are observations of the FETCH and neither
survives on disk; re-deriving from the byte count would have promoted a source truncated at 2,000
bytes to `complete` — inventing a finished corpus, which is precisely the failure this module exists
against — and demoted a failed fetch to `empty`, losing its reason with it. Verify now re-derives
only the `pending`/`empty`/`complete` axis, which IS a byte count, says how many it left alone, and
names the refetch as the only thing that can observe the other two.

## tests — the assertion that proves each capability

`tests/wiki-model.test.mjs`, over the pure rules, each case failing without the change:

- `classify` returns each of the five states from the observation that defines it, and **`partial`
  rather than `complete` for a truncated fetch** — the case that makes the marker worth having.
- the 256-byte floor moves with `--min-bytes`, and a re-classification needs no re-download.
- `adapterOf`: `notebook_id` → `notebooklm`; bare record → `local`; explicit field wins over both.
- `sourceFileName` numbers globally, slugs the title, and falls back to the index when a title slugs
  to nothing.
- `parseSource`/`renderSource` round-trip a body that itself contains a `---` line.
- `pullPlan` keeps corpus order, skips what is already `complete`, and stops skipping under
  `--refresh`.
- `summarise`, `outline`, `searchBody`.
- `vendorResult`: an error payload on stdout is an error **even at exit 0**, the vendor's own
  message survives as the reason, and `MARKDOWN_EXTRA_MISSING` matches only the one error a
  lossier retry fixes.

`tests/wiki-cli.test.mjs`, over real disk in a temp folder: `init` → `add --kind text` → `add
--kind url` → `status` → `incomplete` **exits 1** with the url named → filling the stub → `incomplete`
**exits 0**. That last pair is the behaviour the whole feature exists for, and it is asserted end to
end without a network call. And the pair that pins defect 2: a `partial` source full of bytes is
NOT promoted to `complete` by `verify --fix`, and a `failed` one is not demoted to `empty`.

The package's existing gates cover the rest for free: `icons` (a unique codicon), `view-columns`
(every column a real field), `modules-structure` (in-module references), `compiles-alone` (the
`notebooks` module alone in a virgin workspace on the pinned engine), `leak-gate`.

## not in this pass, and why

- **`notes/`** — the folder is reserved in the layout and the `note` group is mapped in the table
  above, but no verb writes it yet. Notes are the one part of the NotebookLM surface where disk is
  strictly better than the product (a note there is trapped), so it is worth doing properly rather
  than as a rider on this one.
- **`wiki delete`** — see the table. Removing a corpus is a `rm -r` a person runs while looking at
  the path.
- **A local `ask`** — argued above. It is the line, and it is where the design gets its honesty.
- **Touching `notebook restore` / `capture`** — untouched on purpose. The migration story is
  "nothing", and the cheapest way to keep that true is to not edit the code that reads the old shape.
- **The version bump and the tag.** The tag is the publish, and it is pushed by a person after CI is
  green.
