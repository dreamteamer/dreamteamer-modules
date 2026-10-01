# interest_score — the rubric

**Read this before scoring, every time.** A score is only useful if it means the same thing across a
backfill of hundreds of records written by different sessions on different days. Do not invent your
own scale, and do not calibrate against the other conversations in your current batch — calibrate
against this rubric.

## the question it answers

> How much **extractable value** does this conversation hold that exists nowhere else?

"Nowhere else" is doing the work. A session that built a feature is not valuable *here* — the
feature is in the repo and the commit message says why. What is valuable here is what the repo
cannot record: the reasoning, the rejected alternatives, the operator's corrections, the trap that
cost an hour.

**Value to extract, not quality of the session.** A disastrous session where the operator corrected
the agent nine times is *high* interest. A flawless session that renamed a variable is low.

## the bands

| score | means | typical shape |
|---|---|---|
| **0–14** | nothing. A mechanical errand. | one directive, tool calls, done |
| **15–34** | ordinary work, fully recorded elsewhere | a feature built cleanly, no friction, no reasoning stated |
| **35–54** | one thing worth remembering | a single pitfall, a preference stated once, a useful technique |
| **55–74** | genuinely worth mining | sustained reasoning, real corrections, a decision with a stated why |
| **75–89** | a primary source | design argument, several rejected approaches, the operator's beliefs made explicit |
| **90–100** | rare. Read it in full. | a decision that shaped the project, argued out, with the losing side visible |

Most conversations are 15–34. If your batch averages above 50, you are inflating.

## what raises a score

- **The operator explained *why*.** Reasoning stated once in a chat and never written down is the
  single highest-value thing in this corpus.
- **Corrections and rejections.** `user_correction + user_rejection + user_interruption` running high
  means the operator's actual beliefs got stated out loud. That is `operator_bias` evidence and it
  is unavailable anywhere else.
- **A dead end.** What was tried and abandoned, with the reason. Repos record only the survivor.
- **A pitfall with a mechanism** — not "X failed" but "X failed *because*".
- **A decision that outlived the session**, especially one that contradicts an older document.
- **Design or strategy talk** with no code at all. These score high and have low `prior_score`; the
  mismatch is the signal, not a problem.

## what does NOT raise a score

- Volume. A 9,000-tool-call session can be worth 10. `tool_calls` is not evidence of value.
- The agent being impressive. This corpus is mined for what the **operator** knows.
- Novelty of the topic. A conversation about something interesting that established nothing is a 20.
- Length of the digest. Long and repetitive is still low.

## ⚠ never derive the score from `prior_score`

**Observed 2026-08-01:** a worker scored 41 sessions and produced five distinct values — 16 at
exactly 10, 16 at exactly 50 — having decided "complex work with `prior_score` >= 80 scored 50".
That is not a judgement, it is a rename of a number already on the record.

`prior_score` is volume and friction. `interest_score` is extractable value. **They are stored side
by side so they can DISAGREE**, and the disagreement is the whole point: the highest-value session
in this corpus (`77946f0f`, the recipes-architecture argument) is `prior 56 / interest 90`. Deriving
one from the other would have skipped it.

Self-check before you write a batch: **how many distinct scores did you produce?** Twenty judged
sessions should yield at least eight or nine distinct values. Three or four means you bucketed.

## ⚠ report your batch mean — the rubric alone does not hold

**Measured 2026-08-01:** eight cheap-model workers applied this file, as written, to eight
comparably-mixed slices of the same corpus. Their batch means came out **27 · 32 · 34 · 38 · 41 ·
46 · 48 · 48** — a 21-point spread, which makes a score non-comparable across shards even though
every worker had the bands and anchors in front of it. `interest_score` gates what gets exported and
read deeply, so that spread is a defect in the index, not a curiosity.

So, mandatory when scoring a batch:

1. **Compute and report your batch mean and median.** The corpus-wide median is **~33**.
2. **If your mean is above 40, re-read the anchors and re-score.** You are almost certainly
   rewarding effort or topic rather than extractable value. The commonest inflation is scoring a
   long, busy, competent session in the 50s when it belongs at 20 — the output is in the repo.
3. **Never calibrate against the other conversations in your own batch.** A slice of mostly-dull
   sessions makes the least dull one feel like a 60. It is a 30.
4. A slice of ~23 mixed sessions should produce roughly: a third under 20, a third 20–40, and only
   two or three above 70.

## calibration anchors

- one prompt → agent runs 130 tools → "done" → **10**. Output is in the repo.
- "sync my calendar" → it worked → **12**.
- a bug hunt where the root cause turned out to be surprising, and is stated → **45**.
- an architecture argument where the operator rejected two approaches and said why → **80**.
- a session that ended in a decision now contradicting `DECISION-LOG.md` → **90+**, and say so in
  `notable`.

## the required companion fields

A score with no reason is not reviewable. Always write:

- **`interest_reason`** — one line, naming the *specific* thing. "Operator rejected the adapter enum
  and said why" beats "useful discussion".
- **`notable`** — the single most worth-mining item, or empty. Empty is a legitimate answer and is
  better than padding.
- **`knowledge_kinds`** — which of `knowhow` · `facts` · `operator-bias` · `decisions` ·
  `experience` · `technique` · `pitfall` are actually present. Do not list a kind you cannot point
  at a turn for.

## when the digest was sampled

The digest says at the bottom when agent turns were sampled out. Operator turns are never sampled,
so intent is always fully visible — but a divergence you cannot see is a divergence you must not
count. **Score from what you read, and say in `interest_reason` that it was a sampled read.** Do not
scale a score up to compensate for what you did not see.
