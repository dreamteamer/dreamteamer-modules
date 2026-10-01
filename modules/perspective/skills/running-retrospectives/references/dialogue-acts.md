# dialogue acts — the turn taxonomy

**The right terminology is *dialogue act*** (speech-act theory, via conversation analysis): what a
turn *does*, as distinct from what it is *about*. A turn's topic is captured by `key_topics`; its
act is captured here. The two are orthogonal and both are needed — "wrote a skill" and "corrected
the agent four times about the skill" are very different sessions with identical topics.

Every act is a flat integer field on `agent-session-summaries` (`user_directive`,
`agent_execution`, …), not a nested map, so that `dt … list --where` can filter on it.

## how a count gets made

1. `lib/acts.mjs` assigns every turn an act by **ordered, first-match-wins** regex. That ordering
   *is* the classifier: a turn that both corrects and adds work counts as a `correction`, because
   the correction is the expensive half.
2. A model reading the digest may **revise** the counts. When it does, it is overwriting a prior,
   not adding to it — the revised numbers replace the heuristic ones wholesale.
3. Unmatched operator turns default to `directive`. That is the honest default: the operator is
   usually telling the agent to do something.

## operator acts

| act | the turn is | signal |
|---|---|---|
| `directive` | a new task or instruction | the default; also always the first turn |
| `refinement` | narrows or extends the task in flight | "also…", "and now…", "one more thing" |
| `correction` | the agent got it wrong and is being told so | "that's not what I asked", "still broken", "you missed" |
| `rejection` | stop, undo, don't | "no", "revert that", "cancel" |
| `approval` | permission to continue | short and affirmative — "yes", "go ahead", "lgtm" |
| `question` | asks for information rather than work | ends in `?`, or opens with an interrogative |
| `answer` | responds to a question the agent asked | short, and the previous agent turn was a `question` |
| `context` | hands over material, asks nothing | a long paste with no imperative and no `?` |
| `meta` | about the agent or the process, not the work | "use opus", "be less verbose", "from now on…" |
| `interruption` | the operator killed a turn mid-flight | the harness's `[Request interrupted by user` marker |
| `slash_command` | invoked a command | a `<command-name>` envelope |

`correction` + `rejection` + `interruption` is the **friction triple**. A session where they sum
high is where the knowledge is: the operator's corrections are the clearest statement of what they
actually believe, and nowhere else in the vault is that written down.

## agent acts

| act | the turn is | signal |
|---|---|---|
| `plan` | proposes an approach before acting | "here's the plan", `ExitPlanMode` |
| `execution` | substantively a tool call | has tools, little prose |
| `report` | states what was done | prose after tool work |
| `question` | asks the operator | `AskUserQuestion`, or ends on a `?` |
| `assertion` | answers from knowledge, no tools | neither tools nor a question |
| `refusal` | declines | "I can't help with that" |
| `handoff` | delegates to subagents | a `Task` / `Agent` call |

## the four friction counters

Kept **outside** the taxonomy because they are cross-cutting — a single turn can be a `report` and
an apology and a pivot at once.

| field | tier | how |
|---|---|---|
| `apologies` | heuristic | `APOLOGY_RE` over assistant text. Deliberately broad: it counts "you're right" and "good catch", not just literal apologies, because the climb-down is the event worth counting, not the politeness formula. |
| `permission_denials` | mechanical | tool results the operator refused. Exact. |
| `divergences` | **judged** | the agent did something materially other than what was asked. Not detectable by regex, and not the same as being wrong — an agent can be correct and still have diverged. |
| `plan_changes` | **judged** | a stated approach was abandoned or replaced mid-session. Only counts approaches that were *stated*; silent drift is a `divergence`. |

## scoring the judged two

Both start at the heuristic prior of **0** and are counted from the digest, conservatively:

- Count a `divergence` only where the operator's instruction is quoted in the digest and the agent's
  action visibly differs. A suspicion is not a divergence.
- Count a `plan_change` only where a plan was stated in one turn and contradicted in a later one.
- When the digest was sampled (it says so at the bottom), these are **lower bounds** — say that in
  `interest_reason` rather than guessing upward.
