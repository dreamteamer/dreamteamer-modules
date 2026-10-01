# @dreamteamer/wikis

A **wiki** is a folder of markdown, in the repo, that you can read and grep with nothing installed.
`qmd` (optional, on-device) makes it answerable by meaning. No account, no login, no network.

```bash
npm install @dreamteamer/wikis
npx dreamteamer compile
npx dt-wiki init <id>              # a corpus on a folder
npx dt-wiki search <id> <words>    # grep, instant, needs nothing
npx dt-wiki ask <id> <question>    # by meaning, once qmd is installed
npx dt-wiki incomplete             # exits 1 while any source is still a stub
```

| alone | with others |
|---|---|
| wikis, their sources, search, outline, the completeness gate | **notebooklm** points a `notebooks` record at wikis, and `dt-wiki pull` mirrors a live NotebookLM notebook's sources into a folder here · **search** (`dt-find`) covers the workspace's own records, which this does not |

| needs | for |
|---|---|
| nothing | `search`, `outline`, `incomplete`, `status`, `verify` |
| `qmd` (`npm install -g @tobilu/qmd`, ~2.1 GB of local models once) | `ask`; without it `ask` says so and `search` still works |
| the `notebooklm` CLI and one login | `pull` only |

## the promise, and where it stops

**No Google prerequisites** — no account, no login, no vendor, no network, nothing that can be
rate-limited, deprecated or signed out from under you. That does not mean no software: `qmd` is the
on-device retrieval engine that makes a corpus answerable instead of merely greppable. It runs BM25,
vector search and an LLM re-rank locally through `node-llama-cpp` with GGUF weights on disk — no API
call, no key, works offline. The cost: ~2.1 GB of models once, and an embed that takes minutes for a
corpus of a few dozen documents.

**Why retrieval, when grep is free.** A corpus often states a rule in words the asker does not use —
a statute never uses the practitioner's phrase for it — and grep cannot find what is spelled
differently. `dt-wiki ask` finds the passage by meaning. `dt-wiki search` is still the floor, and
`ask` the layer above it.

**The corpus is committed.** It lives at `wikis/<id>/` in the repo: markdown a coding agent greps
and cites by `file:line`, so a citation opens from a bare clone, from a cloud session, and in a diff.
A corpus is megabytes of text in every clone, so **split a large corpus into several wikis by subject
rather than growing one**; a notebook points at many. Scraped PDFs, recordings and scans stay under
`${env:FILES_FOLDER}`, with a record pointing at them.

**Sources are files, not records.** The file is the record, frontmatter and body; a folder already
indexes itself, so a record per source would be a second index of it. What is lost is `dt list` over
sources; what replaces it is `dt-wiki incomplete` and `dt-wiki status`, plus a rollup on the `wikis`
record that `dt-wiki verify` re-derives from the folder.

**The completeness marker lives in the frontmatter of the file it judges**, and every source is a
file even before anything has fetched it. Five states, each separated from its neighbour by an
observation: `pending` (nothing attempted) · `failed` (non-zero exit; retry) · `empty` (exit 0, under
256 bytes; the route is wrong) · `partial` (exit 0, something declared it truncated; resume) ·
`complete`. `npx dt-wiki incomplete` reads them off disk and exits 1 when anything is short.

**What a folder cannot do:** generate audio, video, slides or quizzes; research the web; hold a
conversation. Those are the `notebooklm` module, which needs a login. `dt-wiki outline` is the
mechanical table of contents; the agent reading the folder is the model. Fetching a URL is not here
either: `dt-wiki add … --kind url` writes a `pending` stub and says so.

**There is no `dt-wiki delete`.** Removing a corpus is a `rm -r` a person runs while looking at the
path, not a verb a script can reach by accident.
