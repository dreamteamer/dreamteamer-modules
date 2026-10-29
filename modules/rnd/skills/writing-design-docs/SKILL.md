---
name: writing-design-docs
description: use when a design is being brainstormed or written in a workspace with the rnd module — superpowers:brainstorming, "let's design X", a spec for a feature, a product or a process — and the result has to be KEPT. The spec is an rnd/design-docs record, never a markdown file under docs/; this skill says what to read before brainstorming, where each output lands (the design, the stories it implies, the questions it leaves, the choices it made) and when the doc is approved.
---

# writing design docs

**core principle:** a design is a DECISION, and a decision the workspace cannot list is one it will
re-make. Brainstorm exactly as `superpowers:brainstorming` says; this skill only moves its output from
a file into records. Where that skill says "write the design doc to `docs/…/specs/`", this workspace's
location rule overrides it: the spec is an `rnd/design-docs` record.

## before the first question

Read what the design must not contradict — each is one command:

| read | why |
|---|---|
| `dt get rnd/products/<id>` and its `design_docs` | the product, and every design already decided for it |
| `dt list rnd/design-docs --filter product=rnd/products/<id>` | an `active` doc on the same ground is SUPERSEDED, not ignored |
| `dt list rnd/open-questions --filter product=rnd/products/<id>` | what earlier work could not settle |
| `dt list rnd/research-docs` · `rnd/references` | what outside reading and modelled-on products already settle |
| `dt list decisions` (where the plan module is installed) | choices already made, with their reasons |

## where the output lands

| brainstorming produces | record |
|---|---|
| the approved design | `dt add rnd/design-docs` — `name`, `product`, `description`; the design is the body; `references`, `branding` and `design_system` when they apply; `supersedes` when it replaces an older doc |
| a capability seen from the user's side | `rnd/user-stories` with `design_doc` and `product` set |
| a screen the design names | `rnd/screens` with `design_doc` set (the `building-from-references` skill owns the screen inventory) |
| a question it leaves open | `rnd/open-questions` with `blocks` naming the design doc — never a "TBD" in the body |
| a choice between alternatives | `decisions` where installed, else a dated "Decisions" section of the body naming what was rejected |

Write the record when the design is approved, not after the plan: `status: draft` while it is
being reviewed, `active` once it is the design being built to. The superseded doc gets `status:
superseded` in the same commit. The spec self-review brainstorming asks for runs against the record's
body. Commit the records you wrote, by id.

## the handoff

The next step is `superpowers:writing-plans`, with the design doc's id as the spec — the
`writing-implementation-plans` skill says where that plan goes. A design that should be reviewed before
it is planned is reviewed per `recording-reviews`, with the design doc as `subject`.
