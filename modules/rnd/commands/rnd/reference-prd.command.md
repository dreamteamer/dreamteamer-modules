---
name: rnd/reference-prd
description: write a reference's `prd` — the reverse-engineered spec as the prompt that would regenerate it
argument-hint: <rnd/references/id>
---
load the `building-from-references` skill (section 2). for $ARGUMENTS: read the body and every frame a
claim depends on, then write `prd` as INSTRUCTIONS TO A BUILDER — audiences, every screen, the objects and
fields the UI exposes, flows, the rules the UI enforces, states and empty states, copy conventions and
language, what it deliberately lacks — with a frame number or timestamp after each claim. no opinions in
it: judgement belongs in the body. hand-edit the field (it is long), then `npx dreamteamer check` and
commit `rnd/references/<id>` scoped.
