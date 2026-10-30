---
name: scrape-contact
description: build or complete a contact record from LinkedIn + web search (uses your own LinkedIn session)
argument-hint: <contacts/id | "name + hint"> [more…]
---
load the `scraping-contacts` skill. for each target in: $ARGUMENTS — a `contacts/<id>` ref, an
identity hint (name, company, LinkedIn URL), or both — produce a complete contact record.

profile data comes from the **`linkedin-mcp-server` v4 MCP tools**, run through the skill's `li.mjs` —
`get_person_profile(slug, sections?)`. to resolve a name to a slug, use `WebSearch` first, then
`get_company_employees`, then the `references` of a profile you already scraped; `search_people` does
not work. confirm the right person on **two signals** before scraping; a wrong slug writes wrong data,
which is worse than a wasted call.

**never call `connect_with_person` or `send_message`** — they act publicly and irreversibly as you, and
`connect_with_person` has no confirmation parameter. same for the inbox tools: reading private DMs is
not enrichment. if a task seems to want one, stop and ask.

**every call is an authenticated request from your own LinkedIn account** — that, not money, is the
constraint. so: **one batch at a time**, small batches budgeted in page loads rather than the whole
`draft` queue. if you hit a captcha, a "confirm in the mobile app" prompt, or the
`No valid LinkedIn session` error, **stop and say so** — do not retry in a loop. fall back to web
search instead. an **all-null profile with no error** is a stale server image, not a bad session —
pull the image, don't re-auth.

then complement from web search: current role, company, location, public writing. set `source` to what
you read — `linkedin:<slug>` for a scrape, `url:<…>` for a page — and name any other source in the
body. when two sources disagree, keep both in the body with the discrepancy named.

set `status: enriched` on a pass that produced something; a pass that found nothing stays `draft` with
the reason in `creation_context`. **never `verified`** — that is a person's to give. `author` is
`agents/<harness>` with the model in `creation_context`; `confidence: low` plus a reason in
`creation_context` for anything inferred rather than read.

report per contact: what you found, what you could not, and which source each part came from.
