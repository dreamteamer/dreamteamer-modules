---
name: searching-a-workspace
description: use when looking for something in a workspace and grep is not obviously right — a half-remembered record, a question in your own words rather than the corpus's, or "everything we have about X". Owns the grep-vs-retrieval rule and the effort ladder (`dt-extensions find`). Not for searching one assembled corpus of prose — that is `working-with-wikis`.
---

# searching a workspace

**core principle:** *grep is not the weak option and retrieval is not the strong one.* They answer
different questions, each is badly wrong for the other's, and **the choice is decidable before you
search** — from how the question is worded, not from how hard it feels.

## the rule, in one table

Every row is measured. The numbers are in `rnd/experiments/…retrieval-over-the-vault…` and
`…rung-2…` / `…rung-3…`.

| what you have | use | why |
|---|---|---|
| **a phrase you can quote from the corpus** | `grep` / `find --effort 0` | **MRR 1.00 in 9 ms.** The full pipeline scores the SAME in ~22,900 ms — 2,500× for an identical rank-1 answer |
| a symbol, path, field name, id | **`grep`, always** | a synonym is WRONG here, not helpful. Retrieval actively hurts |
| **the idea, but not the words** | `find --effort 2` | lexical recall 0.22 against vector's 0.80 on paraphrase |
| **"everything we have about X"** | `find --effort 3` | retrieval got 3 of 4 with ten slots; the graph got 4 of 4 in 0.347 s |

⚠ **The most expensive mistake is reaching for retrieval on a question you could have grepped**, and
it does not look like a mistake — you get a confident ranked answer, slowly, that grep would have
given you instantly and exactly.

## the ladder

```sh
npx dt-extensions find "<question>" [--effort 0|1|2|3] [-c <collection>] [-n N]
```

**Rung 0 — lexical.** Exact words. Instant, deterministic, needs nothing installed.

**Rung 1 — vector.** Embeddings. Best MRR and recall@1 of any single backend.

**Rung 2 — structured, ONE invocation.** `--lex`, `--vec`, `--hyde`.
⚠ **This rung is a HEDGE and YOU supply the hedge.** The two questions that no backend answers fail
for opposite reasons — one is a *vocabulary* gap (the corpus says "blind"/"session"/"five", you said
"cold"/"agent"/"handful"), the other an *abstraction* gap ("the thing we ship" never names the
artifact). They are rescued by **opposite lanes**, and you cannot tell in advance which you have.

- `--lex` — the words the CORPUS would use. Domain nouns, filenames, the statute or standard.
- `--vec` — the question restated as prose, in the register the documents are written in.
- `--hyde` — one or two sentences of the answer **as if it existed**.

⚠ **Write them DIFFERENT.** Passing the same sentence three times hedges nothing — it asks one
question three ways in one vocabulary, which is the exact failure the rung exists to fix.
⚠ **Do not write `--hyde` from a document you have just read.** That is the answer fed back as the
question, and it proves nothing.

**Rung 3 — close the set through the graph.** Adds the reference the hits AGREE on, then asks the
engine for every record carrying it.
⚠ **Scope it with `-c`.** Measured: unscoped, hits from an unrelated collection crowded out the
records carrying the reference and the rung correctly refused. Scoped, it returned the set exactly.
⚠ **A refusal is a result.** "The hits agree on no reference" means it declined to expand through a
weak plurality, which would hand back a confident set built on one coincidence.

## four things that will bite

1. **`qmd` is OPTIONAL.** Without it rung 0 still works and the rest report unavailable. `npm run
   doctor` warns; nothing fails. Retrieval is a convenience over grep, not a dependency.
2. **The index is PROJECT-LOCAL and derived** — `.qmd/` per repo, gitignored, rebuilt with `qmd
   collection add` + `qmd embed`. ⚠ A fresh clone has an EMPTY index, which answers "no passage
   matched" — indistinguishable from a real miss. Check before believing a negative.
   ⚠ **It is per-repo on purpose**: one shared index is cwd-independent, and a bare search inside one
   workspace returned 20 results from a different private repo. Never re-add cross-repo collections.
3. **Descriptor prose IS the tuning layer.** Each collection's `description` + `use_when` is attached
   as that path's context and reaches the re-ranker. Improving a `use_when` improves retrieval — for
   free, and the same edit improves how an agent picks the collection in the first place.
4. **Output is LOCATIONS, never an answer.** Open each cited line before citing it. A rank is not a
   fact and a score of 89% is not a citation.

## when NOT to use this skill

Searching one assembled corpus of prose you built — that is `working-with-wikis` and `wiki ask`.
The difference is the graph: **records carry references and a corpus of documents does not**, which is
why rung 3 exists here and nowhere else.
