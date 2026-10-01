---
name: working-with-wikis
description: use when a body of reference material has to be READ rather than asked — building, filling, checking or searching a wiki (a folder of markdown sources a coding agent greps and cites); mirroring a live NotebookLM notebook's sources onto disk; answering "what still needs scraping"; or deciding whether a notebook should be served locally or through NotebookLM. Owns the completeness marker and the two-adapter rule. Not for NotebookLM command syntax — that is `using-notebooklm` and the vendor skill.
---

# working with wikis

**core principle:** a wiki is a **folder of markdown you can read with `cat`**, and the notebook
capability is built on it so that it has NO prerequisite — no account, no login, no network, nothing
to install. NotebookLM is the *extra* adapter, reached only through `wiki pull`. When a question is
"what does this corpus say", the answer is in files you can open, and **you are the model that reads
them.**

## when to use

Building or filling a corpus · asking what a corpus says · checking whether it is finished ·
mirroring a live notebook onto disk. **Not for:** NotebookLM syntax (`using-notebooklm`, then the
vendor skill), and not for a passing thought or a written document — those are other collections.

## the shape, and the one rule that matters

```
wikis/<wiki-id>/                IN THE REPO — committed, grepped, cited by file:line
  wiki.yaml                              what this folder is, found without its record
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

⚠ **EVERY SOURCE IS A FILE, INCLUDING ONE NOTHING HAS FETCHED YET.** A source that has never been
downloaded exists as a *stub* — frontmatter, no body, `completeness: pending`. That is the rule the
whole design turns on: absence is the one state a reader cannot see, so the inventory is laid out
complete-and-empty first and filled second, and a half-fetched corpus can never pass for a finished
one. **Never delete a stub to "clean up" a corpus.** Deleting it is exactly the failure.

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
copies the truth and deleting the file deletes the claim.

## the commands

```bash
npx dt-extensions wiki init <id> --title "<title>"          # a corpus, and its record
npx dt-extensions wiki add <id> <ref> --kind text|file|url  # one source
npx dt-extensions wiki status [<id>]                        # counts by state
npx dt-extensions wiki incomplete [<id>]                    # ⇦ what still needs scraping; exit 1 if any
npx dt-extensions wiki ask <id> "<question>" [-n 10]        # ⇦ the passage that MEANS it — qmd
npx dt-extensions wiki search <id> "<regex>"                # exact words only — grep, instant
npx dt-extensions wiki index [<id>] [--embed]               # register corpora with qmd (once)
npx dt-extensions wiki outline <id>                         # a table of contents, not a summary
npx dt-extensions wiki verify [<id>] [--fix]                # re-derive markers from the files
npx dt-extensions wiki pull <notebook-record> [--refresh]   # mirror a live notebook onto disk
```


## answering a question from a corpus — four passes, and none is optional

⚠ **This is the procedure. A single search is not an answer, and the failure it produces is silent.**

Measured on a real 38-source legal corpus, 2026-09-11: the professional Hebrew term for a statutory
lock-up returned **nine grep hits, none of them the statute that defines it** — because the statute
spells the same idea a different way and never uses the practitioner's phrase. The same question through `wiki ask` returns it at rank 4. The reverse also
happened: `ask` surfaced three commentaries that *use* a rule and ranked the rule itself fifth. Each
retrieval mode misses what the other finds, which is why the passes below run in order rather than
instead of one another.

⚠ **WITHOUT `qmd` INSTALLED, passes 1 and 4 are unavailable and the procedure becomes passes 2 and 3
only** — grep, read, grep again, widening the vocabulary yourself each time. That is a WORKING
procedure, not a broken one, and it is why `qmd` is optional: `npm run doctor` warns, nothing fails,
and every other verb in this module is unaffected. **What it costs you is passes, and the vocabulary
has to come out of your own head.** Measured over 300 markdown records with 15 questions worded the
way an asker phrases them before knowing the corpus's words: **lexical recall 0.22, vector 0.80.**
So expect to miss roughly four questions in five on the first grep, and to recover by re-phrasing —
which is exactly what pass 3 is, run earlier and more often.

⚠ **And do not reach for the re-rank by reflex.** `wiki ask` defaults to the hybrid pipeline; on the
same fixture the LLM re-rank found slightly more (recall 0.85 vs 0.80) and ranked it WORSE (MRR 0.53
vs 0.62, and it halved recall@1), while costing 24-25s per novel query against roughly 0.1s for a
lexical one. Cost is dominated by per-invocation model load, not by search, so **more passes in one
invocation beats more invocations.**

**Pass 1 — LOCATE, semantically.** `wiki ask <id> "<the question>"`.
⚠ **Name the instrument in the question** — the statute, the standard, the circular, the document.
Measured: 4/4 hits when the query named the governing section, 2/2 misses with that clause removed —
same corpus, same run, same wording otherwise. Retrieval is deterministic per query and *sensitive to wording*; a vague question under-retrieves
quietly and returns five confident-looking results anyway.

**Pass 2 — READ the lines. Never answer from the snippet.**
The snippet is a window a re-ranker chose, and the sentence that *qualifies* a rule — the exception,
the commencement date, the "unless" — sits outside that window as often as inside it. Open each cited
file at the cited line and read around it. A rank is not a fact; a score of 93% is not a citation.

**Pass 3 — CONFIRM, lexically.** Take a distinctive phrase you have now actually READ, and
`wiki search <id> "<that phrase>"`.
This is the pass that finds the *other* places the same rule is stated, amended or contradicted.
Semantic retrieval returns the best passage; it does not return all of them. A 2003 rule amended in
2024 will usually rank the 2003 text above the amendment, and Pass 1 alone will hand you the
superseded version with total confidence.

**Pass 4 — WIDEN across corpora.** Re-ask in every OTHER corpus that could bear on it
(`wiki list` names them). A tax conclusion that a market-membership rule overrides, or an accounting
treatment that changes the answer, is exactly what a single-corpus search cannot see. The corpora were
split by subject precisely so a citation says which body of rules it came from.

**Then state it, and state the limits.**
- Every claim carries `<file>:<line>`. A claim without one is a memory, not a finding.
- ⚠ Run `wiki incomplete` first. A conclusion over a corpus with holes is a conclusion with holes, and
  the holes are named — say so in the answer.
- ⚠ **When two passes disagree, that is the finding.** Report both with their citations. Do not pick
  the higher-ranked one and move on; a contradiction between a statute and a commentary, or between
  the 2003 text and its 2024 amendment, is the most valuable thing a corpus can surface.
- What the corpus does not settle, say it does not settle. It is a corpus, not an authority.

⚠ **`wiki ask` prints LOCATIONS and never an answer, deliberately.** Nothing in this module
synthesises. A corpus whose entire value is that a claim can be opened and checked must not grow a
layer that paraphrases it — the paraphrase is exactly what made the answer uncheckable before.

## rules

1. **Answer from the files, and cite them.** `wiki search` gives `<file>:<line>`; open the file and
   quote it. Never answer a question about a corpus from the `wikis` record — that record holds where
   the corpus lives and how finished it is, not what it says.
2. ⚠ **`wiki incomplete` before you conclude anything.** A conclusion drawn over a corpus where
   `sources_incomplete` is non-zero is a conclusion drawn over a corpus with holes in it, and the
   holes are named. Say so in the answer, or fill them first.
3. **This package fetches no URL.** `wiki add … --kind url` writes a `pending` stub deliberately —
   there is no HTML-to-markdown converter here and there will not be one. Fill it yourself with a
   fetch tool (write the body under the frontmatter, then `wiki verify --fix`), or pull it through a
   notebook that already holds it.
4. **The rollup on the record is a cache; the folder is the authority.** When the two disagree, `wiki
   verify` is right and the record is stale. Run it with `--fix` and commit the record.
5. **The corpus IS committed, and that is the point.** It lives at `wikis/<id>/` in the repo, markdown
   only, every file with frontmatter, `index.md` at the root. That is what makes a `<file>:<line>`
   citation reviewable in a diff and openable from a bare clone. ⚠ The exception is narrow and holds:
   scraped PDFs, recordings and scans stay under `${env:FILES_FOLDER}`, and a source links to its
   original only when restoring it would cost real effort or the original holds more than the text
   does. The qmd index is NOT committed — it lives in `~/.cache/qmd` and is rebuilt with `wiki index`.
6. **Generate and research: the local adapter does neither, and does not pretend to.** It can now be
   ASKED — `wiki ask` is real retrieval — but a generated podcast, a slide deck or a web research pass
   is the EXTRA adapter's job. Say so and reach for `using-notebooklm`. Do not build a substitute.
   ⚠ The module's promise was never "no software": it is **zero Google prerequisites**. `qmd` keeps
   that promise exactly — on-device, no account, no key, no network, works with the wifi off.
7. **`wiki pull` is resumable and the marker is why.** A run that dies halfway leaves a folder that
   knows what is missing; re-running skips what is already `complete`. Use `--refresh` only when the
   upstream content itself has changed.
