---
name: scrape-contact
description: build or complete a contact record from LinkedIn + web search (uses the operator's LinkedIn session)
argument-hint: <contacts/id | "name + hint"> [more…]
---
load the `scraping-contacts` skill. for each target in: $ARGUMENTS — a `contacts/<id>` ref, an
identity hint (name, company, LinkedIn URL), or both — produce a complete contact record.

profile data comes from the **`linkedin-mcp-server` v4 MCP tools** — `get_person_profile(slug, sections?)`,
with `search_people` / `get_company_employees` / `WebSearch` to resolve a name to a slug. confirm the
right person on **two signals** before scraping; a wrong slug writes wrong data, which is worse than a
wasted call.

**never call `connect_with_person` or `send_message`** — they act publicly and irreversibly as the
operator, and `connect_with_person` has no confirmation parameter. same for the inbox tools: reading
private DMs is not enrichment. if a task seems to want one, stop and ask.

**every call is an authenticated request from the operator's own LinkedIn account** — that, not money,
is the constraint. so: **one pass at a time**, small batches rather than the whole `draft` queue, and
`close_session` when done. if you hit a captcha, a "confirm in the mobile app" prompt, or the loud
`No valid LinkedIn session` error, **stop and say so** — do not retry in a loop. fall back to web
search instead. an **all-null profile with no error** is a stale server version, not a bad session
(decision 83) — check the version, don't re-auth.

then complement from web search: current role, company, location, public writing. per-field
provenance — `source: linkedin:<slug>` for scraped fields, `source: url:<…>` for web-derived ones,
and when the two disagree keep both in the body with the discrepancy named.

set `status: enriched` on a successful pass. **never `verified`** — that is the operator's to give.
`confidence: low` plus a reason in `creation_context` for anything inferred rather than read.

report per contact: what you found, what you could not, and which source each part came from.
