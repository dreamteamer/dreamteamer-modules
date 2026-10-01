---
name: iterate-prototype
description: land a round of reviewer feedback on a prototype — a dated section, a bumped iteration, a redeploy
argument-hint: <rnd/prototypes/id> "<the feedback>"
---
load the `building-from-references` skill (section 5). for the prototype in $ARGUMENTS: add a dated
`## iteration N — <date> — <who>` section to the body with the feedback (verbatim where it matters), what
changed and what was declined and why; make the change; run `deploy`; bump `iteration`. `live_url` does not
move. commit `rnd/prototypes/<id>` scoped.
