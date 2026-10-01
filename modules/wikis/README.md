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
| wikis, their sources, search, outline, the completeness gate | **notebooklm** points a `notebooks` record at wikis, and `wiki pull` mirrors a live NotebookLM notebook's sources into a folder here · **search** (`dt-find`) covers the workspace's own records, which this does not |

| needs | for |
|---|---|
| nothing | `search`, `outline`, `incomplete`, `status`, `verify` |
| `qmd` (`npm install -g @tobilu/qmd`, ~2.1 GB of local models once) | `ask`; without it `ask` says so and `search` still works |
| the `notebooklm` CLI and one login | `pull` only |

## the promise, and where it stops

**ZERO GOOGLE PREREQUISITES** — no account, no login, no vendor, no network, nothing that can be
rate-limited, deprecated or signed out from under you. It has never meant "no software": `qmd` is
the on-device retrieval engine that makes a corpus answerable instead of merely greppable. It runs
BM25, vector search and an LLM re-rank locally through `node-llama-cpp` with GGUF weights on disk,
no API call, no key, works with the wifi off. The cost is stated rather than discovered: ~2.1 GB of
models once, and a one-off embed (measured: 4,977 chunks from 38 documents in 8m15s).

⚠ **Why retrieval at all, when grep was free.** Measured on a real 38-source legal corpus: the
professional Hebrew term for a statutory lock-up returned NINE grep hits and not one was the statute
that defines it, because the statute never uses that phrase. Through `wiki ask` it comes back at rank
4 of 10, and five of five benchmark questions resolve. A corpus that cannot answer the question it was
built for is not a working capability, however few dependencies it has. `wiki search` is still the
floor, and `wiki ask` the layer above it.

⚠ **The corpus is COMMITTED, and that is the claim.** It sat under `${env:FILES_FOLDER}/wikis/<id>`
until 2026-09-11, on the general rule that bytes stay out of the repo. That rule is about MEDIA, and a
wiki is markdown a coding agent greps and cites by `file:line`. Outside the clone, a bare checkout did
not have the corpus, a cloud session could not reach it, and a citation could not be reviewed in a
diff. The cost is real: a corpus is megabytes of text in every clone, forever. **Split a large corpus
into several wikis by subject rather than growing one**; a notebook points at many. Keep scraped PDFs,
recordings and scans where they were, under `${env:FILES_FOLDER}`, with a record pointing at them.

**Sources are FILES, not records.** One real corpus held 129 sources; as records that is 129
git-tracked files indexing a folder that already indexes itself. The file IS the record, frontmatter
and body. What is lost is `dt list` over sources; what replaces it is `wiki incomplete` and `wiki
status`, plus a rollup on the `wikis` record that `wiki verify` re-derives from the folder.

**The completeness marker lives in the frontmatter of the file it judges**, and every source is a
file even before anything has fetched it. Five states, each separated from its neighbour by an
observation: `pending` (nothing attempted) · `failed` (non-zero exit; retry) · `empty` (exit 0, under
256 bytes; the route is wrong) · `partial` (exit 0, something declared it truncated; resume) ·
`complete`. `npx dt-wiki incomplete` reads them off disk and exits 1 when anything is short.

**What a folder CANNOT do, stated as a cost rather than faked:** generate audio, video, slides or
quizzes; research the web; hold a conversation. Those are the `notebooklm` module, which is a login.
`wiki outline` is the mechanical table of contents; the agent reading the folder is the model.
Fetching a URL is not here either: `wiki add … --kind url` writes a `pending` stub and says so.

**`wiki delete` does not exist.** Removing a corpus is a `rm -r` a person runs while looking at the
path, not a verb a script can reach by accident.
