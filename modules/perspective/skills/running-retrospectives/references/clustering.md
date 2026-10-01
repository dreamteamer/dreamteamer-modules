# clustering — candidates into activities

Stage 5 has two halves. `bin/cluster-activities.mjs --retrospective <ref> [--gap-days 3]` proposes
**candidates**; the model reads them and writes the records. The script writes no records, and the
model reads no transcripts.

## what a candidate is

One line of JSONL in `.perspective/activity-candidates/<base>.jsonl`: a **gap-bounded run of
evidence** — sessions, commits and tickets that touch the same repos, branches and handles with no
quiet stretch longer than `--gap-days` inside it. Each line carries first and last date, the repos
and branches, the commit SHAs and subjects, the conversation ids, the ticket ids and the handles
seen.

A candidate is **a proposal, not a record**. `.perspective/` is gitignored scratch and is
rebuildable — deleting it and re-running the script is always safe, and re-running it after new
evidence lands is the normal way to widen a run. Nothing downstream may reference a candidate.

## `--gap-days`

The one knob: how long the work may go quiet before the next evidence starts a new candidate.
Default 3, which suits someone working most weekdays.

| the evidence looks like | try |
|---|---|
| dense, several sessions most days | `--gap-days 2` — the default over-merges a busy week into one blob |
| a side project touched at weekends | `--gap-days 7` — otherwise every weekend is its own activity |
| a part-time contributor, or a thin month | `--gap-days 7` or more |
| a long background thread with a burst at the end | leave 3 and MERGE by hand (below) — do not raise the gap to catch one thread and shred everything else |

Changing the knob rewrites the candidates file, never the records already written. Re-run the model
pass over the new file and reconcile against what exists — the activities are the state, and the
stage is idempotent because you read them first.

## naming an activity

The name is the whole value of the record. Name it as **the person would name the task**:

- **verb + object, in their vocabulary** — the words their commit subjects, ticket titles and
  session goals actually use.
- **never the container** — "worked on `<repo>`", "the api repo", "August work" name where the
  evidence sat, not what was done.
- **never the tool** — "used Claude Code to…" is how it was done.
- **the test:** would they recognise it in a list a month later, without opening it? If a name needs
  the dates beside it to be intelligible, it is naming a container.

Where the person's own term exists as a `concepts` record, use their term over the correct one.

## one candidate or several

| what you see | do |
|---|---|
| two unrelated topics inside one window (a release day) | **split** — one activity per topic, sharing the dates |
| the same topic resumed after a longer gap | **merge** — one activity, `ended` moved out, both runs' evidence on it |
| a run whose commits are all one refactor and whose sessions are all one bug | split: they are two pieces of work that happened to overlap |
| a run with one commit and no session | keep it, `status: unknown`; a thin activity is honest, an invented one is not |

Merging and splitting are the model's judgement and the reason this pass is not a script. Report
both counts, so a reader can see how much reshaping the gap setting needed.

## topics — reuse before you create

`topics` are per-run (the `retrospective` is in the id). Before writing one:

```
dt list perspective/topics --filter retrospective=perspective/retrospective-sessions/<id>
```

Match on `name` OR on any entry in `aliases`. On a hit, **add the new spelling to `aliases`** and
widen `first_seen`/`last_seen` and `evidence_count`. Create a topic only when the subject is
genuinely new. Two topics for two spellings of one subject is the failure this rule prevents; it
splits every count downstream and there is no automatic repair.

A topic is what the work is ABOUT. A `concept` is a TERM the person uses and what it means to them —
`topics.concepts` is where the two meet.

## `collaborative` is derived, never decided

`activities.collaborative` is true **iff** `collaborators` is non-empty; `check-records` fails the
disagreement. So the only real question is who counts as a collaborator: **anyone who appears in the
evidence for that activity** — a co-author, a reviewer on the branch, a ticket's reporter or
assignee. A solo commit stream reviewed by someone else is collaborative. The same rule holds on
`workflows.collaborative`.

## commits are pointers

Git is the store. `read-git` writes commit detail to `.perspective/commits/<base>/*.jsonl` and
**no commit record ever exists** — an activity carries `commits` as an array of SHAs (7–40 hex,
text), plus `branches` as text, and `commit_count`. A decision extracted from a commit cites the SHA
in `source_ref` with `source_kind: git-commit`.

Two consequences worth holding: a SHA is only resolvable where the clone is, so anything a reader
needs from a commit — the subject, the date, the files — must be lifted into the record at write
time; and the SHA set is what makes an activity's provenance checkable, so write every SHA in the
candidate, not a sample.
