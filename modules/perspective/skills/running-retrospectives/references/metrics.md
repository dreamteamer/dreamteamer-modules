# the metrics, and the question each one answers

Every metric here was named by the operator in one of two meetings, and each is carried with the
question it exists to answer. **A metric with no question attached is the thing this file exists to
prevent** — thirteen number-shaped instruments were named in three weeks and five were ever run.

Two sources, and they are not the same design:

- **2026-09-02, the brainstorm with a CEO** — FOUR LAYERS on an explicit subjectivity gradient,
  designed for someone who cannot see what the programme returns. Org-wide, cross-person.
- **2026-09-06, the pilot session with a project lead** — the first instantiation of those layers on
  one real project, split into a GIT half and a SESSION half.

⚠ **They are NOT one design seen twice, and treating them as one is the error this note exists to
stop.** A review of the three tellings measured
the drift across three tellings in five days:

| told to | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| the CEO, 09-02 | usage | turn classification | **one-shot lab-conditions cost of the artifact** | contextual per-deliverable quality scoring |
| the project lead, 09-06 11:00 | tokens | turns | turn classification | **actively-used skill tokens** (+ session count, tools/MCPs, and the two git curves) |
| a third listener, 09-06 12:30 | tokens burned | turns | turn classification | **output quality** (code-change proxy + review) |

**Layers 1 and 2 are stable and identically worded in all three — take them as canonical. Layer 3
onward is different every time.** The project lead's telling renumbers (tokens and turns split, pushing
classification to third) and **drops the one-shot cost entirely**. So the fields below carry every
metric from every telling, and `oneshot_prompt_words` is marked as never repeated since 09-02.
Which of layers 3 and 4 survives is a DECISION the operator has not taken — not a merge for anyone
else to perform.

## the four layers — and why the ORDER is the design

The layers are ordered by how subjective they are, and the operator was explicit that the gradient
is the point. **Never average them into one score**: mixing an objective count with a subjective
judgement destroys the only property that makes the set trustworthy.

| # | layer | how objective, in his words | fields |
|---|---|---|---|
| 1 | **Usage** | *"the first is entirely objective, how many turns is objective"* | `turns_user` · `sessions` · `tokens_input`/`tokens_output` |
| 2 | **Turn classification** | *"classification is almost objective"* | `turns_added_information` · `turns_corrected` |
| 3 | **One-shot cost of the artifact** | his own idea, and the one he pushed hardest | `oneshot_prompt_words` |
| 4 | **Contextual quality** | *"quality will always be a subjective measure, but you can get close to objective"* | `deliverable_kind` · `quality_score` |

**Layer 3 is the one worth understanding before you use it.** Take an artifact you are satisfied
with, ask the model to reproduce it **blind, in one shot**, and measure how short a prompt would
have sufficed. His claim: *"it normalises the skill inward, and normalises all the turns"* — because
everything you learned during the session ends up inside that one-shot prompt, one number folds the
skills, the turns and the harness together and answers *"what would this have cost me under
laboratory conditions?"*. The CEO pushed back twice — *"why does that normalise it for you? I can't
quite see why"* — and converged on *"so, probably it does represent it"*.

**Everything normalises to words.** *"Everyone produces words in the end… a PRD is words, code is
obviously words"* — so productivity is a ratio, output words over input words, numerator and
denominator. `output_words` / `input_words`.

⚠ **And the guard is not optional.** Words can be gibberish, so the ratio is meaningless without a
second one beside it: how much each word had to be corrected. `correction_ratio`, **and you want to
watch it fall.**

⚠ **The first version is TEXT, not numbers.** *"Maybe it doesn't need to go into columns of numbers
at all, it can go into columns of text. A summary like that."* Agreed without reservation. A report
that leads with a table has already skipped the step both men agreed on.

## the questions — code convergence

Each of these is a question the git half exists to answer. The fields are on
`perspective/activity-weeks`.

1. **Are we converging?** — `lines_new` and `lines_modified` plotted together. The shape to expect,
   in his words: *"at the start you produce a lot of code, then you produce little code, then you
   edit a lot of code, then you edit little code, and then you stop producing and stop editing."*
   When both flatten, *"you know you've finished."* → `converging`
2. **Is something wrong?** — the inverse shape is the alarm: *"if you changed a thousand lines today
   and a hundred yesterday, something happened — definitely wrong, you're not converging."*
   ⚠ **Over time, not day to day.** One noisy day is not a signal.
3. **Where is the churn?** — which module is still moving when the rest has settled. → `modules_touched`
4. **Who is it moving for?** — per author, on the same two curves. → `authors`
5. **Is the remaining change a DEFECT or a REQUIREMENT SHIFT?** — the expensive question and the one
   that decides what convergence even means. Method he gave: dump the ticketing system's tickets to
   a folder and lay them on the same timeline. → `commits_bug` · `commits_change_request`

### the fifth idea, unnumbered and possibly the most actionable

From the third telling, and it is the project lead's skills hypothesis stated from the other end: detect
**repeated additions**. If someone re-explains the same document structure every session and burns a
thousand tokens doing it, *"that means a skill is missing."* Nothing in the schema counts this yet;
it would be a finding of kind `knowledge-gap` written by the findings pass across several
conversations, which is exactly the grain `evidence_count` exists for.

⚠ **Do not benchmark against another team.** Asked directly, he declined: *"they don't interest
me… they're not doing the project, they finish at a different pace, on a different deadline. It
might be they're still writing a lot of code because they're building features that aren't right."*
A cross-team comparison is not a missing feature of this design; it was considered and refused.

## the questions — AI usage

Fields on `perspective/conversations`, rolled up weekly onto `perspective/activity-weeks`.

1. **Did the person use it at all, and how much?** — the layer-1 question, and it cuts both ways:
   someone at zero is interesting for one reason, someone at a hundred for another, and then you
   look inside. → `turns_user` · `sessions`
2. **How expensive was the conversation in HUMAN terms?** — and this is why turns beat tokens:
   *"it's fine if it burns a billion tokens, once — a billion tokens, out comes the code, thank you.
   But if you had to talk to it a thousand times…"* → `turns_user`, never `tokens_*` alone
3. **Was I adding information, or correcting it?** — the layer-2 question, per turn: *did I CORRECT
   you, or did I ADD information you didn't have?* A high correction share is the signal that a
   skill is missing, mis-tuned, or that the work arrived broken from an earlier stage. → the RATIO
   of `turns_added_information` to `turns_corrected`
4. **Is knowledge distilling into skills?** — the hypothesis, stated as a curve to look for: you
   start with no skills, you write skills, and *"you repeat yourself less and less, and the
   recurring knowledge should distil into the skills."* So `skill_tokens_active` should RISE while
   turns per deliverable FALL. ⚠ He said plainly he does not know how to measure this well yet:
   *"we need to see how we measure that."* Treat a number here as provisional.
   → `skill_tokens_active` · `skills_used`
5. **What is the harness becoming?** — tools and MCPs over time. → `tools_used` · `mcp_servers`
6. **What would this artifact have cost under lab conditions?** — layer 3. → `oneshot_prompt_words`
7. **Was the artifact any good?** — layer 4, scored per kind. → `deliverable_kind` · `quality_score`

## how to run a measurement pass

Four operating instructions, all his, all reusable:

1. **Prototype the dashboard BEFORE collecting anything.** He reversed his own first instruction to
   say it: he opened with *"first collect all the data"*, was pushed back on, and went further than
   the person pushing — *"do the opposite. Make me a prototype first, show me the dashboard, show me
   what it'll look like. Then I'll say OK, and then start collecting the data to fill it"* — with
   **true look-up values** (real names, real models, real bug/change-request labels) in the mock.
2. **Model routing.** The top-level task runs on the strongest model at high effort — *"this is an
   perspective task… you want all the guns, the smartest one in the room"* — and must be told
   explicitly not to spawn its own kind: *"don't start any sub-tasks on it… use simple models for
   classification and analysis."* Classifying thousands of turns on the expensive model doubles the
   bill for nothing.
3. **Persistence discipline**, stated as the failure it prevents: *"work incrementally, persist your
   results often, be ready to continue if the token limit is reached, don't do any work that is not
   persisted"* — otherwise *"it works and works and works, burns the whole window, and hasn't
   written anything."*
4. **Do not over-specify.** *"Remember you're not talking to a person, you're talking to a network
   that converges. You only need to give it a push in the right direction."*

## what he refused to measure — the list is as load-bearing as the metrics

Every one of these was said out loud, and several contradict what a reasonable person would build.

1. **Commits, on their own.** *"I have trouble with commits, because if it doesn't come with a bug
   count, it tells me nothing — I can commit every three minutes."*
2. **Lines of code, on their own** — *"if they don't come with some qualitative measure."*
   ⚠ **This looks like it contradicts the git half, and it does not:** there the pairing IS the
   bug-vs-change-request colouring. A line count with no `commits_bug` beside it is the thing he
   rejected.
3. **Output volume at the moment of production** — a document is not judged when it is written.
   *"I produced a PRD and I don't know if it's good or bad. After six iterations with the client,
   I'll know."*
4. **Verbatims, ever.** *"Your conversations are yours"*, and the self-disqualifying line: *"first
   give me people's conversations and I'll know the most about everything — but I'll know at an
   intimate level, maybe too intimate."* Hence a skill running in each person's own context
   reporting statistics.
5. **Anything unannounced.** *"Let's decide what we measure, say it to everyone, tell them: listen,
   we measure how many times you spoke, not what you said. We only classify what was said."*
6. **Anything that shames.** *"Not to shame you — only so you know where things stand."*
7. **Cross-team benchmarking** (below).
8. **Day-to-day curve reading** — *"over time, not between today and tomorrow."*
9. **Classification on the expensive model** — *"you don't need to analyse everything you did on
   the big models with the big models."*
10. **Telling the model what you expect to see.** When the expected shape started going into the
    prompt, he cut in: *"leave it, don't tell it what you want."* ⚠ **This binds directly on the
    skills hypothesis above** — the curve is what you look for in the output, never an instruction
    in the prompt that produced it.
11. **T-shirt sizing** of task complexity — floated as the qualitative counterweight, called hard on
    the spot, kept only as *"but it's a start"*, and never resolved.
12. **The 15% figure**, which is a CEO's hand-wave by his own framing — *"maybe 15%, maybe not, I
    don't know"* — and must never be carried as a measurement.

Two further framings worth keeping: **money is the ultimate normaliser** (*"normalise everything to
money in the end — money is a very, very good unit"*, and the reply, *"it's money and time"*), and a
**vanity-metric risk he named himself** — the front-runners will want to show their numbers off.

⚠ **A precondition he named at the end rather than the start:** the team is still working outside a
committed environment, so **layers 3 and 4 have nothing to read yet.** Build 1 and 2 first because
they are the only ones with data.

## the label, or ground truth — the project lead's idea that is NOT layer 3

Distinct from the one-shot cost, and easy to conflate. Once a project's code is finished, that code
*"is your label. Now you can run a lot of benchmarks against the label"* — the basic one being
*"what was the rate of arrival at the label, of the code converging to that label."* His own framing:
*"in machine-learning terminology, it's the ground truth"*, and *"that's the closest thing to code
quality you can state."* No field carries it; it needs a finished project to exist at all.

## the privacy constraint, which is part of the design

Agreed in the CEO brainstorm and binding on every field here: the measurement runs **in each
person's own context and reports STATISTICS, never verbatims**. That is why
`perspective/conversations` carries counts and a PII-free recap, why the identifying detail stays
in `summary` and is marked not safe to export, and why no reader in this module ever reads another
person's tree.
