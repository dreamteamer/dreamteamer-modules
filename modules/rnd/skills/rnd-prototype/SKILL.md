---
name: rnd-prototype
description: >-
  use when a design should become something a person can click — the first prototype of an rnd/design-docs record, or a round of feedback on an existing rnd/prototypes record; the mechanics behind /rnd-prototype, /build-prototype and /iterate-prototype. The prototype stage of the R&D lifecycle: the living mockup beside the product, never the product.
---

# rnd-prototype

## What you are doing

You make the design clickable. From a design doc you build the thinnest thing a person can click through, deploy it, and keep it as the `rnd/prototypes` record that is the living reference for the design. On a prototype that already exists you land one round of feedback and redeploy.

## Before you start

```bash
dt get rnd/design-docs/<id>                                      # the design; branding and design_system say what it must look like
dt get rnd/design-systems/<id>                                   # tokens, components, voice — read before drawing anything
dt list rnd/screens --filter design_doc=rnd/design-docs/<id>     # the screens the design names: the build list
dt get rnd/prototypes/<id>                                       # iterating: the record, its entry and its deploy command
```

## Do this

The first build:

1. `dt add rnd/prototypes --name "<design> prototype" --design_doc rnd/design-docs/<id> --product rnd/products/<id> --iteration 1 --status sketch --entry <path> --deploy "<the one command that refreshes the URL>"`. Set `repo` when it has one.
2. Build the thinnest clickable thing in the design's branding: the screens from the inventory, fake data, no backend. Every screen gets a route; set `prototype` on each `rnd/screens` record, and the prototype lists them.
3. Run `deploy`. Open the URL. Click the main path. `dt set rnd/prototypes/<id> live_url=<url>`.
4. Write the body: what it shows, what it fakes, what it leaves out. Against each cited reference, a table of screens and capabilities, theirs and ours. Commit by id. The design doc lists the prototype on its own.

A round of feedback:

5. Add `## iteration N — <date> — <who>` to the body: the feedback, verbatim where it matters; what changed; what you declined and why.
6. Make the change. Run `deploy`. `dt set rnd/prototypes/<id> iteration=<N> status=living`. `live_url` stays unless the deploy says otherwise.
7. Commit by id. When the person says the prototype is agreed, the design is ready to plan: `/rnd-plan rnd/design-docs/<id>`.

## Don't

- Don't wire a backend. A prototype that works is a product nobody designed.
- Don't let the prototype drift from the design. When a click changes the design, change the doc first, then the prototype.
- Don't skip the deploy. A prototype nobody can open is a sketch on your disk.
- Don't restyle by hand what the design system says. Change the system, then redraw.
- Don't paraphrase feedback. The person's words are what the next iteration argues from.

## Done when

`rnd/prototypes/<id>` has `live_url`, `iteration` and `deploy` set, its screens point at it, the design doc lists it, and the URL opens the main path. `dt next rnd/design-docs/<id>` then answers `/rnd-plan`.
