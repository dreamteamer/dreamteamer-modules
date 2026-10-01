---
name: running-retrospectives
description: use when someone's own work should be read and an operating model built from it — /run-retrospective, "run a retrospective", "reflect on my work", "set up my second brain", "what do I keep re-finding", "who do I work with", "what was I working on in August", "build a perspective for a teammate", "what is my role, from the evidence"; resuming a run at its stage (installed · inventoried · read · clustered · projected · extracted · inferred · found · interviewed · proposed · synthesised · materialised · seeded); writing findings, activities, topics, decisions, workflows, concepts, insights or proposals; judging a conversation digest; importing a ChatGPT or Gemini paste-back; reading a Drive (`read-drive`) or a mailbox (`read-gmail`) as evidence. The mechanics behind /run-retrospective.
---

# running retrospectives

| the question | read |
|---|---|
| what a candidate is, how an activity is named, topic reuse | `references/clustering.md` |
| handles, merging, when a `contact` may be set | `references/identity.md` |
| which questions to generate, which to ask, in what order | `references/interview-banks.md` |
| what a finding becomes, and what a workflow becomes | `references/findings-to-proposals.md` |
| what number to write and what question it answers | `references/metrics.md` |
| the ladder — what each rung is read out of and refused when · the document-shaped contributor · suggested answers · the run shape that works | `references/inference-model.md` |
| the judging loop · the paste-back prompts | `references/collecting.md` |
| how a digest is scored | `references/interest-score.md` |
| what a transcript looks like · how acts are counted | `references/transcript-format.md` · `references/dialogue-acts.md` |

The design is `rnd/product-design-docs/2026-09-08--perspective-v2-the-perspective-model` over
`…/2026-09-07--the-perspective-module-a-recipe-that-arrives-with-a-job` (§3 stages, §13 decisions,
both still binding). This file is the procedure; those records are the why.

## core principle

**A run is one contributor's PERSPECTIVE** — their role as observed, the terms they actually use,
what they worked on and with whom, and the commands, skills, routines and workflows they run.
`perspective/retrospective-sessions` holds the run; `stage` is the gate; `perspectives` is the output.
Seven rules hold at every stage:

1. **One run, one contributor, and two fields say who.** `retrospective-sessions.contributor` is a
   SLUG (`dana-o`) — the first segment of every evidence and model id the run writes, so a re-run
   updates the model rather than copying it. `handles` is the list of addresses the evidence carries
   them under, and it is what every reader matches on. A second person is a second run, cross-linked
   through `world/users` and `world/activities` — there is no org-level record, because nobody has that view.
2. **Every stage is idempotent, and `tests/idempotency.test.mjs` is what makes that true.** Running a
   stage twice writes the same records, changes no id, and leaves the record tree BYTE-IDENTICAL
   apart from a three-entry allowlist (`last_seen_in`, `inspected_at`, and the stage's own run-log
   line). It was asserted in prose here for months and proved nowhere, and two defects came out of
   that gap in one week: a reader that dropped a week's judged summary on every re-read because it
   looked at the pre-rename path, and an attach pass whose receipt claimed a write it had not made.
   Before any stage: `dt get perspective/retrospective-sessions/<id>`, then list what that stage
   writes, filtered to this run. Every script honours `--dry-run`; run it first when unsure.
   ⚠ The gate also refuses a stage that writes NOTHING — a stage given the wrong flags, or an empty
   fixture, would otherwise pass by doing nothing at all.
3. **The observed world lives in `perspective/world`, in the real world's own nouns.**
   `world/users` · `world/projects` · `world/activity-lanes` · `world/activities` · `world/tasks` ·
   `world/goals` mirror the shapes `users` and `projects` ship, in a SEPARATE store — never an `extends:` overlay, because a
   merged collection could not tell a record a run FOUND from one a person WROTE. Each carries
   **`real`**, a one-way SOFT reference to the authored record it appears to be. ⚠ `real` is a
   PROPOSAL a person confirms, exactly like `contact`: no script and no pass ever sets it, and the
   world object never enters the person's own collections.
   ⚠ **Every OTHER reference stays inside the layer.** An observed activity's `project` and `lane`
   name `perspective/world/projects` and `perspective/world/activity-lanes`, never the real
   collections — `real` is the only crossing there is, and `tests/world-model.test.mjs` holds that
   over the whole namespace so the next collection added here cannot get it wrong quietly.
   ⚠ **Four contributors on one project get four observed copies of the same real thing, on purpose.**
   The contributor is the first segment of every world id, so a shared record would mean four runs
   writing one file and the last one silently winning. Four views of one activity that DISAGREE about
   its dates or its status is the most interesting output the exercise has; `real` is what joins them
   — "who else observed this" is `dt list perspective/world/activities --filter real=<ref>`.
4. **Nothing here is authored truth — observed or derived only.** An activity is RECONSTRUCTED from
   sessions, commits and tickets; a decision is EXTRACTED from a source; a workflow is IDENTIFIED
   across activities; a concept is a term the person was SEEN to use; a role is behaviour, never a
   title. If you cannot name the evidence, do not write the record. This module never holds a domain
   object — those belong to the person's own module.
5. **Never read a raw transcript into your context.** One file on this machine is 156 MB and the
   useful content sits at ~50:1 under tool noise. `bin/digest.mjs <conversation-id>` is the only
   sanctioned way to read a conversation; readers return receipts and bounded artifacts.
6. **Mechanical beats judged.** `conversations` fields are tiered MECHANICAL / HEURISTIC / JUDGED in
   their descriptions. Judged fields are written ONLY through `bin/record-judgement.mjs`, which
   rejects a payload carrying any other key. `dt set` on a conversation is never the move.
7. **Evidence counts live in the schema, and `check-records` enforces them.** A finding carries
   `evidence_count` and `standing`; an insight cites at least two findings; a proposal may not cite a
   `refuted` finding; a body without its `(n sessions)` fails; an absolute path where a `${…}`
   template belongs fails; `world/activities.collaborative` must agree with `collaborators`; a `real` that
   points at the wrong real collection fails, and one that resolves to nothing WARNS.

⚠ **`dt` array fields: a repeated flag is one ELEMENT, and every value is ALSO split on commas.**
Measured on engine 0.21.0 (2026-09-08): `--aliases one --aliases two --aliases three` yields
`[one, two, three]`. So write one flag per element — `--evidence <ref> --evidence <ref>` — and keep
commas OUT of item text (use ` — `), because `"a, b"` in one flag becomes two elements. An older engine
overwrote on repeat; that is no longer true, and a claim either way is settled by `cat` on the record.

## the hint grammar — `/run-retrospective [hint]`

The hint is kept **verbatim** on `retrospective-sessions.hint` and re-read by every later invocation, so a
resumed run keeps the scope it was given. Unrecognised text is prose: it goes on `hint`, it may
name the run's `label`, and it never silently changes a flag.

| token | example | what it changes |
|---|---|---|
| `period:YYYY-MM` | `period:2026-08` | `period_start`/`period_end` to the month's bounds; `--since <first>` on every reader; the cluster window and the perspective's period |
| `since:YYYY-MM-DD` | `since:2026-06-01` | `period_start`; `--since` on `read-claude-transcripts`, `read-git`, `read-asana`. No upper bound |
| `weeks:N` | `weeks:8` | how far back the WEEKLY windows go — `--weeks N` on `read-git` and `read-claude-transcripts`, written to `activity_weeks_back`. Default **4**: a perspective is about the recent shape of the work, and all-of-history weekly records were the wrong first artefact. Conversations and tickets are never bounded by this; `since:` bounds those |
| `until:YYYY-MM-DD` | `until:2026-08-31` | `period_end` only. **No reader takes `--until`** — the readers over-read and the cluster and synthesise passes drop evidence after the date. Say so in the receipt |
| `sources:a,b` | `sources:git,asana` | which collect readers run THIS invocation, out of `git · asana · claude · paste-back`. It does NOT set `reach` — an unread source is simply not read yet, and a later run with a wider hint collects it |
| `contributor:<email>` | `contributor:dev@example.test` | appended to `retrospective-sessions.handles`; `--contributor` on `read-git` and `read-asana`; and it selects WHICH retrospective a bare `/run-retrospective` resumes. ⚠ It does NOT set `contributor`, which is the slug the ids are keyed by — give every address the person commits, files and writes under, because a reader attributes a row it cannot match to somebody else |
| `repos:<slug>,<slug>` | `repos:api,web` | narrows `read-git` to those `repos` records — one invocation per repo with `--repo-path`. The inventory is untouched |

## the stages

`SK=<perspective>/skills/running-retrospectives` — `<perspective>` is `node_modules/@dreamteamer/perspective` from npm, `modules/perspective` for a copy. ⚠ **Every script takes
`--retrospective <ref>`** — there is no `--session` any more. It was a real split until 2026-09-09,
when v1 and v2 collections carried different link fields; the rename collapsed both into one, and a
script given the old flag now exits 2 with a usage line. `tests/skill-flags.test.mjs` reads the flags
out of this file and asks each script whether it knows them, because this table IS the procedure.
All take `--dry-run`.

| # | stage → sets `stage` | run | writes |
|---|---|---|---|
| 1 | **install** → `installed` | the module is present, `npm install && npm run compile` clean. `/run-retrospective` creates the run record | `retrospective-sessions` |
| 2 | **inventory** → `inventoried` | `node $SK/bin/inventory.mjs --retrospective <ref>` — walks `${env:REPOS_FOLDER}` (depth 3) and this workspace for checkouts, every `~/.claude*` tree, `~/.codex/sessions`, `~/.gemini/tmp`, and `data/`; registers unknown checkouts in `repos`. Then ASK about every `available` source before reading it; a declined answer is `dt set perspective/sources/<id> reach=declined` and is never re-asked. ⚠ `sources.retrospectives` is a LIST and the readers APPEND this run to it — the session's own `sources[]` is the GENERATED mirror of it, so it needs no write. Append the stage's line to the session's body — a session that does not say what it saw is the defect this stage exists to prevent | `sources`, `repos` |
| 3 | **read** → `read` | the readers the hint's `sources:` names, each quoting its receipt line: `read-claude-transcripts.mjs --retrospective <ref> [--since]` · `read-git.mjs --retrospective <ref> [--since] [--repo-path] [--contributor <email>]` · `read-asana.mjs --retrospective <ref> --contributor <email-or-gid> [--workspace] [--since]` (needs `ASANA_PAT` in `.env`) · then the **judging loop** (`references/collecting.md`). Then the paste-back: hand over the two prompts in `references/collecting.md` and `import-paste-back.mjs <file> --retrospective <ref> --origin paste-back-chatgpt\|paste-back-gemini\|paste-back-other` (the reply lands in the BODY of that tool's `sources` record — a second paste-back months later APPENDS under its own dated heading, because what the tool remembers CHANGING is the evidence). Declining the paste-back is normal — say so in that source's body and leave its `reach` as `declined`. ⚠ The WORKSPACE is a source too: `node $SK/bin/init.mjs --retrospective <ref>` reads this workspace's own collection and skill vocabulary into `terms` (`origin: workspace`, one per name the workspace already defines) and the `concepts` those terms express, its `agent-decision-log` and `DECISION-LOG.md` rows into `world/decisions` (`source_kind: decision-log`), and the perspective skeleton with its inline `commands · skills · routines`. It used to be a stage of its own, retired on 2026-09-09: reading the workspace is a source read like any other. A paste-back is a source too, which is why there is no longer a second paste-back stage value: `import-paste-back.mjs <file> --retrospective <ref> --origin …` lands the reply in that tool's `sources` body, and declining is normal | `conversations`, `activity-weeks`, `tickets`, `threads`, `world/deliverables`, `world/users`, `sources`, and from the workspace `terms`, `concepts`, `world/decisions`, `perspectives` |
| 4 | **cluster** → `clustered` | `node $SK/bin/cluster-activities.mjs --retrospective <ref> [--gap-days 3] [--since]` writes CANDIDATES to `.perspective/activity-candidates/<base>.jsonl` and NO records — bounded by the run's `period_start`, which deletes nothing older, only leaves it unclustered. Then `node $SK/bin/build-candidate-digest.mjs <vault> <base> <out.md>` renders those candidates as readable blocks (session titles, commit subjects, ticket descriptions and comments) — ⚠ **not optional: this is where naming quality is decided.** A candidate rendered as `repo=api, 4 commits` gets named "worked on api". Then the **clustering pass** below turns candidates into records, followed by `node $SK/bin/attach-evidence.mjs --retrospective <ref>` (attaches every session, commit, branch and ticket from each activity's `from_candidate`) then `node $SK/bin/derive-tasks.mjs --retrospective <ref>` (one `world/tasks` record per ticket a clustered activity cites — MECHANICAL, nothing judged, and it never sets `real`) and `node $SK/bin/rollup-metrics.mjs --retrospective <ref>` (owns EVERY number on an activity and on a project). ⚠ In that order, and none of the three is optional | `world/activities`, `topics`, `world/tasks` |
| 5 | **project** → `projected` | a model pass, after cluster, no script: read every activity, the ticket boards (`tickets.project`), the repos and the topics, and write `perspective/world/projects` — the logical efforts the work clusters into (kind from what it delivers: product · client · internal · venture · platform), each with `repo_names`, `ticket_projects`, `topics`, `collaborators`, `lead`, dates, counts — then set `project` on every activity (`dt set <activity> --project <ref>`). An Asana board and a repo for one effort are ONE project. Search before creating. **Then the BANDS within them:** write `perspective/world/activity-lanes` — the tracks the activities of an effort run in (a workstream, a surface, a repeating kind of job), `--order` earliest-first where the evidence says and omitted where it does not, `--project` set for a band inside one effort and LEFT EMPTY for one that crosses several — then `dt set <activity> --lane <ref>`. ⚠ A lane is not a topic: a topic is what the work was ABOUT and several topics share one lane, so if a proposed lane has exactly one topic it IS that topic and gets no record. Lanes come after projects and not at stage 4, because a band cannot be named until the activities that reveal it exist. **Then the ERAS:** read each project's own curves — `lines_new` against `lines_modified`, the bug share, the session and commit counts by week — and write `perspective/world/phases`, one per segment where the CHARACTER of the work changed, each with `--started`, `--stage exploring · building · hardening · maintaining · converged · abandoned` and a `--turn` naming what changed at the boundary. Then `dt set <activity> --phase <ref>`. ⚠ A phase whose `turn` cannot be named is not a phase, it is a slice of the calendar: a project with no visible turn gets ONE phase for its whole span, and that is the honest answer rather than a gap. ⚠ `phase` is WHEN and `lane` is WHICH TRACK — a plan banded on both axes at once has two disagreeing readings. ⚠ Never write `real` on any of the three | `world/projects`, `world/phases`, `world/activity-lanes` (and fills `world/activities.project`, `world/activities.phase` and `world/activities.lane`) |
| 6 | **extract** → `extracted` | no script — the **extraction pass** below | `workflows`, `world/decisions`, `terms`, `concepts` — the last three are created twice on purpose: once from the WORKSPACE at stage 3, once from the EVIDENCE here |
| 7 | **infer** → `inferred` | `node $SK/bin/infer-goals.mjs --retrospective <ref> [--dry-run]` proposes one goal per recurring purpose, out of the decisions, activities and projects of this run — `standing: inferred`, `evidence_count`, and the refs it inferred from. The rule is `references/inference-model.md`. ⚠ NEVER write a goal from what the person SAID about themselves: that is an answered question and belongs on the question. The interview moves `standing` to `corroborated` or `confirmed` | `world/goals` |
| 8 | **find** → `found` | write each observation with `dt add perspective/findings --retrospective <ref> --name … --kind … --evidence "<ref>,<ref>" --evidence_count N --standing anecdote\|pattern --needs_confirmation true\|false`, then a body ending `(N sessions)`. Activities and decisions are legal evidence now — see `references/findings-to-proposals.md` §1. Two or more findings with one consequence is an `insights` record, not a third finding ⚠ **AND WRITE WHAT YOU HAD TO ASSUME.** Every observation rests on something the evidence did not settle — that two handles are one person, that the repos you could reach are the work that mattered, that a quiet fortnight was rest. Each one is a `perspective/assumptions` record with a REQUIRED `wrong_if` (the observation in THIS world that would prove it wrong — never a counterfactual), an `impact`, and `affects` naming the records that rest on it. An assumption with nothing under it did not need writing; a finding whose premise is unstated is the failure this catches. | `findings`, `insights`, `assumptions` |
| 9 | **question** → `interviewed` | `references/interview-banks.md` is the whole procedure, including the min/max rule below. It also FILLS `standing` on the findings and goals the answers settle — it creates neither. ⚠ The ANSWER goes back onto the question record (`--answer` verbatim, `--answered_on`, `--answer_origin spoken\|typed\|relayed`) — `perspective/answers` was deleted 2026-09-08 ⚠ **ASSUMPTIONS ARE ASKED BEFORE GAPS.** Rank the bank by `assumptions.impact` first: an `invalidates` assumption with three `affects` is the cheapest question in the run, because one answer either steadies or re-derives everything under it. Each one asked sets `tested_by` and moves `status` to `unsettled`; the answer moves it to `confirmed` or `refuted`, and a refuted assumption's `affects` IS the re-derivation queue. Never settle one from more evidence of the kind that produced it — only a person's answer, or an observation matching `wrong_if`, counts. | `questions` |
| 10 | **propose** → `proposed` | `references/findings-to-proposals.md` §2. At most four collections and one skill; a collection proposal's body IS its draft descriptor; a confirmed `workflow` becomes a skill or a command chain, its `steps` becoming the command sequence. Put them one at a time: accept · edit · reject | `proposals` |
| 11 | **synthesise** → `synthesised` | `node $SK/bin/synthesize-perspective.mjs --retrospective <ref>` fills the perspective's MECHANICAL fields — the counts, the refs, the period. Then the **role pass** below writes `role`, `summary` and the body with `dt set` and a body edit, and `dt set perspective/retrospective-sessions/<id> perspective=perspective/perspectives/<id>` | `perspectives` (created at stage 3, filled here) |
| 12 | **materialise** → `materialised` | per accepted or edited collection proposal: `dt add collections --name <n> --module <target_module> --description … --use-when …`, then `dt add-field <n> --name … --type … --description …` per field (system writes commit themselves); a skill proposal lands as `modules/<target_module>/skills/<id>/SKILL.md`. Set `materialized_as` and `status=materialised` | descriptors, skills |
| 13 | **seed** → `seeded` | three to five REAL records per new collection, each pulled from evidence and CONFIRMED before `dt add`. Never a test record | the person's records |
| — | **done** → `done` / `abandoned` | `npm run compile && npm run check` (quote both), `dt commit <collection>/<id> …` scoped to what this run wrote, then `dt set perspective/retrospective-sessions/<id> stage=done finished=<today> produced="<collection>,skills/<id>"`. Say plainly: the test is whether a record gets added tomorrow without help | — |

⚠ **EVERY STAGE BOUNDARY IS GATED, and the gates are records.** Before advancing past a stage, evaluate
the `perspective/gates` whose `stage` names it and write one record each — `pass`, `unmet`, `waived`
or `not-run`, every verdict but the last carrying `measured`: the count, the command's own line, or
the person's words. `gates` is the one collection written at **every stage boundary** rather than by a
single stage. The twelve are defined in `perspective/gates`' own descriptor; the ones for a stage are
whichever name it.

Three rules that make them worth writing rather than a ritual:
- **A `pass` with no `measured` is refused** by `bin/check-records.mjs`, because a verdict without a
  measurement is success being reported instead of a result being quoted.
- **`not-run` is honest and is not `pass`.** A gate nobody evaluated says so; inventing a pass to tidy
  the board is the worst thing this collection can be used for.
- **A `waived` gate needs `waived_because`**, and its `affects` names what the perspective may
  therefore no longer claim. A waiver is a narrowing, recorded — not a shortcut.

Exactly ONE stage per invocation unless the person says "keep going". Advance `stage` only after the
stage's records are on disk, its gates are written, and `npm run check` is clean.

## the model-driven passes

Each runs as a subagent brief on a cheaper model than the coordinator's, in waves of at most six.
Give the subagent the brief verbatim; it writes records itself and reports counts, never prose about
what it might write.

**clustering (stage 4)** — one wave per slice of the candidates file:

> Read `.perspective/activity-candidates/<base>.jsonl`, lines N–M. Each line is a candidate: a
> gap-bounded run of sessions, commits and tickets with dates, repos, branches, subjects and
> handles. Read the candidate; read a digest (`node $SK/bin/digest.mjs <conversation-id>`) only when
> a candidate cannot be named from it. For each: decide whether it is one activity or several
> (`references/clustering.md`), name it as the person would name the task in their own vocabulary —
> never "worked on repo X" — then list existing topics (`dt list perspective/topics --filter
> retrospective=<ref>`) and REUSE one by name or alias before creating any. Write with `dt add
> perspective/world/activities --retrospective <ref> --name … --started … --ended … --status
> done|ongoing|abandoned|unknown --topics "…" --collaborators "…" --sessions "…" --commits "…"
> --branches "…" --tickets "…" --repos "…" --commit_count N --collaborative true|false`.
> `collaborative` is true iff `collaborators` is non-empty — check-records enforces the agreement.
> Report: activities written, topics created, topics reused, candidates merged, candidates split.
> ⚠ Do NOT write `real` on anything. The join out to the workspace's own `activities`, `projects`,
> `phases`, `activity-lanes`, `users`, `tasks`, `goals`, `decisions` and `deliverables` is a PROPOSAL a
> person confirms — a run that sets it is authoring truth.

**extraction (stage 6)** — three passes, each with a hard gate:

> **Decisions.** From conversation digests and commit subjects only. One record per decision:
> `dt add perspective/world/decisions --retrospective <ref> --name "<the decision in one line>"
> --source_kind agent-session|git-commit|decision-log|ticket|meeting|interview|email --source_ref <the
> identifier, shaped for the kind: a conversation ref · a 7–40 hex SHA · agent-decision-log/<id> or
> DECISION-LOG.md#<row> · a tickets ref · a meetings ref · a questions ref · a threads ref> --decided_on <date>
> --decision "<what was decided, in the source's words>" [--rationale "<why, in the source's
> words>"] --decided_by person|agent|unknown [--decider <world/users ref>] [--agent "<agent (model)>"]`.
> **Omit `rationale` when the source gave none — never supply one.**
> ⚠ **`--decided_by unknown` IS THE DEFAULT AND USUALLY THE RIGHT ANSWER.** A commit message states a
> choice and names nobody; whoever happened to author the commit is not evidence that they decided
> it. Set `person` only where the source actually SAYS who decided, and `agent` only where the source
> is an agent's own log. `collaborators` is who was present — a different claim, and a weaker one.
> ⚠ **`alternatives`, `reversibility` and the decider's own `wrong_if` are NOT on this collection**,
> deliberately: they are required on the authored `decisions` because a person can be asked for them,
> and evidence does not contain them. Wanting them is a `questions` record, never a field you fill.
> **Workflows.** Only where the SAME step order appears in **three or more activities**. Two is a
> coincidence and gets no record. `--steps` is ordered, one line each, in the contributor's
> vocabulary, one `--steps` flag per step with no commas inside a step; `--activities` names the three
> or more it was observed in; `--trigger` is what starts it; `--frequency` is as observed.
> **Vocabulary — TWO STEPS, in this order, and never collapsed into one.**
> **(a) IDENTIFY.** Every word or phrase used **three or more times** gets a `perspective/terms`
> record, `--name` VERBATIM (case and punctuation as written — the whole point is that it can be
> grepped for in the corpus it came from), `--spellings` for the other surface forms of the SAME
> word, `--occurrences N` counted not estimated, `--first_used` / `--last_used`, `--origin
> conversation|ticket|commit|document`, `--evidence "<refs>"`. This half is nearly mechanical: it
> asks what recurs, not what it means. Leave `--classification identified`.
> **(b) CLASSIFY.** Now read the terms together. `dt list perspective/concepts --filter
> retrospective=<ref>` FIRST, and point each term at the concept it expresses — `dt set
> perspective/terms/<id> concept=<ref> classification=classified`. Mint a `concepts` record only
> where none fits: `--definition` is what it means TO THEM, written FROM the quoted uses in the
> terms' bodies and never ahead of them; `--kind`; `--origin`; `--related_to` for the real-world
> records it names and `--classifies` for the observed-world objects it is about.
> ⚠ **MANY TERMS, ONE CONCEPT.** Three spellings of one idea are three terms and one concept. A
> concept per term is a glossary of near-duplicates, which is the shape this split exists to stop.
> ⚠ **A TERM WHOSE MEANING DRIFTS BETWEEN USES IS `--classification ambiguous`**, not a concept and
> not a guess: it generates a gap question. And a word that turned out to be a project name or
> somebody's initials is `--classification discarded`.
> ⚠ **LEAVING TERMS `identified` IS HONEST AND IS THE POINT.** The count left unclassified is the
> measure of how far this pass actually got. Driving it to zero by minting a concept per term has
> not understood more, it has only hidden the residue. Report both numbers.
> ⚠ **`terms.mentions` IS SELECTIVE.** Link a term to a world record only where a reader who does not
> know the word could not understand the record. A term used in ninety activities is this person's
> vocabulary, not that record's, and linking all ninety makes the generated mirror worthless on every
> one of them. `concepts.classifies` is the broad edge; this is the narrow one.

**the role pass (stage 11)** — after `synthesize-perspective.mjs` has filled the counts:

> Write `perspectives.role` from BEHAVIOUR, never from a title and never from what anyone said about
> themselves: what this person does all day, in one line, defensible from the activities, the
> workflows, the dialogue-act mix and the commit shape (`references/metrics.md` for which number
> answers which question). Then `summary` in a paragraph, then the body: role · the DSL · topics ·
> collaborators · the operational model (which of the inline commands, skills and routines are
> actually used, and which are not) · what is proposed. Every claim in it points at a record.

## identity — handles are the merge key

`references/identity.md` is the authority. The four rules that bind here:

- **`world/users.handles` is the merge key**, and both `read-git` and `read-asana` write into it.
  One person commits under several identities routinely — a noreply address, two machines, a display
  name spelled two ways.
- **Never merge two collaborator records without a person deciding it.** A wrong merge attributes
  one person's work to another, which is the worst error this module can make.
- **`contact` points at the workspace's own CRM record, set only on confirmation** — never inferred
  from a matching name. It is a real `x-reference: contacts` on both `world/users` and
  `retrospective-sessions`, which a recipe compiles without because `contacts` is a declared PEER.
- **`retrospective-sessions.handles` is the seed of the merge**, and the only identity a reader has
  on its FIRST pass, before any `world/users` record exists. `lib/identity.mjs` is the one place
  the union is computed; it was four near-copies in four scripts until 2026-09-09, three of which
  were comparing the slug to a list of email addresses and therefore matching nothing.
- **`retrospective-sessions.contributor` is a slug, never an address** — it is an id segment, and the
  descriptor's `pattern` refuses anything else.

## the interview — generate max, ask min

**Generate `max_interview_questions` (default 10) always; ASK only `min_interview_questions`
(default 0).** A generated-but-unasked question is a real `questions` record left `pending` — the
queue a later supervised run picks up, and the honest record of what the evidence could not settle.
At `min 0` the run is unattended: nothing is asked, no finding can become `confirmed` or `refuted`,
every proposal is honestly `basis: evidence-only`, and the run continues by taking each proposal's
recommended option. Unchanged from v1 §13; the banks, order and stopping rule are in
`references/interview-banks.md`.

**Every generated question carries a `suggested_answer`** — what the run infers the person would say,
read out of the records named in `suggestion_evidence` — and an EMPTY `answer`. The suggestion is
what makes an unattended run useful to the person who eventually reads it: something to correct
rather than a blank. It is never their words, `check-records` refuses one with no evidence and an
`answer` identical to it, and it stays on the record after they answer so the gap can be measured
(`references/inference-model.md` § suggestions).

## thin evidence is a normal input

Two transcripts and no checkout is not an edge case, and neither is a contributor whose machine is
not this one — tickets and commits alone make an honest perspective, with the conversations
collection empty and said to be empty. When stage 3 finds little: say so, skip the judging loop, run
the paste-back as the main evidence, and let the modelling bank carry the interview. A `sources`
record with `reach: unavailable` is the record of that, never a failure.

## what NOT to do

| mistake | reality |
|---|---|
| reading a `.jsonl` with Read or `cat` | `digest.mjs` — bounded, sampled, says what it dropped |
| `dt set perspective/conversations/<id> summary=…` | `record-judgement.mjs` — the whitelist IS the guard |
| a comma inside an array item | it splits into two elements — repeated flags are fine, commas in a value are not; `cat` the record |
| writing a commit as a record | git is the store; SHAs are pointers on `world/activities.commits`, and `read-git` parks the detail in `.perspective/commits/` |
| naming an activity "worked on `<repo>`" | name it as the person would name the task, in their vocabulary |
| a second topic for a second spelling | add the spelling to `aliases` on the topic that exists |
| a workflow from two activities | three or more, same step order, or no record |
| a concept from one striking use | three or more uses with a STABLE meaning |
| inventing a `rationale` a source did not give | leave it empty; an invented why is authored truth |
| a role taken from a title or a self-description | `role` is observed behaviour, or it is not written |
| merging two observed people because the names match | a person decides a merge; handles are the key |
| setting `real` on a world object from a name that matches | `real` is a PROPOSAL a person confirms, exactly like `contact` — a script or a pass that guesses it is authoring truth |
| writing an observed object into `users`/`projects`/`activities`/`activity-lanes`/`tasks`/`goals` | those are the person's own records; a run writes `perspective/world/*` and points `real` at them |
| a finding on one session written as `pattern` | `anecdote`; it stays one until the person confirms it |
| proposing from an anecdote | nothing is proposed from an anecdote alone |
| writing a seed nobody confirmed | ask first; a wrong seed loses trust faster than anything |
| paraphrasing an answer on write | `questions.answer` is verbatim; interpretation goes in findings |
| copying a `suggested_answer` into `answer` because the person nodded | `answer` is what they SAID; a suggestion they agreed with is still the run's words — write theirs, however close |
| a `suggested_answer` with no `suggestion_evidence` | a guess wearing a record; `check-records` refuses it |
| one agent handed the whole corpus | it reads for tens of minutes and writes nothing — pre-cluster, slice small, parallelise the lenses (`references/inference-model.md`) |
| running a reader whose source is not `available` | the reader refuses; fix the source or leave it |
| re-running a stage and writing its records twice | every stage reads its own output first, and `tests/idempotency.test.mjs` runs each one twice and hashes the tree — a claim in prose is what let two re-run defects ship |
| advancing `stage` before `npm run check` is clean | the stage is the gate; a dirty gate lies to the next run |
| a machine path in `location` or `transcript_path` | `${userHome}` / `${env:REPOS_FOLDER}` / `${workspaceFolder}`; check-records refuses the rest |
