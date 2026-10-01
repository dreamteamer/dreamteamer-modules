---
name: find
description: find something in this workspace's own records — pick grep or retrieval by how the question is worded, not by how hard it feels, and close a set through the reference graph
argument-hint: <question> [--effort 0|1|2|3] [-c <collection>]
---
load the `searching-a-workspace` skill — it owns the rule and the ladder — then:

**first, decide whether to search at all.** if you can QUOTE a phrase from the records, or you are
after a symbol, path, field name or id, use `grep`. it is instant, exact, needs nothing installed,
and on a question asked in the records' own words it scores MRR 1.00 in 9ms where the full pipeline
scores the same in ~22,900ms. ⚠ reaching for retrieval there is a pure loss, and it does not look
like a mistake — you get a confident ranked answer, slowly, that grep would have given you exactly.

```bash
npx dt-find "<question>" --effort 2 -c <collection> \
    --lex "the words the RECORDS would use" \
    --vec "the question restated as prose, in their register" \
    --hyde "one or two sentences of the answer, as if it existed"
```

⚠ **you supply the three lanes, and they must DIFFER.** that is the whole rung: the two questions no
backend answers fail for opposite reasons — one is a vocabulary gap, one an abstraction gap — and
they are rescued by opposite lanes. passing one sentence three times hedges nothing. ⚠ never write
`--hyde` from a document you have just read: that is the answer fed back as the question.

**`--effort 3` when you want EVERY record about something** ("what's broken in X", "what did we ship
for Y"). it closes the set through the reference the hits agree on — measured 4 of 4 where retrieval
topped out at 3 of 4 with ten slots available. ⚠ scope it with `-c`: unscoped, hits from an unrelated
collection crowded out the ones carrying the reference. ⚠ "the hits agree on no reference" is a
RESULT, not a failure — it declined to expand through a weak plurality.

**then read.** every rung prints `file:line` LOCATIONS and nothing here synthesises. open each cited
line before citing it; a rank is not a fact and 89% is not a citation. if the answer is a record you
now want to change, that is a `dt` write, scoped to the record.

⚠ `qmd` is OPTIONAL. without it `--effort 0` still works and the rest report unavailable — `npm run
doctor` warns, nothing fails. and a fresh clone has an EMPTY project-local index, which answers "no
passage matched": indistinguishable from a real miss, so check before believing a negative.
