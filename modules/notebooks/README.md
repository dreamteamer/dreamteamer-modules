# notebooks — what a descriptor cannot say

**`account` is a string, not a reference.** The workspace this was cut from types it as a reference
into an accounts collection; this package ships none, and the structure gate refuses a reference
nobody provides. The fact survives — a notebook is invisible from the wrong Google login, and nothing
can derive which one — as an address or a label. A workspace with an accounts collection re-types the
field in an overlay.

**The vendor skill is a dependency, and it is installed by the vendor.** `notebooklm skill install`
writes `~/.claude/skills/notebooklm/SKILL.md`; `using-notebooklm` here defers to it for every flag
and adds only this workspace's rules. Editing the vendor copy is how it drifts on the next upgrade.

**The record is a spec, and `chat` is write-only by nature.** `sources` and `chat` are what
`notebook restore` plays against a fresh notebook; `notebook capture` can fill `sources` from the live
list but never `chat`, because NotebookLM exposes no read of the persona — a bare `configure` CLEARS it
(measured 2026-09-08, twice). So the persona lives on the record (or in `persona_file`) and flows one
way. A `file` source is a `${env:FILES_FOLDER}/…` template: the record never carries a machine path,
and the verb renders it where it runs and refuses when the var is unset.

**Two things the `@dreamteamer/notebooklm` engine extension owns, deliberately not here:**
`dt notebooklm` (rendering the workspace into a notebook) and the `notebooklm` harness (the
`NOTEBOOKLM.md` persona file compile writes). Neither is in core: install it in the workspace with
`npm i -D @dreamteamer/notebooklm` (it needs dreamteamer 0.31.0 or later). The module sits on top of
both: the record, the rules, and the three `npx dt-notebook` verbs — `persona`, `restore`,
`capture`. An `export` source in a record is `dt notebooklm` re-run against the new notebook, never a
re-implementation, so restoring one needs the package installed.

## the two adapters, and where the local one stops

**`local` is the default, and its promise is ZERO GOOGLE PREREQUISITES** — no account, no login, no
vendor, no network, nothing that can be rate-limited, deprecated or signed out from under you. It has
never meant "no software": it can OPTIONALLY use **`qmd`** (`npm install -g @tobilu/qmd`), the
on-device retrieval engine that makes a corpus answerable instead of merely greppable. qmd runs BM25,
vector search and an LLM re-rank locally through `node-llama-cpp` with GGUF weights on disk — no API
call, no key, works with the wifi off. The cost is stated rather than discovered: ~2.1 GB of models
once, and a one-off embed (measured: 4,977 chunks from 38 documents in 8m15s).

⚠ **Why a prerequisite at all, when grep was free.** Measured on a real 38-source legal corpus: the
professional Hebrew term for a statutory lock-up returned NINE grep hits and not one was the statute
that defines it — the statute never uses that phrase. Through `wiki ask` it comes back at rank 4 of
10, and five of five benchmark questions resolve. A corpus that cannot answer the question it was
built for is not a working capability, however few dependencies it has.

**`wiki search` still needs nothing** and never will: exact words, instant, deterministic. It is the
floor, and `wiki ask` is the layer above it. A `wikis` record is a folder of markdown under
`wikis/<id>` — **in the repo** — `wiki.yaml`, then `sources/<nn>--<slug>.md` nested into
section subfolders, and every verb but one is a folder read or a folder write. No account, no login,
no network, no variable, nothing to install.

⚠ **The corpus is COMMITTED, and that is the claim.** It sat under `${env:FILES_FOLDER}/wikis/<id>`
until 2026-09-11, on the general rule that bytes stay out of the repo. That rule is about MEDIA — a
recording, a scan, a PDF — and a wiki is none of those: it is markdown a coding agent greps and cites
by `file:line`. Outside the clone it cost the three things the local adapter exists for. A bare
checkout did not have the corpus, so *zero prerequisite* was simply false. A cloud session could not
reach it at all, by construction. And a citation could not be reviewed in a diff, followed from a
record, or pinned to a commit — so "the source says X at line 44" was a claim nobody else could check.

The cost is real and is stated rather than discovered: a corpus is megabytes of text, in every clone,
forever. **Split a large corpus into several wikis by subject rather than growing one** — a notebook
points at many, which is why `notebooks.wikis` is a list. Keep scraped PDFs, recordings and scans
where they were, under `${env:FILES_FOLDER}`, with a record pointing at them. `notebooklm` is the EXTRA adapter, and `wiki pull` is the only bridge
between them.

**Which one answers is DERIVED, not defaulted.** `notebooks.adapter` has no default on purpose:
`notebooklm` as a default would contradict the point of the local implementation, and `local` as a
default would silently relabel every record written before wikis existed. Absent means a record with
a `notebook_id` is served upstream and one without is served by its folders. The field exists only to
override that — needed exactly once, when a notebook that was restored upstream should stop being
answered from there.

**Sources are FILES, not records, and that is the modelling call this module turns on.** One real
corpus measured for this release held 129 sources; as records that is 129 git-tracked files indexing
a folder that already indexes itself, and their bytes could never be committed anyway. The file IS
the record — frontmatter and body, the same shape the engine's own `md`/`file` codec uses, just
outside `data/` because a downloaded corpus is content a workspace must not commit. What is lost is
`dt list` over sources; what replaces it is `wiki incomplete` and `wiki status`, one command each,
plus a rollup on the `wikis` record for the questions a machine with no `FILES_FOLDER` mounted still
has to answer. That rollup is a CACHE and its field descriptions say so — `wiki verify` re-derives it
from the folder and names the drift.

**The completeness marker lives in the frontmatter of the file it judges**, and every source is a
file even before anything has fetched it. That stub is the whole trick: absence is the one state a
reader cannot see, so the inventory is laid out complete-and-empty first and filled second. Five
states, each separated from its neighbour by an observation rather than a shade of meaning —
`pending` (nothing attempted) · `failed` (non-zero exit; retry) · `empty` (exit 0, under 256 bytes;
the route is wrong, not the attempt) · `partial` (exit 0, something declared it truncated; resume) ·
`complete`. `npx dt-wiki incomplete` reads them off disk and exits 1 when anything is
short, so it gates a pipeline.

**What the local adapter CANNOT do, stated as a cost rather than faked:**

- **`ask`** — answering over the corpus needs a model, and a local one costs an embedding index and
  an inference endpoint: an API key and a network call, which is exactly the prerequisite this
  adapter exists to remove. `wiki search` gives `<file>:<line>` hits with their text — citations,
  mechanically true — and the folder is then read by the coding agent, which IS the model. That is
  not a consolation prize; it is why "no prerequisite" is achievable at all.
- **`summary`** — same reason. `wiki outline` is the mechanical substitute: every source's title and
  its `#`/`##` headings, in corpus order. A table of contents, and it says so in its own output.
- **`generate` / `download` (audio, video, slide-deck, quiz, report, …)** and **`add-research`** —
  Google's generation and Google's web search. UNAVAILABLE, with no local substitute offered, because
  a fake one is worse than none. The cost of having them is the `notebooklm` adapter, i.e. a login.
- **`history`, `share`, `language`, `profile`, `auth`** — a folder has no conversation, and its
  sharing is the filesystem's and its git remote's. Not applicable rather than missing.
- **Fetching a URL.** This package has zero runtime dependencies and an HTML-to-markdown converter is
  not worth adding for a verb `wiki pull` and any agent's own fetch tool already do. `wiki add …
  --kind url` writes a `pending` stub and says so — the marker earning its keep on its first use.

**`wiki delete` does not exist.** Removing a corpus is a `rm -r` a person runs while looking at the
path, not a verb a script can reach by accident.
