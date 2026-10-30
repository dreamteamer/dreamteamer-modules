---
name: rnd/draft-prd
description: write a design doc's PRD from the references it cites and the branding it declares
argument-hint: <rnd/design-docs/id>
---
load the `building-from-references` skill (section 3). for $ARGUMENTS: read `product`, every record in
`references` (both `prd` and body), `branding`, and the workspace's own notes on the audience; write the
body — what we build, for whom, which reference behaviours we adopt, which we reject and why, what we add
that no reference has, the objects and rules, the screens, the non-functional constraints, the open
questions. set `status: active` when it is the design being built to. `npx dreamteamer check`, commit scoped.
