---
name: building-from-references
description: use when something should be built "like THAT" — a competitor's product, a screen recording, a design pattern or a spec arrives and a product of ours must be defined against it; when a design doc needs its PRD written from references and branding; when a prototype must exist, be deployed and iterated on feedback; when a design is ready to become a project plan. The mechanics behind /ingest-reference, /write-reference-prd, /draft-prd, /build-prototype, /iterate-prototype and /plan-project — a software factory that runs reference → PRD → prototype → plan → materialised repo, each hop a field `dt next` can read.
---

# building from references

**core principle:** a reference is EVIDENCE, a design doc is a DECISION, a prototype is a CLAIM anyone
can click, a plan is a COMMITMENT. Each is a record, each hop between them is a field, and
`dt next rnd/design-docs/<id>` says which hop is missing. Nothing here is a workflow entity —
the record's own state is the progress marker.

## the chain

```
rnd/references ──references[]──▶ rnd/design-docs ◀──design_doc── rnd/prototypes
     prd (a prompt)                content (the PRD) · branding            live_url · iteration
                                          │ plan
                                          ▼
                              <plan collection>/<id>   e.g. projects in a workspace with the plan module
```

| hop | command | enter | exit |
|---|---|---|---|
| a capture becomes a record | `/ingest-reference <file or url>` | — | a `rnd/references` record with `reference_file` or `url` |
| the reference gets its spec-as-prompt | `/write-reference-prd` | `prd` empty | `prd` written |
| a design doc gets its PRD | `/draft-prd` | `references` set, body empty | body written |
| the PRD becomes clickable | `/build-prototype` | body written | `prototypes` (generated) non-empty |
| a reviewer's feedback lands | `/iterate-prototype` | `live_url` set | `iteration` bumped, body dated |
| the design becomes a plan | `/plan-project` | `prototypes` non-empty | `plan` set |

## 1. ingest — the file leaves the inbox, the record is written first

A capture lands as bytes: a screen recording, a PDF, an export. **Move it out of the inbox into
`${env:FILES_FOLDER}/rnd/references/<id>/`** — the record's `reference_file` is that path as a template,
never a machine path — then `dt add rnd/references` with `name`, `type`, `company`, `audience`,
`observed_on`. The id is the slug of the name; pick the name as `<maker> <surface>` so the id reads.

**Frames.** A recording is unreadable to an agent until it is frames:

```bash
node .dreamteamer/skills/building-from-references/bin/extract-frames.mjs \
  --in "$(npx dreamteamer resolve rnd/references/<id> reference_file)" \
  --out "$(npx dreamteamer resolve rnd/references/<id> screenshots_folder)" \
  --every 4 --width 1280 --sheet          # one frame per 4 s, plus a contact sheet
```

Run it from the workspace root. It needs `ffmpeg` on PATH, and `dt resolve` needs `FILES_FOLDER`
declared in `dreamteamer.vars` and set in `.env`.

Then set `screenshots_folder`. Read the contact sheet FIRST (one image, the whole recording), then the
frames a claim depends on. Silence is information: check the audio (`ffmpeg -af volumedetect`) before
paying for a transcription — a screen recording is usually mute.

## 2. write-reference-prd — the spec as the prompt that would regenerate it

`prd` is written **as instructions to a builder**, not as a review: audiences · every screen and what
is on it · the objects and their fields as the UI exposes them · flows (entry → steps → exit) · rules
the UI enforces (locks, waits, refusals) · states and empty states · copy conventions and language ·
what it deliberately does NOT do. Frame numbers or timestamps after every claim, so it can be checked.
The body (`content`) is where judgement goes — what it does well, what it gets wrong, what our audience
needs that it lacks. Keep the two apart: a prompt with opinions in it regenerates the opinions.

## 3. draft-prd — our design, against the references, in our brand

A `design-docs` record with `product`, `references[]` and `branding` set and an empty body is
a PRD waiting to be written. Read every cited reference's `prd` AND body, the product's page, the
workspace's own notes on the audience, and write the design: what we build, for whom, which reference
behaviours we adopt, which we reject and why, what we add that no reference has. `branding` is short
and concrete — tokens, tone, language, script direction, the logo as an `assets/…` ref — because it is
what makes a prototype look like ours rather than like the reference.

## screens and stories — the build list, before the build

When a product is specified screen by screen, enumerate it in `rnd/screens` before building: one
record per screen with its `route`, the `reference` and `reference_route` it mirrors, the `states` it
must render, and `source` saying why it exists. A `scope-required` screen is the one a build from
screenshots misses. Each `rnd/user-stories` record names the `screen` it runs through, and `journey`
plus `step` order the stories into flows. "What is left to build" is then a filter on `build_status`.

## 4. build-prototype — clickable from iteration 1, deployed from iteration 1

Create the `rnd/prototypes` record with `design_doc`, `product`, `iteration: 1`, `entry`, and
`deploy` — the ONE command that refreshes `live_url`. Build the thinnest thing a reviewer can click
through; fake everything behind the screen and say so in the body ("what it deliberately fakes").
Deploy it, set `live_url`, and hand the reviewer the URL, not a screenshot. A prototype without a
`live_url` is a sketch: set `status: sketch` until it deploys. The binding's exit reads only that a
prototype record exists, so check `live_url` yourself before you call this hop done.

**Benchmark before iterating.** Against every cited reference: a table of screens × capabilities,
theirs · ours, with the frame or URL behind each cell. It goes in the prototype's body under a dated
heading, and it is what the next iteration is FOR.

## 5. iterate-prototype — feedback is dated, the number goes up

Every reviewer round: a dated `## iteration N — <date> — <who>` section in the body with what was said
(verbatim where it matters), what changed, what was declined and why; `iteration` bumped; `deploy` run;
`live_url` unchanged. Rapid means the loop is minutes, not a sprint — which is why `deploy` is one line.

## 6. plan-project — the design becomes a commitment, elsewhere

When the prototype is agreed, the design is planned in whatever this workspace plans with — a
`projects` record with its activities and gates, where the plan module is installed — and `plan` on
the design doc names it as `<collection>/<id>`. The engineering plan — tasks, files, interfaces and
checkbox steps for whoever builds it — is an `rnd/implementation-plans` record whose `spec` is this
design doc; where no plan module is installed, `plan` names that record instead. Without either, `plan`
stays empty and the design doc is done at the prototype. Materialising is the
plan's business (a repo, a `repos` record, the first commit); this doc is done when `plan` is set.

## common mistakes

| mistake | why it bites |
|---|---|
| writing the PRD from the recording without a reference record | the evidence is in scrollback; the next design doc re-watches the video |
| a `prd` full of opinions | it is a prompt — the opinions regenerate; judgement goes in the body |
| a machine path in `reference_file` | wrong on every other machine — `${env:FILES_FOLDER}/…`, rendered by `dt resolve` |
| a prototype with no `live_url` | a reviewer cannot click a screenshot; `status: sketch` until deployed |
| iterating without a benchmark | the change is not measured against the reference it was modelled on |
| a second design doc for a new iteration | iterations are dated sections and a number, not records |
