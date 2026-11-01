---
name: rnd-deploy
description: >-
  use when a change or a prototype should go where its people can reach it — "deploy it", "ship it", "put it live", "refresh the prototype". The deploy stage of the R&D lifecycle: the deploy command runs, the result is checked live, and the record carries deployed_on, the command and what was seen.
---

# rnd-deploy

## What you are doing

You put a change — or a prototype — where its people can reach it, confirm it is live with your own eyes, and record it: `deployed_on` and a dated section with the command and what you checked. The request becomes `implemented` at the next gate, the live acceptance review — not here.

A change request that names a `release` is not deployed here: its release's publication stamps `deployed_on` (`rnd-release`), and `dt next` on it names `/rnd:release`, not `/rnd:deploy`.

## Before you start

```bash
dt get rnd/change-requests/<id>          # accepted, verified_on set, deployed_on empty
dt get rnd/implementation-plans/<id>     # status done; the header names the repo and the deploy recipe
dt get rnd/prototypes/<id>               # a prototype: deploy is the one command that refreshes live_url
dt get repos/<id>                        # where the code lives on this machine
```

## Do this

1. Name the recipe before you run it: the command, the environment, what it replaces, how it rolls back. When the plan's header does not say, ask. A deploy with no rollback line is not ready.
2. The branch is merged or the pull request is in. Check; do not assume. A deploy from an unmerged branch ships code the review never saw.
3. Run the deploy command. Read its output to the end.
4. Check it live: open the URL, run the one path the change is about, quote what you saw. A health endpoint is not the feature.
5. Record it. A change request: `dt get rnd/change-requests/<id>` for its `tags`, then ONE write — `dt set rnd/change-requests/<id> deployed_on=<now> tags=<each existing> tags=deployed` (a `dt set` of `tags` replaces the list, so name every tag it already had; `dt check` warns while `deployed` and `deployed_on` disagree). Do it before filing any live acceptance review, so the review is dated after `deployed_on` and counts for the deployed stage; and a `## Deployed <date>` section in the body — command, environment, URL, what you checked, who was told. A prototype: run `deploy`, `dt set rnd/prototypes/<id> live_url=<url>` if it moved, a dated line in the body.
6. Tell the people who asked for it, with the URL. Commit by id. The next word on a change request is `/rnd:review`, kind `acceptance`, subject the request — the live check by someone else: each acceptance line seen on the running thing. Its `approve` sets `status: implemented`.
7. Write what the deploy taught — a step that surprised you, a check that should have existed — as a `decisions` record where installed, or a dated line on the design doc. The next plan reads it.

## Don't

- Don't deploy with `verified_on` empty. `/rnd:test` first, and it must have run an `e2e` or `acceptance` test, not unit tests alone.
- Don't call it deployed on the command's exit code. Deployed is what you saw live.
- Don't deploy from the branch. Merge first, then deploy what was merged.
- Don't skip the rollback line. If you cannot say how to undo it, you cannot do it unattended.
- Don't set `implemented` yourself. The live acceptance review does, after `deployed_on`.

## Done when

`deployed_on` is set, the body says what ran and what was checked, and the asker has the URL. `dt next rnd/change-requests/<id>` answers `/rnd:review` — the live check — and after its `approve` (`status: implemented`) nothing more.
