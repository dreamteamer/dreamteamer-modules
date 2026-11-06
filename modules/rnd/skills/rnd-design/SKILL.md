---
name: rnd-design
description: >-
  use when a design is being brainstormed or written and the result has to be kept — "let's design X", a spec for a feature, a product or a process, superpowers:brainstorming, a change request that has no design yet. The design stage of the R&D lifecycle: the spec is an rnd/design-docs record, never a file under docs/.
---

# rnd-design

## What you are doing

You turn an idea into one `rnd/design-docs` record a builder can plan from without coming back to ask. You start from a product, or from a change request that has no design yet, and you leave a design doc in `draft` with its stories, its open questions and its decisions as records, queued for review.

## Before you start

```bash
dt get rnd/products/<id>                                         # the product, and every design already decided for it
dt list rnd/design-docs --filter product=rnd/products/<id>       # an active doc on the same ground is superseded, not ignored
dt list rnd/open-questions --filter product=rnd/products/<id>    # what earlier work could not settle
dt list rnd/research-docs                                        # what outside reading already settles
dt list rnd/references                                           # the products this one is modelled on
dt list decisions                                                # where the plan module is installed: choices already made
```

On a change request, `dt get rnd/change-requests/<id>` first. Its `description` is the ask. Its `design_docs` is where your doc goes.

## Do this

1. Ask before you build. One question at a time, the open one first: "walk me through the moment this kicks in." Plain words. Stop when you can describe the thing in two hundred words and the person says nothing is missing. If they say "just do it", say your how-it-gets-made choices in one line and go. Dispatched unattended, with nobody to ask: design from the record you were given, make every choice yourself, and list each one as yours in the body and in `creation_context`.
2. Play it back as you go, two or three hundred words at a time. Mark a guess as a guess.
3. Size it. A quick task: do it. A small change: describe it in chat and build. A project: this record.
4. Write the record while the design is agreed, not after the plan:
   ```bash
   dt add rnd/design-docs --name "<what it is>" --product rnd/products/<id> --description "<one sentence>" --status draft
   ```
   The body is the design: intent and why; goals, non-goals, anti-goals; constraints; the how as the person decided it; what is left to the builder. Each fork taken is a `decisions` record where that collection is installed (`dt add decisions`, with the alternatives and the reversibility); where it is not, a `## Decisions` section naming every alternative that lost. Set `references`, `branding` and `design_system` when they apply, and `supersedes` when it replaces an older doc — that one gets `status: superseded` in the same commit.
5. Each capability seen from the user's side is a `rnd/user-stories` record (`key`, `name`, `design_doc`, `product`). Each screen the design names is a `rnd/screens` record (`key`, `name`, `route`, `source`, `design_doc`). Each question that reading more cannot settle is a `rnd/open-questions` record (`question`, `kind`, `blocks` naming the doc). `dt get collections/<name>` lists the enum values before you guess one. Never a "TBD" in the body.
6. On a change request: `dt set rnd/change-requests/<id> design_docs=rnd/design-docs/<id>`, and tag the stage done — `dt get rnd/change-requests/<id>` for its `tags`, then `dt set rnd/change-requests/<id> tags=<each existing> tags=designed stage=design-review` — a `dt set` of `tags` replaces the list, so name every tag it already had, a person's free tags included (`<each existing>` is every tag it already has except `designed`, so a re-run lists it once). The tag is the stage's first check; the design review is its second. `stage=design-review` puts the request in the design review's column on the board. The `stage=` on these lines is rule (a) in recording-reviews: Write `stage` only on a request that already carries a `stage` or whose `$repo` in `dt get rnd/change-requests/<id> --json` is `.` (the workspace's own root) — read from the workspace the step writes from; on any other request, one a record layer holds whose home has not filled it, leave `stage=…` out and write the rest. When a `dt set` carrying `stage` is refused for an unknown field `stage` (the request's home runs an rnd without it), run the same `dt set` again without `stage`.
7. Read the doc once more as the builder who never saw the conversation. Every question they would ask is answered in the doc or becomes an open question.
8. Commit by id. The next word is `/rnd:review rnd/design-docs/<id>` — on a change request, `dt next` on the request names the same review, and the review sets `change_request`.

## Don't

- Don't write the design to a file under docs/. A file is not a record, and the workspace cannot list it.
- Don't put a choice in the body without the alternative it beat. "We use X" is a decision only when it says what X beat and why.
- Don't offer a menu before the person has described it in their own words. Options steer.
- Don't set the doc `active` yourself. The review does that.
- Don't rewrite an `active` doc in place — not by editing the body, not by a regex replacement (one run spliced a second front matter into the doc that way). An active doc changes by appending a dated entry under `## Revisions`, and the next gate's review covers that entry.
- Don't build. Reading is fine, and so is a spike you called throwaway. Everything else waits for the review.

## Done when

`rnd/design-docs/<id>` exists with `status: draft`, its stories and open questions point at it, the change request (if there was one) names it in `design_docs`, and `dt next rnd/design-docs/<id>` answers `/rnd:review`.
