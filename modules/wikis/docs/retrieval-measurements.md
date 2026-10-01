# wikis — the measurements behind the shipped text

Not shipped. The skill, README and code comments state the rules these numbers support; the numbers
themselves live here.

## grep against retrieval

- Over 300 markdown records, 15 questions worded the way an asker phrases them before knowing the
  corpus's words: lexical recall 0.22, vector 0.80.
- On the same fixture the LLM re-rank found slightly more (recall 0.85 against 0.80) and ranked it
  worse (MRR 0.53 against 0.62, recall@1 halved), at 24-25 s per novel query against roughly 0.1 s
  for a lexical one. Cost is dominated by per-invocation model load.
- On a 38-source legal corpus (2026-09-11), a practitioner's Hebrew term for a statutory lock-up gave
  nine grep hits and none was the statute that defines it; `ask` returned it at rank 4 of 10, and five
  of five benchmark questions resolved. `ask` also surfaced three commentaries that use a rule and
  ranked the rule itself fifth.
- Naming the governing instrument in the question: 4/4 hits with it, 2/2 misses with that clause
  removed, same corpus and run.
- `qmd embed`: 4,977 chunks from 38 documents in 8m15s, plus ~2.1 GB of models on the first run.

## defects the code comments now only name as invariants

- `bodyLine`: before it existed, `search` reported `<file>:<n>` short by the frontmatter's height
  (line 44 against actual 55, 62 against 73).
- notebooklm-py 0.7.3 `source fulltext --format markdown` answered
  `{"error": true, "code": "UNEXPECTED_ERROR", "message": "…requires the 'markdownify' package…"}` at
  exit 2 with `-o` and exit 0 without, stderr empty. Branching on the exit code alone recorded the
  echoed command line as the reason on 129 sources; `vendorResult` reads the payload first.
- Four corpora placed under `data/notebooks/<id>` produced 42 `check` warnings on every run, which
  is why corpora live at `wikis/` at the workspace root.
- The corpus moved from `${env:FILES_FOLDER}/wikis/<id>` into the repo, and `index.md` replaced
  `wiki.yaml`, on 2026-09-11; the fallbacks that still read the old layout date from that move.
