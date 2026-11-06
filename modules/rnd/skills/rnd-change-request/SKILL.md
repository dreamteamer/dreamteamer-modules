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

1. Say the change in one paragraph before you write anything: what changes, for whom, what stays. That paragraph goes in the BODY. Three sizes, never mixed: `name` is a handful of words naming the change the way a list row reads it ("Activity page loads instantly"); `description` is one line — what changes, for whom; everything longer is the body. The ask usually arrives in the client's own tool — a ticket, a mail, a call; `source` is that ticket's URL or the meeting's id, and the ticket stays the client's view while this record is the contract.
2. ```bash
   dt add rnd/change-requests --key <handle> --name "<a few words>" --products rnd/products/<id> \
     --description "<one line>" --priority critical|high|medium|low --source "<where the ask came from>" \
     --acceptance "<one piece of evidence>" --acceptance "<the next>" --stage design
   ```
   Repeat `--acceptance` per entry — one flag holding several lines is split on its commas. `--stage` is the request's first column on the change-request board: `design` with no design, `design-review` when step 4 links a draft design, `acceptance` an active one. Into the workspace's own root, always. Into a record layer (`dt add … -w <layer>`), read the layer first — `dt list rnd/change-requests -w <layer> --where '{"stage":{"_nempty":true}}'` — and pass `--stage` only when it lists one: a layer whose requests carry no stage runs an rnd without the field, or has not migrated, and its own migration fills it. When `dt add` with `--stage` is refused for an unknown field `stage`, run the same `dt add` again without `--stage`. After filing, every later stage moves `stage` as it moves the request (rule (a) in recording-reviews); never set it by hand.
3. The body: the paragraph; why, with the ask in the source's own words; what is out of scope; what it touches, by id — screens, journeys, stories; the phases when there are several.
4. Link it. `design_docs` names the designs it amends; none means `/rnd:design` on this record comes first — every request is designed and its design reviewed before its acceptance lines are, and a change too small for a design doc is an issue on the quick path. `journeys`; `issue` when a defect motivated it; `supersedes` when it replaces an earlier request. A story it delivers is linked from the story's side: `dt set rnd/user-stories/<id> change_requests=…` (`stories` here is generated).
5. `acceptance` is one line per piece of evidence that would make the person accept it, in the asker's words, written so it can fail: "the grantee sees the deadline on the roster", never "works as expected". Each line becomes a test at plan time. `source_gaps` is what the source does not say and someone will have to decide.
6. Commit by id. The next word is the one `dt next rnd/change-requests/<id>` names: `/rnd:design` with no design, the design's review while it is draft, then `/rnd:review` on the request, kind `acceptance` — the review of the acceptance lines. Its `approve` sets `accepted`, `accepted_by` and `accepted_on`. When the acceptance is a client's to give, the review names them in `human_reviewer` and waits; their yes is recorded the same way, with the source.

## Don't

- Don't write a change request without a product. `products` is required, and it is how the product lists its changes.
- Don't plan in the body. The plan is `/rnd:plan`, after acceptance — every change takes one, a small change a one-task plan.
- Don't set `status: accepted` yourself. The gate is the review, or the client.
- Don't let `acceptance` say "works as expected". Evidence is something a person can see.
- Don't edit the acceptance lines once filed. They are the asker's. When `source` names nobody and no review names a `human_reviewer`, the lines stand as written: a gap becomes an `rnd/open-questions` record or a finding carrying a PROPOSED line, and an ambiguity resolves to the narrowest reading. No asker, no rewrite.
- Don't file the same change twice. Search first; supersede the old one when the ask moved.

## Done when

`rnd/change-requests/<id>` exists with `description`, `products`, `acceptance` and `status: suggested`, its designs linked or `/rnd:design` queued, and `dt next rnd/change-requests/<id>` answers exactly one verb — `/rnd:design`, or `/rnd:review` when an active design is linked.
