# the interview — banks, order, budget, stopping rule

The stage is **question** (`stage: interviewed`). Every question is an
`perspective/questions` record BEFORE it is asked (`bank`, `n`, `text`, `from_finding` for gaps);
every answer written back onto the QUESTION it answers — `answer` verbatim, `answered_on`, `answer_origin`, linked back
from the question. "skip" sets `status: skipped`. The interview is in the language of the person's
first message.

**Generate `max_interview_questions` (default 10). Ask `min_interview_questions` (default 0).**
Both live on the `retrospective-sessions` record. The generator always writes the full set as `questions`
records; how many reach the person is a separate decision, taken per run.

- **Unattended (`min 0`, the default).** Every question is generated and left `status: pending`. The
  run does not stop. The analysis continues by taking each proposal's RECOMMENDED option, and every
  finding that a question would have settled stays `anecdote` or `pattern` — never `confirmed`, and
  never `refuted`, because nobody spoke. The pending questions are the queue a supervised run picks up.
- **Supervised (`min > 0`).** Ask that many, in the order below, then stop and continue as above with
  the rest left pending. Say the number in the opening so the person knows the shape.

**An unattended run cannot confirm anything, and must not pretend to.** `basis` on every proposal
it writes is `evidence-only`, and the report says how many questions are waiting.

**Order:** modelling Q1 first · then every `gap` question by `evidence_count` descending (an
identity question counts the smaller of the two records) · then the remaining asked modelling
questions · `role` only when detection failed (below).

**Stopping rule:** stop when every finding with `needs_confirmation: true` has had its question AND
every modelling question the answers already covered is marked `skipped` with a note saying which
answer covered it. Then say what was confirmed, refuted and excluded, and that the findings pass reruns.

## opening (say it, adapt the numbers)

> Nothing here is a test. The goal is to find the two or three things you keep re-finding, so the
> workspace we build holds those and nothing else. Three kinds of question: what you do, things I
> noticed and want to check, and where I could not tell. N questions, one at a time, any length;
> say "skip" to skip one.

(N is `min_interview_questions`. On an unattended run there is no opening at all — the questions are
written and left pending.)

## bank 1 — modelling: six ASKED, six DERIVED

The engine's twelve modelling questions (`node_modules/dreamteamer/skills/using-dreamteamer/references/data-modeling.md`
§6) are written for a requirement. Six can be asked of a person; six cannot and are derived.

| engine Q | asked as | what the answer feeds |
|---|---|---|
| Q1 nouns | **What do you find yourself looking for again and again — a file, a number, a thread, a decision — that you never quite know where you put?** | collection candidates; `recurring-question` findings |
| Q2 the question | **When you go looking for that, what is the actual question you are trying to answer?** (ask only if Q1 did not say) | each proposal's `description` and `use_when` |
| Q4 lifecycle | **Take one of those. When is it *done* — when it is agreed, when someone confirms in writing, when it ships?** | `status` enum of the proposed collection |
| Q5 stable vs volatile | **Is that a thing that exists and changes slowly, or something that happens on a day?** (often derivable — ask only if unclear) | `entity` vs `docs` mixin, id shape |
| Q10 the list | **If you opened a page of these on Monday morning, which four things would you want to see per row?** | `display.list.columns`, the fields that exist at all |
| Q12 not modelled | **What do you *not* want this workspace to track, even if I could?** | the "deliberately not modelled" list; excluded proposals |

Derived, never asked: **Q3 identity** (from Q4/Q5 — dated slug for a thing that happens, bare slug for
a thing that is) · **Q6 relations** (from nouns that appeared together in Q1 and in findings) · **Q7 the
forcing field** (the one field whose absence makes the record write-only — from Q2) · **Q8 units and
time** (from the evidence; ask only when a number appeared with no unit) · **Q9 volume** (from
`activity-weeks`; if asked at all, it is the last question and skippable) · **Q11 the module**
(always the workspace module for a one-person workspace).

## bank 2 — gap questions, generated

One per finding with `needs_confirmation: true`, highest `evidence_count` first. The evidence a
gap question quotes may be an `activities`, `decisions`, `topics` or `perspective/users` record as
well as a conversation or an activity-week** — the template is the same, the count is still a count
of DISTINCT records. Template:

> **<count> of your <total> <sessions|weeks> <observation, in plain words>. Is that <reading A>, or
> <reading B>?**

Quote the count and the source kind; offer two readings so a one-word answer is possible; never ask
the person to confirm your interpretation without offering the alternative. An anecdote (count < 3)
MAY generate a gap question — confirmation is the only way it ever becomes more than one — but say
the count honestly ("Twice I saw…").

On the answer: agrees → `standing: confirmed`; contradicts → `standing: refuted` (and the finding is
never cited); adds a nuance → `confirmed`, with the nuance written into the finding body and the
answer added to `evidence`.

### the suggested answer — written with the question, never as the answer

Every gap question is written with `suggested_answer`: what the run infers the person would say,
read out of the finding and the records behind it, and `suggestion_evidence` naming those records.
Hedge where the evidence hedges — "probably B, because the four revisions all…" is a suggestion;
"B" is a guess. The `answer` field stays EMPTY. On a supervised run the suggestion is read TO the
person as the run's reading, after the two options, and what they say back is what gets written —
even when it is "yes, that". `check-records` refuses a suggestion with no evidence and an `answer`
identical to the suggestion. The full argument is `references/inference-model.md` § suggestions.

### identity questions — a gap question with no finding

Two things only a person can settle, and neither has a finding behind it: **is `<handle A>` the same
person as `<handle B>`** (`references/identity.md`), and **is this collaborator the `contacts` record
that shares their name**. Both are written as `bank: gap` with `from_finding` EMPTY, the body saying
why the question exists and quoting the counts. `questions.bank` has no `identity` value yet — a
fourth enum value is **owed**; until it lands, `gap` with an empty `from_finding` is the honest
spelling, and the body carries the distinction.

On an unattended run these stay `pending` and **nothing is merged and no `contact` is set** — a wrong
merge is expensive and a pending question is not.

## bank 3 — role, asked only when detection fails

**Detection (from conversations):** `user_directive` dominant and `files_edited` on the
person's own turns near zero → the person describes and the agent writes (product, QA, design, or a
lead). `files_edited` high and `user_correction` high → the person reviews code (developer). Ambiguous
→ ask ONE role question, then the two follow-ups for that role only if the evidence is still thin.

**Detection reads the activity shape too**, and must, because a contributor with no transcripts
has no dialogue acts at all. `activities` whose evidence is tickets with no commits · `workflows`
whose steps are all review and hand-off · `perspective/users` with `roles_observed: reviewer` → the
person directs and reviews. Commits across many repos with few tickets → the person builds. The bank
below is asked only when BOTH the act mix and the activity shape leave it open. Whatever the answer,
`perspectives.role` is still written from behaviour — an answer here is evidence for it, not a
substitute (a title given in an interview is not an observed role).

| role | the question that tells | two follow-ups |
|---|---|---|
| developer | When something ships from your sessions, who reviews the diff — you, or someone else? | What breaks most often after you ship? · Where do you keep the things you learned the hard way about this codebase? |
| QA | When you find a bug, where does it go first — a ticket, a message, a note to yourself? | What do you re-test every release because you do not trust it? · Which test plans exist only in your head? |
| product | When a decision is made on a call, where does it live afterwards? | What do you get asked for status on, and how do you answer? · Which document do you rewrite every quarter? |
| design | Where do the versions of a design live, and how do you know which is current? | What feedback do you get repeatedly? · What do you have to re-explain to every new developer? |
