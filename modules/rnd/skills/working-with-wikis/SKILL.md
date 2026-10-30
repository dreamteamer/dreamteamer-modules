---
name: working-with-wikis
description: use when a body of reference material has to be READ rather than asked — building, filling, checking or searching a wiki (a folder of markdown sources a coding agent greps and cites); mirroring a live NotebookLM notebook's sources onto disk; answering "what still needs scraping"; or deciding whether a notebook should be served locally or through NotebookLM. Owns the completeness marker and the two-adapter rule. Not for NotebookLM command syntax — that is `using-notebooklm` and the vendor skill.
---

# working with wikis

**core principle:** a wiki is a **folder of markdown you can read with `cat`**, and the notebook
capability is built on it so that it has no prerequisite — no account, no login, no network, nothing
to install. NotebookLM is the extra adapter, reached only through `dt-wiki pull`. When a question is
"what does this corpus say", the answer is in files you can open, and **you are the model that reads
them.**

## when to use

Building or filling a corpus · asking what a corpus says · checking whether it is finished ·
mirroring a live notebook onto disk. **Not for:** NotebookLM syntax (`using-notebooklm`, then the
vendor skill), and not for a passing thought or a written document — those are other collections.

## the shape, and the one rule that matters

```
wikis/<wiki-id>/                IN THE REPO — committed, grepped, cited by file:line
  index.md                               what this corpus is: frontmatter, then a person's notes
  sources/
    001--<slug>.md                       <nn> is the CORPUS ORDER, and it is global
    regulation/031--<slug>.md            a section is a subfolder
```

Every source file is frontmatter plus body:

```markdown
---
kind: url
ref: https://northwind.example/roadmap/share-based-payments
title: 3.2 Share-Based Payments
fetched_at: 2026-09-11T09:12:04.000Z
completeness: complete
bytes: 48211
---
```

**Every source is a file, including one nothing has fetched yet.** A source that has never been
downloaded exists as a *stub* — frontmatter, no body, `completeness: pending`. Absence is the one
state a reader cannot see, so the inventory is laid out complete-and-empty first and filled second,
and a half-fetched corpus can never pass for a finished one. **Never delete a stub to "clean up" a
corpus** — that hides exactly what is missing.

## the completeness marker

Five states, each separated from its neighbour by an **observation**, never by a judgement:

| state | what was observed | what it asks of you |
|---|---|---|
| `pending` | nothing has been attempted | fetch it |
| `failed` | the fetch exited non-zero | retry it; `reason` carries the adapter's own words |
| `empty` | exited 0, under 256 bytes | the ROUTE is wrong — a paywall, a JS-only page, a doc this login cannot read. Find another way in; retrying will do the same thing again |
| `partial` | exited 0, something declared it truncated | resume or refetch in a format that does not cap |
| `complete` | exited 0, enough bytes, nothing truncated | nothing |

The marker lives in the frontmatter of the file it judges and nowhere else, so copying the folder
copies it and deleting the file deletes it.

## the commands

```bash
npx dt-wiki init <id> --title "<title>"          # a corpus, and its record
npx dt-wiki add <id> <ref> --kind text|file|url  # one source
npx dt-wiki status [<id>]                        # counts by state
npx dt-wiki incomplete [<id>]                    # what still needs scraping; exit 1 if any
npx dt-wiki ask <id> "<question>" [-n 10]        # the passage that MEANS it — qmd
npx dt-wiki search <id> "<regex>"                # exact words only — grep, instant
npx dt-wiki index [<id>] [--embed]               # register corpora with qmd (once)
npx dt-wiki outline <id>                         # a table of contents, not a summary
npx dt-wiki verify [<id>] [--fix]                # re-derive markers from the files
npx dt-wiki pull <notebook-record> [--refresh]   # mirror a live notebook onto disk
```

## answering a question from a corpus — four passes, and none is optional

**This is the procedure. A single search is not an answer, and the failure it produces is silent.**

A corpus often states a rule in words the asker does not use: a statute never uses the
practitioner's phrase for the idea it defines, so grep for that phrase returns commentaries and not
the statute. The reverse happens too: `ask` can surface commentaries that *use* a rule and rank the
rule itself lower. Each retrieval mode misses what the other finds, which is why the passes below run
in order rather than instead of one another.

**Without `qmd` installed, passes 1 and 4 are unavailable and the procedure becomes passes 2 and 3
only** — grep, read, grep again, widening the vocabulary yourself each time. That is a working
procedure, and every other verb in this module is unaffected. What it costs is passes: the
vocabulary has to come out of your own head, so expect the first grep to miss a question worded the
way an asker phrases it, and recover by re-phrasing — pass 3, run earlier and more often.

**Do not reach for the re-rank by reflex.** `dt-wiki ask` defaults to the hybrid pipeline. The LLM
re-rank finds slightly more but ranks it worse, and costs tens of seconds per novel query against a
fraction of a second for `--lexical`. Cost is dominated by per-invocation model load, not by search,
so **more passes in one invocation beats more invocations.**

**Pass 1 — LOCATE, semantically.** `dt-wiki ask <id> "<the question>"`.
**Name the instrument in the question** — the statute, the standard, the circular, the document.
Retrieval is deterministic per query and sensitive to wording: a question that names the governing
section finds it, and the same question without that clause misses, while still returning
confident-looking results.

**Pass 2 — READ the lines. Never answer from the snippet.**
The snippet is a window a re-ranker chose, and the sentence that *qualifies* a rule — the exception,
the commencement date, the "unless" — sits outside that window as often as inside it. Open each cited
file at the cited line and read around it. A rank is not a fact; a score is not a citation.

**Pass 3 — CONFIRM, lexically.** Take a distinctive phrase you have now actually READ, and
`dt-wiki search <id> "<that phrase>"`.
This is the pass that finds the *other* places the same rule is stated, amended or contradicted.
Semantic retrieval returns the best passage, not all of them. An old rule and its later amendment will
often rank the original text first, and Pass 1 alone hands you the superseded version with total
confidence.

**Pass 4 — WIDEN across corpora.** Re-ask in every other corpus that could bear on it
(`dt-wiki list` names them). A tax conclusion that a market-membership rule overrides, or an
accounting treatment that changes the answer, is exactly what a single-corpus search cannot see.
Corpora are split by subject so a citation says which body of rules it came from.

**Then state it, and state the limits.**
- Every claim carries `<file>:<line>`. A claim without one is a memory, not a finding.
- Run `dt-wiki incomplete` first. A conclusion over a corpus with holes is a conclusion with holes,
  and the holes are named — say so in the answer.
- **When two passes disagree, that is the finding.** Report both with their citations. Do not pick
  the higher-ranked one and move on; a contradiction between a statute and a commentary, or between a
  rule and its amendment, is the most valuable thing a corpus can surface.
- What the corpus does not settle, say it does not settle. It is a corpus, not an authority.

**`dt-wiki ask` prints locations and never an answer.** Nothing in this module synthesises: a corpus
whose value is that a claim can be opened and checked does not get a layer that paraphrases it.

## rules

1. **Answer from the files, and cite them.** `dt-wiki search` gives `<file>:<line>`; open the file
   and quote it. Never answer a question about a corpus from the `wikis` record — that record holds
   where the corpus lives and how finished it is, not what it says.
2. **`dt-wiki incomplete` before you conclude anything.** A conclusion drawn over a corpus where
   `sources_incomplete` is non-zero has holes in it, and the holes are named. Say so in the answer,
   or fill them first.
3. **This package fetches no URL.** `dt-wiki add … --kind url` writes a `pending` stub — there is no
   HTML-to-markdown converter here. Fill it yourself with a fetch tool (write the body under the
   frontmatter, then `dt-wiki verify --fix`), or pull it through a notebook that already holds it.
4. **The rollup on the record is a cache; the folder is the authority.** When the two disagree,
   `dt-wiki verify` is right and the record is stale. Run it with `--fix` and commit the record.
5. **The corpus is committed.** It lives at `wikis/<id>/` in the repo, markdown only, every file with
   frontmatter, `index.md` at the root, so a `<file>:<line>` citation reviews in a diff and opens from
   a bare clone. Scraped PDFs, recordings and scans stay under `${env:FILES_FOLDER}`, and a source
   links to its original only when restoring it would cost real effort or the original holds more
   than the text does. The qmd index is not committed — it lives in `~/.cache/qmd` and is rebuilt
   with `dt-wiki index`.
6. **Generate and research: the local adapter does neither.** It can be asked — `dt-wiki ask` is
   real retrieval — but a generated podcast, a slide deck or a web research pass is the NotebookLM
   adapter's job. Say so and reach for `using-notebooklm`; do not build a substitute. The promise is
   no Google prerequisites, and `qmd` keeps it: on-device, no account, no key, no network.
7. **`dt-wiki pull` is resumable, because of the marker.** A run that dies halfway leaves a folder
   that knows what is missing; re-running skips what is already `complete`. Use `--refresh` only when
   the upstream content itself has changed.
