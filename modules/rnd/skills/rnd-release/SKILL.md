---
name: rnd-release
description: >-
  use when a version of something this workspace builds is being planned, cut or published — "release it", "cut 0.6.0", "what goes in the next release", "is it out", "publish the extension", a verified change request whose `dt next` names /rnd:release. The release stage of the R&D lifecycle: one rnd/releases record walked plan → cut → published, the cut a person's, the publication stamping deployed_on on every change it carries.
---

# rnd-release

## What you are doing

You walk one `rnd/releases` record through three steps, each one `dt next` answer: **plan** (pick what it ships, write the notes), **cut** (the gates, then a person's tag), **publish** (the registries answer the version; every change it carries is stamped deployed). A change request that names a `release` is deployed by that release — its `deployed_on` is the release's `published_on`, and its live acceptance review opens only once the release is `published`.

One release is one version of one product. A product that ships several packages from one repo releases each on its own line: `package` names it, and the id is `<product>/<package>/<version>`; otherwise `<product>/<version>`. The tag lives in `repo`.

## Before you start

```bash
dt next rnd/releases/<id>                 # which step is open: plan, cut or publish — one at a time
dt get rnd/releases/<id>                  # status, the notes so far, change_requests and issues it ships
dt list rnd/releases --filter product=rnd/products/<p>   # the product's releases, newest first
dt get rnd/change-requests/<id>           # a request's `release`; `verified_on` before it may ship
```

A release that does not exist yet: `dt add rnd/releases <version> --product rnd/products/<p> [--package <short-name>]` — `planned` by default. The version is the registry's spelling, no leading `v`.

## Do this

1. **Plan** (`planned`, no notes). Schedule each change into it: `dt set rnd/change-requests/<cr> release=rnd/releases/<id>`, likewise an issue. A request ships only once its test review stamped `verified_on`; an issue once it is `fixed`. Then write the notes in the body from the records' own bodies: what changed, for whom, what a consumer must do. The step is done when the notes exist.
2. **Cut** (`planned`, notes written) — **a person's step.** Run the repo's release gates as its own instructions name them — the full suite, the leak scan, any drift check — and quote each **exit code** in a dated `## Cut <date>` section. Bump the version and the upgrade notes in the repo. Then STOP and hand over: the tag command, the gates' exit codes, the release id. Tagging is publishing — the tag starts the repo's publish workflows — so an agent never tags or pushes.
3. **Record the cut** once the person has tagged (`git ls-remote --tags <remote> <tag>` answers it): `dt set rnd/releases/<id> status=cut tag=<tag> repo=repos/<r> cut_on=<now>`.
4. **Publish** (`cut`). Check that each registry answers the EXACT version — `npm view <package>@<version> version`, the marketplace page, the release page — and quote what answered. Then `dt set rnd/releases/<id> status=published published_on=<now> published_to=<url> published_to=<url>` (one per registry) and a dated `## Published <date>` section.
5. **Stamp what it carries** — the publish step's last half, and a step of its own when it is resumed: `dt next` on a `published` release names it (`rnd--release--releases--stamp`) while any request it carries has no `deployed_on`. For each `change_requests` entry still `accepted` with no `deployed_on`: `dt set rnd/change-requests/<cr> deployed_on=<published_on>` and a `## Deployed <date>` line naming the release. For each `issues` entry with an empty `fixed_in`: `fixed_in=<tag>`. Commit by id. Each request's next word is the live acceptance review (`/rnd:review`, kind `acceptance`) — someone else's.
6. **Rolled back.** When a published or cut version is withdrawn: `status=rolled-back` and a `## Rolled back <date>` section with the reason; on each request it carried that is still `accepted`, clear `deployed_on` (`deployed_on=`) and move its `release` to the next planned one. Its live review closes until that one is published.

## Don't

- Don't tag, push or publish. The cut is a person's act; you prepare it and stop.
- Don't ship a request with `verified_on` empty, or call a release published on a workflow's exit code — published is what the registries answer.
- Don't change a release's `version`, `package` or `product` in one write: they are its id, and `dt check` refuses a record whose id names something else. Re-versioning a `planned` release is two writes, in this order — `dt set rnd/releases/<id> version=<new>`, then `dt rename rnd/releases/<id> <product>/<new>` (which moves every `release` pointing at it); `dt check` flags it between the two. Never re-version a cut or published one: plan the next.
- Don't set a request's `implemented` — its live acceptance review does — and don't stamp `deployed_on` on a request whose release is not `published`: the review stays closed anyway.
- Don't plan a second release of one version: `dt add` refuses the id, and `dt check` names both claimants of a hand-written one.

## Done when

`dt next rnd/releases/<id>` answers nothing: the release is `published` with `published_on` and `published_to`, its notes say what it ships and which gates ran with what exit codes, and every change request it carries has `deployed_on` — so `dt next` on each names its live acceptance review.
