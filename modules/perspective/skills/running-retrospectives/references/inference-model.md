# the inference model — what is read out of what, and what may never be

Every record this module writes sits on ONE rung of a ladder, and each rung is read out of the rung
below it — never out of thin air, and never out of what the person said about themselves. This file
is the ladder, written down once so that a run on a new contributor does not have to rediscover it,
and so that a record found on the wrong rung can be named as the defect it is.

The same ladder holds for very different contributors: one with a thousand coding sessions and a
full commit history, one with hundreds of tickets and no transcripts, and one with two dozen tickets
whose actual output is a shelf of product specifications in a document store. **What changes is
which rungs are empty and have to say so.**

## the ladder

```
  evidence      tickets · deliverables · threads · conversations · commits · activity-weeks · sources
     │            counted, never judged. A reader writes these and nothing else.
     ▼
  observed      activities · topics · users
     │            RECONSTRUCTED: a bounded piece of work, named in the person's vocabulary, with
     │            every evidence ref that places it there attached. The rung most of the model rests on.
     ▼
  grouped       projects
     │            the efforts activities cluster into. Every activity gets one; none is left over.
     ▼
  extracted     decisions · concepts · workflows
     │            a fork and which way it went · a term with one stable meaning · an ordered sequence
     │            seen three or more times. Each cites the activity or ticket it was read out of.
     ▼
  inferred      goals
     │            what the person was trying to make TRUE, read BACKWARDS out of decisions, project
     │            arcs and activities. Earns a record only when it EXCLUDES something.
     ▼
  found         findings
     │            one observation about how the person works, with a count of DISTINCT records behind
     │            it. anecdote under three, pattern at three or more, and it stays there until they speak.
     ▼
  concluded     insights
     │            two or more findings pointing the same way, and the consequence — the "so what".
     ▼
  asked         questions  (+ suggested answers)
     │            what the evidence could not settle, one record each, BEFORE it is asked.
     ▼
  proposed      proposals
     │            what the brain should keep and do — a collection, field, skill, command, routine
     │            or view — justified by pattern findings, with the draft descriptor as its body.
     ▼
  synthesised   perspective
                  one document, every claim pointing at a record on a lower rung.
```

Three rules make it a ladder and not a pile:

1. **A record cites the rung below it, never the rung above.** A finding cites activities, tickets
   and decisions; a goal cites projects, activities and decisions; an insight cites findings; a
   proposal cites findings. Nothing on a lower rung points up — an activity does not know which
   finding it supports. This is what makes a rung deletable without dangling anything above it.
2. **Every rung has a FORCING field and a COUNT.** The forcing field is the one a record cannot be
   written without (`name` on an activity, `statement` on a goal, `text` on a question); the count is
   the number of DISTINCT lower-rung records attached (`evidence_count`, `activities_count`,
   `commit_count`). `check-records` enforces that the count and the refs agree and that `standing`
   agrees with the count. A count that is higher than the refs is the most common defect and the
   easiest to make — reconcile to the refs, never the other way.
3. **A rung the evidence cannot reach is left empty and SAID to be empty.** A contributor with no
   transcripts has no `conversations`; every session, turn and token figure on their records is
   ABSENT — never 0, which is a measurement. Their `sources` record carries `reach: unavailable`,
   and their perspective opens by saying which rungs are thin. Silence about a gap is the one thing
   that turns an honest partial model into a confidently wrong one.

## per rung — read out of, refused when

| rung | read out of | refused when |
|---|---|---|
| activities | evidence records, pre-clustered mechanically (`cluster-activities.mjs`) then NAMED by judgement | named "worked on `<repo>`"; carrying fewer evidence refs than the candidate listed; `collaborative` disagreeing with `collaborators` |
| topics | the subject several activities share | a second topic for a second spelling — that is an `alias` |
| users | EVERY handle a reader meets — commit author, ticket assignee, **ticket follower, comment author**, mail counterpart — keyed on an email or a system id | a merge on a display NAME (two people share one; the guard fails a handle on two records); a new record landing on an existing record's id and silently replacing it (`lib/collaborators.mjs` steps aside and says so in the body); a reader that writes only the person it was LOOKING AT — assignees alone leave a contributor who self-assigns every ticket with one collaborator, themselves, while the same records name their counterparts in fields the reader fetched |
| projects | the effort a group of activities belongs to | an activity left with no project; a project with no lifecycle judgement in its body |
| decisions | a source that STATES a choice — a ticket comment, a commit message, a digest, a log row, a mail thread (`email`, cited as the thread record; the body is read in the client, never copied). A spec is a decision record: its revisions say what it stopped doing | a `rationale` the source did not give; a `source_ref` whose shape does not match `source_kind` — and note a DELIVERABLE is not a legal source kind, so a document-only decision cites the ticket if one exists and otherwise names the document in the body |
| concepts | a term with the same meaning across three or more uses | one striking use; a term whose meaning drifts (that is a topic) |
| workflows | the same step order in THREE or more activities | two activities — a coincidence; steps not in the person's vocabulary |
| goals | decisions, project arcs and activities, read backwards | "ship the product" — a goal that excludes nothing predicts nothing. Name the fork it would have let you predict before writing it, or do not write it. Never from what the person SAID they wanted — that is an answered question |
| findings | activities, tickets, threads, decisions, conversations, activity-weeks, answered questions | a body without its `(N <unit>)` tail; a `pattern` under three; `confirmed`/`refuted` without an ANSWERED question in `evidence` |
| insights | two or more findings | one finding — that is the finding |
| questions | every finding with `needs_confirmation: true`, every anecdote, and the evidence gap itself | an `answer` nobody gave — see the suggestion rule below |
| proposals | `pattern` findings (unattended: `basis: evidence-only`) | an anecdote; a `refuted` finding; a collection proposal whose body is not a draft descriptor |
| perspective | everything above, with a ref per claim | a `role` taken from a title or a self-description; any claim without a record behind it |

## the mailbox as a source — and why it is the thinnest record here

A mailbox reaches a rung no other source does: **who the person actually corresponds with**, and how
much of their week is correspondence rather than output. It is also the most personal store the module
reads, and a workspace is cloned onto other machines. So `read-gmail` keeps subject, participant
handles, counts and dates — and refuses bodies, snippets, attachments and labels. A thread is
evidence of contact and load; what was SAID in it is read in the mail client by `url` when a pass must,
and is never copied into a record. The query is `from:<contributor>`: a thread they only received is
noise, exactly as a file they only read is in Drive.

## the document-shaped contributor

A ticket board can say one person did a fortieth of another's work while the document store shows
the first person wrote every product specification the second one built from. **An evidence source that is absent for a person is a fact
about the SOURCE, not about the person** — and a module that can only read boards would have
profiled a product owner as nearly idle.

Three tells that a contributor is document-shaped, any one of which is enough to run `read-drive`
before anything else:

- **a ticket count an order of magnitude below their peers'** on the same board, in the same period;
- **their tickets are mostly defects they FILED**, not work they were assigned — the board is where
  they report, not where they work;
- **ticket titles and document titles name the same features**, with the documents earlier.

What still measures cleanly when the board is thin — each with the question it answers:

| measure | computed as | the question |
|---|---|---|
| **ticket-free activity ratio** | activities with `deliverables` and no `tickets` ÷ all activities | how much of the work the board cannot see at all |
| **revisions per spec** | deliverables per activity, where the titles carry version or `OLD`/`final`/`rev` markers | how long a spec is argued before it settles |
| **spec-first lead** | days between a spec's first deliverable and the first ticket naming the same feature | how far ahead of engineering the thinking runs |
| **days to first human comment** | on the tickets they filed — from `created_on` to the first non-system story | how long a report waits before anyone engages |
| **defect-vs-spec share** | tickets ÷ (tickets + deliverables) per project | which projects they specify and which they only QA |
| **partner-facing share** | activities on partner/integration topics ÷ all | how much of the role is outward-facing, from the artefacts alone |
| **unreachable share** | deliverables whose `container` the reading account is not a member of ÷ all | how partial even the document view is |

**Every one of these is a count over records that already exist.** None needs a new field, and
none is worth a record of its own — they belong in the perspective body, next to the claim each
supports, with the filter that reproduces them.

And the ceiling every record of theirs must carry, in one sentence: **a document store keeps ONE
last modifier per file, so a deliverable is evidence they touched it LAST — never that they authored
it alone, and never the files they only read.** Their reasoning is nowhere in this evidence; only
their output is. The knowledge-gap findings on such a run are about what the store cannot see, and
they are as important as any finding about the person.

## a derivation ADDS — the rule that stops a pass eating a person's work

Several rungs are filled by a deterministic pass over lower-rung records: evidence onto activities,
people onto activities, counts onto everything. Each is written once and re-run often, and the
temptation every time is to make the write a REPLACEMENT — recompute the field, write the answer,
done. That is correct exactly once, on a rung nothing else has touched.

**On any rung a person may also have written, the write is a UNION.** A mature workspace routinely
holds collaborators a naming pass typed by hand. A replacing write deletes every one the evidence
cannot re-derive, and its receipt says "touched" and looks like success. A person reading a ticket comment knows things the ticket record does not carry; the script
does not. So:

- **add what the evidence proves**, and
- **correct a DERIVED flag** (`collaborative` must agree with `collaborators`, and a stale `true` is
  a defect either way), but
- **never delete what you merely failed to find.** A ref that is actually wrong is caught by
  `check-records`, which is the thing that knows.

Same shape for the counts: `evidence_count` reconciles to the refs, never the refs to the count.

## the two-way ceiling on identity

A person key is an **email or a system id**, never a display name — that is the merge rule. Its
consequence at read time is easy to miss: **a field that gives you only a name is not evidence of a
person**, however clearly a human can read it. A ticket's comment trail renders as
`**Some Name · <date>**`; parsing a name out of it to get a counterpart is the merge-by-name refusal
wearing a regex, and it will attribute one person's work to another the first time two colleagues
share a first name.

The fix is at the READER, not the parser: the API carries the email (`created_by.email`,
`followers.email`), and a reader that keeps only the name has thrown it away. **When a name is all
you have, the gap is in what was stored — go back to the source, not to the string.**

## suggestions — the inference the interview runs on

A run that has reached the `found` rung can almost always say what the person is LIKELY to answer.
That inference is useful — it shortens the interview and hands the person something to correct
rather than a blank — and it is not their words. So it has its own field and its own evidence:

- **`suggested_answer`** on the question record — what the run infers they would say, in plain
  words, hedged where the evidence hedges.
- **`suggestion_evidence`** — the records it was read out of. **A suggestion with none is a guess
  wearing a record, and `check-records` refuses it.**
- **`answer` stays EMPTY** until the person speaks. An `answer` byte-identical to the suggestion is
  refused: the machine may not quote itself in the one field where only the person speaks, and an
  interviewer who pastes the suggestion because the person nodded has changed `answer_origin` into a
  lie. Record what they actually said, however close.

When they do answer, **keep the suggestion.** The gap between the two is the measurement of how good
the inference was — the one calibration signal this module gets, and it costs nothing to keep.

## the run shape that works, and the one that does not

The same failure recurs every time a stage is given too much at once: **one agent handed a whole
corpus reads for tens of minutes and writes nothing.** The shape that works:

1. **pre-cluster deterministically** (`cluster-activities.mjs` — shared tokens and dates), so the
   judgement stage names candidates rather than discovering them;
2. **slice small** — a naming agent gets five to ten candidates, never the file;
3. **run the extracted, inferred and found rungs IN PARALLEL** once activities exist — decisions,
   concepts, workflows, goals and each finding LENS (workstream · friction · knowledge-gap ·
   workflow) are independent reads of the same activities, and eight agents at once finish in the
   time one would spend orienting;
4. **conclude LAST and alone** — questions, proposals and the perspective read everything above
   them, so they wait for the barrier;
5. **audit before advancing the stage** — every `evidence_count` against its refs, every finding
   body's tail, duplicate activities from parallel slices (two slices WILL name the same effort
   twice; merge, do not keep both), then `check` with its exit code quoted.

## what NOT to write into this skill

This file describes a method and cites no one. **No name, handle, email, company, product,
document title or figure from any run belongs here** — a measurement keeps its numbers and never its
source's identity, and a recipe that names a person cannot be published or copied. When a run
teaches something new about the METHOD, it comes here stripped; what it taught about the PERSON
stays in their workspace.
