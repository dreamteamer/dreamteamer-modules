---
name: rnd-change-request
description: >-
  use when an ask arrives that changes what a product does — from a client, a user, a review, a meeting, your own session — "they want X changed", "file a change request", a source gap that changes the contract. The change-request stage of the R&D lifecycle: one rnd/change-requests record saying what changes, against which design, with the evidence that would accept it.
---

# rnd-change-request

## What you are doing

You turn an ask into one `rnd/change-requests` record that says what changes, against which design, with the evidence to accept it. You leave it `suggested`, queued for review.

## Before you start

```bash
dt get rnd/products/<id>                                           # the product and its active designs
dt list rnd/change-requests --filter products=rnd/products/<id>    # the same change may be filed already, or superseded
dt list rnd/open-questions --filter product=rnd/products/<id>      # the ask may be an open question that now has an answer
dt get rnd/design-docs/<id>                                        # the design the change amends
```

## Do this

1. Say the change in one paragraph before you write anything: what changes, for whom, what stays. That paragraph is `description`.
2. ```bash
   dt add rnd/change-requests --key <handle> --name "<short name>" --products rnd/products/<id> \
     --description "<the paragraph>" --priority critical|high|medium|low --source "<where the ask came from>"
   ```
3. The body: why, with the ask in the source's own words; what is out of scope; what it touches, by id — screens, journeys, stories.
4. Link it. `design_docs` names the designs it amends; none means `/rnd-design` on this record comes first. `journeys`, `stories`, `issue` when a defect motivated it, `supersedes` when it replaces an earlier request.
5. `acceptance` is one line per piece of evidence that would make the person accept it: "the grantee sees the deadline on the roster". `source_gaps` is what the source does not say and someone will have to decide.
6. Commit by id. Queue the gate: `/rnd-review rnd/change-requests/<id>`. The review's `approve` sets `accepted`. When the acceptance is a client's to give, say so and leave the status alone.

## Don't

- Don't write a change request without a product. `products` is required, and it is how the product lists its changes.
- Don't plan in the body. The plan is `/rnd-plan`, after acceptance.
- Don't set `status: accepted` yourself. The gate is the review, or the client.
- Don't let `acceptance` say "works as expected". Evidence is something a person can see.
- Don't file the same change twice. Search first; supersede the old one when the ask moved.

## Done when

`rnd/change-requests/<id>` exists with `description`, `products`, `acceptance` and `status: suggested`, its designs linked or `/rnd-design` queued, and `dt next rnd/change-requests/<id>` answers `/rnd-review`.
