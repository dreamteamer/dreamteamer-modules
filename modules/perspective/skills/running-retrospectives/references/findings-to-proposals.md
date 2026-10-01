# from evidence to findings, and from findings to proposals

## §1 — writing findings (stage **find**)

A finding is ONE observation about how the person works, with the records behind it. Write it only
when you can point at the evidence; `evidence_count` is the number of DISTINCT sessions or windows,
not the number of refs.

| you saw | `kind` |
|---|---|
| the same question opening several sessions | `recurring-question` |
| the same repo, product or effort across many sessions and weeks | `workstream` |
| the same sequence of steps done by hand more than once | `workflow` — **write the sequence itself as an `perspective/workflows` record at the extract stage** (it has ordered `steps`, and a finding does not). A `workflow` FINDING now exists only to carry the observation ABOUT it — the count, the `standing`, the confirmation path — and cites the workflow's activities |
| corrections, rejections, denials clustering on one thing | `friction` |
| the person knew something the agent did not, repeatedly | `knowledge-gap` |
| who they are / what they own, from behaviour not self-report | `role` · `responsibility` |
| a number worth watching | `metric` |
| anything else true and transferable | `insight` — **a conclusion that cites two or more FINDINGS and states a consequence is an `perspective/insights` record**, not a third finding; `kind: insight` stays for a single observation |

**What may be cited as evidence.** `findings.evidence` is an array of qualified refs over
`conversations`, `activity-weeks`, `questions`, `activities`, `tickets`, `threads` and `decisions` — that is
`EVIDENCE_COLLECTIONS` in `bin/check-records.mjs`, and the body's closing count may use any of those
as its unit (`(4 activities)`, `(7 tickets)`, `(3 decisions)`). An activity is the natural evidence
for a `workstream` finding, a decision for a `recurring-question` one, a ticket for `friction`.
A **deliverable** is NOT evidence — a document store keeps one last modifier per file, so a
deliverable proves the person touched a file last and nothing more. Cite the activity that carries
the deliverable, and name the document in the body. The list and the count-tail regex are kept in
step by a test; widening one without the other fails the suite.

Rules: `standing: anecdote` under three, `pattern` at three or more — and it stays until the person
speaks. `needs_confirmation: true` on anything the evidence suggests but cannot settle; it becomes a
gap question. The body ends with `(N sessions)` (or windows / answers) — `check-records.mjs` fails one
that does not. Never write a finding from what the person SAID about themselves in a paste-back alone;
that is `interview-only` evidence and the answer record is the finding's evidence.

## §2 — writing proposals (stage **propose**)

**The rule:**

| finding `kind` + `standing: confirmed` | becomes |
|---|---|
| `recurring-question` · `workstream` | a **collection** |
| `workflow` | a **skill** — or a **command** when the person names a trigger word for it. See "a workflow record becomes a proposal" below |
| `friction` | a **command**, or a line in the workspace's instructions (then no proposal record — write the line and cite the finding in the commit) |
| `role` · `responsibility` · `metric` · `insight` · `knowledge-gap` | nothing on their own — they shape `description`, `use_when` and the skill's wording |
| anything with `standing: anecdote` or `refuted` | nothing. Ever. |

### a confirmed `workflow` record becomes a proposal

A `workflows` record already holds the thing a proposal needs: an ordered `steps` array in the
person's own vocabulary, a `trigger`, the `activities` it was observed in, and a `frequency`. Once
the person confirms it, it becomes one of two shapes — and `workflows.proposed_as` is set to the
proposal, so the observation and the proposal never drift apart.

| the steps look like | propose |
|---|---|
| a judgement repeated — the same decisions taken the same way, with no record changing state between them | **one skill**, whose body is the steps as the procedure and whose `description` is the `trigger` as a trigger line |
| each step ENDS with a record in a new state — a field filled, a status moved, a file landed | **a command chain**: one command per step, `steps[N]`'s output field being `can-exit` on step N and `can-enter` on step N+1 (the engine's chain rule, `using-dreamteamer/references/commands.md`) |
| one step, however often it recurs | **one command**, not a chain |

Writing the chain: the `steps` array IS the command sequence, in order — one `<verb>-<object>`
command name per step, each body loading the skill that owns the procedure and naming only its
scope and its done condition. Name in the proposal body which FIELD carries each gate; a step with
no field to gate on is the honest reason to propose a skill instead, and saying that is better than
inventing a proxy field a human must remember to set.

**Cap:** four collections and one skill per session. One collection is a valid outcome; zero is
reported as "the evidence and the interview did not justify a collection yet", with the findings kept.

**`basis`:** `evidence-and-interview` when every cited finding is `confirmed` and at least one has a
non-answer evidence ref (an activity, a decision, a conversation or an activity-week all count);
`interview-only` when the cited findings' evidence is answers only; `evidence-only` is legal but must
be said aloud — it means nobody confirmed it, and it is what every unattended run writes.

**The body of a `collection` proposal — the engine's proposal contract:**

1. the complete draft descriptor YAML (name, description, use_when, storage, id, schema with
   `required`, every field with a description, `list_fields` from the Q10 answer);
2. ONE sample record as the `dt add <name> --field value …` line that would create it, from real
   evidence;
3. the "deliberately not modelled" list, each with its one-line reason (the Q12 answer goes here).

A `skill` proposal's body is the draft `SKILL.md` — frontmatter with a trigger `description`, then
the procedure the workflow finding observed, in the person's vocabulary.

**Putting a proposal to the person:** name it, say which findings and which answers it rests on (by
count, in words), show the fields in one line, say what is deliberately left out, then: **accept,
edit, or reject?** Record the decision at once:

- accept → `dt set perspective/proposals/<id> status=accepted`
- edit → apply the edit to the body (the body is the agreed draft) and `status=edited`
- reject → `status=rejected rejected_because="<their words>"`, then rerun the proposal pass: a
  rejection may fold into a neighbour ("that is the same as a pending decision").
