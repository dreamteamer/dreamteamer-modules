# the metrics, and the question each one answers

Every metric here is carried with the question it exists to answer. **A metric with no question
attached is the thing this file exists to prevent** — a number nobody asks about is collected,
stored and never read.

## the four layers — and why the ORDER is the design

The layers are ordered by how subjective they are, and the gradient is the point. **Never average
them into one score**: mixing an objective count with a subjective judgement destroys the only
property that makes the set trustworthy.

| # | layer | how objective | fields |
|---|---|---|---|
| 1 | **Usage** | entirely objective — a turn count is a count | `turns_user` · `sessions` · `tokens_input`/`tokens_output` |
| 2 | **Turn classification** | almost objective | `turns_added_information` · `turns_corrected` |
| 3 | **One-shot cost of the artifact** | a measurement, when someone runs it | `oneshot_prompt_words` |
| 4 | **Contextual quality** | subjective; it can get close to objective, never reach it | `deliverable_kind` · `quality_score` |

Layers 1 and 2 are stable and always worth filling. Layers 3 and 4 are optional: most runs leave
them empty, and an empty field is honest where a guessed one is not.

**Layer 3, before you use it.** Take an artifact you are satisfied with, ask the model to reproduce
it **blind, in one shot**, and measure how short a prompt would have sufficed. Everything learned
during the session ends up inside that one-shot prompt, so one number folds the skills, the turns
and the harness together and answers *"what would this have cost under laboratory conditions?"*.

**Everything normalises to words.** A PRD is words and code is words, so productivity is a ratio:
output words over input words. `output_words` / `input_words`.

**And the guard is not optional.** Words can be gibberish, so the ratio is meaningless without a
second one beside it: how much each word had to be corrected. `correction_ratio`, **and you want to
watch it fall.**

**The first version is TEXT, not numbers.** A summary in columns of text is a valid first report; a
report that leads with a table has skipped that step.

## the questions — code convergence

Each of these is a question the git half exists to answer. The fields are on
`perspective/activity-weeks`.

1. **Are we converging?** — `lines_new` and `lines_modified` plotted together. The shape to expect:
   at the start a lot of new code, then little; then a lot of editing, then little; then neither.
   When both flatten, the work is finished. → `converging`
2. **Is something wrong?** — the inverse shape is the alarm: a thousand lines changed today after a
   hundred yesterday means something happened. **Over time, not day to day.** One noisy day is not
   a signal.
3. **Where is the churn?** — which module is still moving when the rest has settled. → `modules_touched`
4. **Who is it moving for?** — per author, on the same two curves. → `authors`
5. **Is the remaining change a DEFECT or a REQUIREMENT SHIFT?** — the expensive question, and the one
   that decides what convergence even means. Lay the ticketing system's tickets on the same timeline
   as the commits. → `commits_bug` · `commits_change_request`

**Repeated additions.** If someone re-explains the same document structure every session and burns
a thousand tokens doing it, a skill is missing. Nothing in the schema counts this directly; it is a
finding of kind `knowledge-gap` written by the findings pass across several conversations, which is
exactly the grain `evidence_count` exists for.

**Do not benchmark against another team.** Another team works on a different project, at a
different pace, against a different deadline; a cross-team comparison measures the projects, not
the people.

## the questions — AI usage

Fields on `perspective/conversations`, rolled up weekly onto `perspective/activity-weeks`.

1. **Did the person use it at all, and how much?** — the layer-1 question, and it cuts both ways:
   someone at zero is interesting for one reason, someone at a hundred for another, and then you
   look inside. → `turns_user` · `sessions`
2. **How expensive was the conversation in HUMAN terms?** — this is why turns beat tokens: burning a
   billion tokens once is fine if the code comes out; having to talk to the agent a thousand times
   is the expensive failure. → `turns_user`, never `tokens_*` alone
3. **Was the person adding information, or correcting?** — the layer-2 question, per turn. A high
   correction share is the signal that a skill is missing, mis-tuned, or that the work arrived broken
   from an earlier stage. → the RATIO of `turns_added_information` to `turns_corrected`
4. **Is knowledge distilling into skills?** — the hypothesis, stated as a curve to look for: you
   start with no skills, you write skills, and you repeat yourself less as recurring knowledge
   distils into them. So `skill_tokens_active` should RISE while turns per deliverable FALL. Treat a
   number here as provisional. → `skill_tokens_active` · `skills_used`
5. **What is the harness becoming?** — tools and MCPs over time. → `tools_used` · `mcp_servers`
6. **What would this artifact have cost under lab conditions?** — layer 3. → `oneshot_prompt_words`
7. **Was the artifact any good?** — layer 4, scored per kind. → `deliverable_kind` · `quality_score`

## how to run a measurement pass

1. **Prototype the report BEFORE collecting anything**, with true look-up values (real projects, real
   models, real bug/change-request labels) in the mock. Collect only what fills it.
2. **Route models.** The coordinating task runs on the strongest model; classification and counting
   run on cheap ones. Classifying thousands of turns on the expensive model doubles the bill for
   nothing.
3. **Persist incrementally.** Write results often and be ready to resume if the context runs out; a
   pass that works for an hour and has written nothing has produced nothing.
4. **Do not over-specify.** Give the model a push in the right direction, not the answer.

## what is NOT measured — the list is as load-bearing as the metrics

1. **Commits, on their own.** Without a bug count beside them they say nothing — anyone can commit
   every three minutes.
2. **Lines of code, on their own.** The git half pairs every line count with the bug-vs-change-request
   split; a line count with no `commits_bug` beside it is the thing refused.
3. **Output volume at the moment of production.** A document is judged after its iterations, not
   when it is written.
4. **Verbatims, ever.** A person's conversations are theirs. The measurement runs in their own
   context and reports statistics.
5. **Anything unannounced.** Say what is measured — how many times someone spoke, never what they
   said — before measuring it.
6. **Anything that shames.** The numbers say where things stand, nothing more.
7. **Cross-team benchmarking** (above).
8. **Day-to-day curve reading.** Curves are read over time.
9. **Classification on the expensive model.**
10. **Telling the model what you expect to see.** The expected curve is what you look for in the
    output, never an instruction in the prompt that produced it.
11. **A hand-waved percentage** carried as if it were a measurement.

**Money is the ultimate normaliser** — money and time — and the front-runners will want to show
their numbers off, which is the vanity-metric risk to watch.

**Build layers 1 and 2 first.** Layers 3 and 4 need a committed environment and finished artifacts
to read; until those exist they have nothing to measure.

## the label, or ground truth — NOT layer 3

Distinct from the one-shot cost, and easy to conflate. Once a project's code is finished, that code
is the label — the ground truth — and the rate at which the code converged to it is the closest
thing to code quality you can state. No field carries it; it needs a finished project to exist at
all.

## the privacy constraint, which is part of the design

The measurement runs **in each person's own context and reports STATISTICS, never verbatims**. That
is why `perspective/conversations` carries counts and a PII-free recap, why the identifying detail
stays in `summary` and is marked not safe to export, and why no reader in this module ever reads
another person's tree.
