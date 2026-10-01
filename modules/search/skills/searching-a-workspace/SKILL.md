---
name: searching-a-workspace
description: use when looking for something in a workspace and grep is not obviously right — a half-remembered record, a question in your own words rather than the corpus's, or "everything we have about X". Owns the grep-vs-retrieval rule and the effort ladder (`npx dt-find`). Not for searching one assembled corpus of prose — that is `working-with-wikis`.
---

# searching a workspace

**core principle:** *grep is not the weak option and retrieval is not the strong one.* They answer
different questions, each is badly wrong for the other's, and **the choice is decidable before you
search** — from how the question is worded, not from how hard it feels.

## the rule, in one table

| what you have | use | why |
|---|---|---|
| **a phrase you can quote from the corpus** | `grep` / `dt-find --effort 0` | exact words find it at rank 1 instantly; the full pipeline finds the same answer orders of magnitude slower |
| a symbol, path, field name, id | **`grep`, always** | a synonym is wrong here, not helpful. Retrieval actively hurts |
| **the idea, but not the words** | `dt-find --effort 2` | lexical search misses most paraphrases; embeddings catch most of them |
| **"everything we have about X"** | `dt-find --effort 3` | a ranked list leaves members of the set out; the reference graph returns all of them |

**The most expensive mistake is reaching for retrieval on a question you could have grepped**, and
it does not look like a mistake: you get a confident ranked answer, slowly, that grep would have
given you instantly and exactly.

## the ladder

```sh
npx dt-find "<question>" [--effort 0|1|2|3] [-c <collection>] [-n N] [--ref-field <field>] [--json]
```

With no `--effort`, a fully quoted question runs rung 0 and anything else runs rung 2.

**Rung 0 — lexical.** qmd's exact-word search. Fast and deterministic.

**Rung 1 — vector.** Embeddings. The strongest single backend on a paraphrased question.

**Rung 2 — structured, ONE invocation.** `--lex`, `--vec`, `--hyde`.
**This rung is a HEDGE and YOU supply the hedge.** The questions that no single backend answers fail
for opposite reasons — one is a *vocabulary* gap (the corpus says "blind"/"session"/"five", you said
"cold"/"agent"/"handful"), the other an *abstraction* gap ("the thing we ship" never names the
artifact). They are rescued by **opposite lanes**, and you cannot tell in advance which you have.
All three lanes go in one call because the cost is dominated by loading the model once.

- `--lex` — the words the CORPUS would use. Domain nouns, filenames, the statute or standard.
- `--vec` — the question restated as prose, in the register the documents are written in.
- `--hyde` — one or two sentences of the answer **as if it existed**.

**Write them DIFFERENT.** Passing the same sentence three times hedges nothing — it asks one
question three ways in one vocabulary, which is the exact failure the rung exists to fix.
**Do not write `--hyde` from a document you have just read.** That is the answer fed back as the
question, and it proves nothing.

**Rung 3 — close the set through the graph.** Takes the value the hits AGREE on in one reference
field (`--ref-field`, default `repo`), then asks `dreamteamer list` for every record carrying it.
**Scope it with `-c`.** Unscoped, hits from an unrelated collection can crowd out the records
carrying the reference, and the rung refuses.
**A refusal is a result.** "The hits agree on no reference" means it declined to expand through a
weak plurality, which would hand back a confident set built on one coincidence.

## four things that will bite

1. **Every rung needs `qmd`** (`npm install -g @tobilu/qmd`, fully on-device). Without it `dt-find`
   exits 1 with the install line. `grep` is the route that needs nothing installed.
2. **The index is derived, and `dt-find` does not build it.** Build it with `qmd init`, `qmd collection add`
   and `qmd embed` over the workspace's `data/` folders. An EMPTY or stale index answers as if nothing
   matched, which is indistinguishable from a real miss — check `qmd status` before believing a
   negative. Index only this workspace's folders: a collection from another repo puts its results
   into every search here.
3. **Descriptor prose can tune retrieval.** Attach each collection's `description` + `use_when` as
   that path's qmd context (`qmd context add`) and it reaches the re-ranker. Then improving a
   `use_when` improves retrieval for free, and the same edit improves how an agent picks the
   collection in the first place.
4. **Output is LOCATIONS, never an answer.** Open each cited line before citing it. A rank is not a
   fact and a score is not a citation.

## when NOT to use this skill

Searching one assembled corpus of prose you built — that is `working-with-wikis` and `wiki ask`.
The difference is the graph: **records carry references and a corpus of documents does not**, which is
why rung 3 exists here and nowhere else.
