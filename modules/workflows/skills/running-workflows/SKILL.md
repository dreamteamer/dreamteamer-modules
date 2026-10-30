---
name: running-workflows
description: >-
  use when a `workflows` record is run, written or installed — /workflow:run, "run the customer factory", "process this week's leads", "take the software factory from the calls to a deploy", `npx dt-workflows install` — or when the same chain of commands keeps being run by hand over many records and should be written down once. How a session walks a workflow's steps over their record sets with `dt next`, where it stops for a person, and why a run is never recorded.
---

# running-workflows

## What you are doing

You walk one `workflows` record: for each step, in order, you list the step's record set, ask `dt next` which of those records the step's command can run on now, run it on them, and stop wherever the step says a person decides. A workflow is a document. Nothing about the run is written anywhere: the records the commands touch are its only trace, so running a workflow again is resuming it — a record a step already finished has dropped out of that step's set.

## Before you start

```bash
dt get workflows/<id>                       # the steps, their sets and stops; the body says why
npx dt-workflows list                       # the workflows the installed modules ship, and whether each is installed
npx dt-workflows install <id>               # copies a shipped one into data/workflows/ when it is missing
dt check                                    # a step naming a command or collection this workspace lacks fails here
```

`install` refuses when the workflow names a command or a collection the workspace has not compiled, and names the module to install. It never overwrites an installed workflow — the workspace's copy is its own to edit — unless `--force` is given, and `list` says when the shipped one has changed since. Commit an installed workflow like any record: `dt commit workflows/<id>`.

Read every step's command once before running it: each loads its own skill, and that skill, not this one, owns how the step is done.

## Do this

1. **Status.** `retired`: stop and say so. `draft`: run as `--dry-run` unless the person says go.
2. **The range.** `$from` and `$to` are dates (`YYYY-MM-DD`): the range given to `/workflow:run`, or seven days back to seven days ahead. Replace them in every `where` before listing. The engine refuses a `$` token it does not know, so a step whose `$from` you forgot fails loudly instead of listing everything. `$today` and `$now` stay as they are; the engine reads them.
3. **Each step, in order** (from `--from-step N` when given):
   - A command bound to the collection rather than to a record (`dt next <collection>` shows it as `[collection]`) runs once. Pass the range when its argument hint takes one (`/fetch-meetings <from>..<to>`).
   - Otherwise list the set, then ask which of it is ready:
     ```bash
     dt list <collection> --where '<where, with $from/$to replaced>' --json      # the ids
     dt next <collection> --ids <id>,<id>,…                                      # per command: k/n eligible, and the invocation
     ```
     The line for the step's command gives the invocation with only the eligible refs. Run that invocation, as typed — it is the command, with its own skill.
   - Empty set, or nothing eligible: report the step as `0` and go on. That is a finished step, not an error.
   - A step with a `stop`: show the person the set (ids and names), say what they decide in the stop's own words, and wait. Run only what they confirm. A step with no `command` is only this: the set and the question.
4. **Between steps**, re-list rather than remember: a step changes the records the next step filters on (a transcript lands, a summary's mirror fills).
5. **The report**, one line per step: the set, how many were eligible, how many ran, what was skipped and why, and the stop that is holding the run if one is. Then where `dt next` stands on whatever is left.

Writing a workflow: one step per command per collection, in the order the records move; a `where` that narrows to the records this workflow cares about (the range, a mirror still empty so a re-run does not redo the work) rather than restating the binding's gate; a `stop` wherever a command reaches outside the workspace, spends money, or needs a human judgement; and a body with one `## <n>. <name>` section per step.

## Don't

- Don't write a record of the run — no run collection, no progress field, no "last step" on the workflow. Run records and cursors have been tried: they were abandoned mid-run and stopped agreeing with the records, while the fields the commands write cannot disagree with themselves.
- Don't run a command `dt next` does not list as eligible. If the step's set holds a record you expected to be ready, say which gate field is missing.
- Don't run past a `stop` because the answer looks obvious. The stop is where the workflow says a person decides.
- Don't restate a command's procedure here or in a workflow's body. The command loads its skill; the workflow names the command.
- Don't edit a shipped workflow inside `node_modules/`. Install it, then edit the workspace's copy.

## Done when

Every step has run on every record its command was eligible for, or the run is held at a named stop, and the report says which. `dt next` on each step's set answers only what is waiting on a person or on a field no step of this workflow writes.
