---
name: scraping-contacts
description: Use when you need LinkedIn profile or company data (headline, current role, experience, education, skills) for one or more people — to build or enrich contact records — given their profile URLs, or just names to search for, and WebFetch/a logged-in browser can't get past LinkedIn's auth wall.
---

# Scraping Contacts

## Overview

Pull LinkedIn data through **`linkedin-mcp-server` v4** (stickerdaniel), a container driving a headless
Chromium that holds **the operator's own LinkedIn session**. LinkedIn blocks direct `WebFetch`
(domain-verification wall) and none of the `browsing-as-account` profiles carry a LinkedIn session,
so this is the way in.

**The session is a singleton, and the whole design follows from that.** One browser, one profile
directory, one cookie — used from two places, LinkedIn kills it, and that costs a host re-login rather
than a retry. So there is **deliberately no `linkedin` entry in `.mcp.json`**: a registered stdio server
spawns one container *per Claude session*, which is exactly the collision (decision 84). Instead you
run **one ephemeral, lock-guarded container per batch** via `bin/li.mjs`, and it exits when the batch
does. Nothing idles, nothing survives a reboot, and the lock makes "exactly one" true rather than hoped
for (decision 85).

**Core principle:** the container is the implementation; `bin/li.mjs` is only the harness that
guarantees there is exactly one of it. The knowhow is the rest of this file — which of the 19 tools to
use, **which ones you must never touch**, how to read the failure modes, and how to turn a result into
a record with honest provenance.

**Every call is an authenticated request from the operator's real account.** That, not money, is the
constraint that shapes everything below.

## NEVER use these tools

The server ships write and inbox tools. They are not part of contact enrichment and using one would
act as the operator, irreversibly and in public:

| tool | why not |
|---|---|
| `connect_with_person` | sends a real connection request. **No confirmation parameter** — the call *is* the action |
| `send_message` | sends a real DM. `confirm_send` is required, which is a guard, not permission |
| `get_inbox` / `get_conversation` / `search_conversations` | reads the operator's private DMs. Enrichment never needs this |
| `get_feed` / `search_posts` / `get_saved_jobs` / `get_recommended_jobs` | different job (see `expert-social-marketing` for content work) |

If a task seems to want one of these, **stop and ask** — that is a decision the operator makes, not
a scraper.

## The tools you do use

| tool | signature | use |
|---|---|---|
| `get_person_profile` | `(linkedin_username, sections?, max_scrolls?)` | one person. **`linkedin_username` is the slug**, not the URL: `https://www.linkedin.com/in/dana-oren/` → `dana-oren` |
| ~~`search_people`~~ | — | **DEAD** (upstream #526). Fails on a healthy session. Don't spend a call on it |
| `get_company_profile` | `(company_name, sections?)` | a company page (slug from `linkedin.com/company/<slug>`) |
| `search_companies` | `(keywords)` | company name → slug |
| `get_company_employees` | `(company_name, keywords?)` | find a person *via* their employer — the trick that identifies a colleague from an email convention alone|
| `close_session` | `()` | end the browser session after a batch |

**`sections` is a comma-separated STRING, not an array** — `"experience,education"`. Passing a list is
a pydantic validation error. Available: `experience`, `education`, `interests`, `honors`, `languages`,
`certifications`, `skills`, `projects`, `contact_info`, `posts`. The main profile page is always
included, and **omitting `sections` returns only the top card** — name, headline, location, current
company, school, follower count. Ask for what you need; each section is another crawl.

`max_scrolls` (1–50) caps "Show more" clicks per section, default 5 (10 for posts). Raise it for a
profile with 30+ items in one section, and request heavy sections in a **separate call** so they don't
slow the others.

A section can fail on its own while the rest succeed — you get LinkedIn's `"Something went wrong"` text
in that section's value. Observed on `experience` when fetching **by URN**; the same section succeeded
immediately when re-fetched **by slug**. So prefer the slug once you have one, and check each section's
value rather than assuming a non-error response means every section arrived.

## First-time setup

**Order matters** — step 2 must happen before step 3 ever runs. Docker creates a missing bind-mount
source **as root**, so if a container runs before the login exists, `~/.linkedin-mcp` lands root-owned
and the login then cannot write to it. (Recoverable with `sudo rm -rf ~/.linkedin-mcp`, but avoid it.)

**1. Two things installed.**
- **Docker Desktop**, running. Nothing to add in its MCP Toolkit, and nothing in `.mcp.json` —
  **do not add either**, both spawn containers you cannot control (see §"why there is no MCP entry").
- **`uv`** (which provides `uvx`): `brew install uv`, or the installer at astral.sh/uv. Check with
  `uvx --version`.

**2. The LinkedIn session, on the HOST.** Prefer the import — it reuses the session already in
Chrome/Brave/Edge/Arc/Vivaldi, and repeated fresh logins are what trigger a captcha:

```sh
uvx mcp-server-linkedin@latest --import-from-browser
# or, if the import finds nothing: --login  (opens a browser; 2FA/captcha fine, ~5 min allowed)
```

This creates **`~/.linkedin-mcp/`** — outside the repo, never committed — holding `cookies.json`,
`source-state.json`, a Patchright browser and the `trace-runs/` diagnostics. It grows to roughly
**220 MB**. Each container derives a fresh browser profile from it at startup, so **there is nothing to
restart afterwards**.

**3. `LINKEDIN_USER_AGENT` in the repo `.env`.** Take the string the login just recorded — not one from
DevTools, and never an invented one (the why is in §"the scarce resource"):

```sh
python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.linkedin-mcp/source-state.json')))['user_agent'])"
```

**4. Confirm it worked**, spending no LinkedIn request:

```sh
node .dreamteamer/skills/scraping-contacts/bin/li.mjs --doctor
```

Want `cookies: true`, a recent `login_at`, `batch_lock: free`, `containers_running: 0`. Right after a
login the verdict is *"login is NEWER than any scraping evidence — session untested"*, which is correct
and expected — the doctor deliberately refuses to reuse evidence older than the login. The **first**
batch also pulls the image (**0.53 GB**) if it is not cached, so it runs slow exactly once.

Re-running the login later is the standard remedy for a dead session and is what step 2 exists for.
Concurrent *batches* are safe by construction: `li.mjs` takes a lock and the second one refuses.

## Running it — `bin/li.mjs`

From the workspace root, after a compile — the same path whether the module came from npm, a copy
under `modules/`, or a clone: `.dreamteamer/skills/scraping-contacts/bin/li.mjs`

```sh
D=.dreamteamer/skills/scraping-contacts/bin

# is the session alive? costs NO LinkedIn request — always start here
node $D/li.mjs --doctor

# one call
node $D/li.mjs get_person_profile '{"linkedin_username":"dana-oren","sections":"experience,education"}'

# a BATCH: one container, one browser, N calls, then gone. Batch rather than looping single calls —
# a container per person pays startup and session-derivation every time. But keep it SMALL: the
# session dies at roughly six PAGE LOADS, and every section is a load (§"the scarce resource").
echo '[
  {"tool":"get_person_profile","args":{"linkedin_username":"dana-oren"}},
  {"tool":"get_person_profile","args":{"linkedin_username":"sam-diaz"}},
  {"tool":"get_company_employees","args":{"company_name":"northwind-group","keywords":"Diaz"}}
]' | node $D/li.mjs --stdin
```

**Shape a batch by page loads, not by people.** Top-card-only costs 1 load each, so ~4–5 people is a
sensible first pass; a single profile with `sections: "experience,education"` costs 3. Order the batch
with the people who matter most FIRST — when the wall hits, everything after it returns nothing.

Prints a JSON array of `{tool, args, ok, result|error}`; `close_session` is called for you at the end.
`failed_sections` is added when a call returns `ok` but some section came back as LinkedIn's
"Something went wrong" — check for it rather than assuming a non-error means complete.

Exit codes: `0` all good · `1` at least one call failed · `2` bad usage · `3` refused a banned tool ·
**`4` another batch holds the lock** — that is not an error to retry past. Wait, or find out why the
other batch is stuck. Two containers on one profile is precisely what invalidates the session.

`--doctor` reads the newest trace run's post-import screenshot from disk and tells you whether the
session is alive, spending no LinkedIn request to do it. Its verdict is derived from file size — a real
page is ~36 KB, a bounce to the sign-in wall leaves it blank at ~4 KB.

## `BrowserBusyError` — a stranded HOST process, and the doctor used to miss it

**Measured 2026-08-29, after two days of "the login keeps failing".**

```
BrowserBusyError: Another LinkedIn MCP client is using the browser, so a session
cannot be imported. Close it and try again.
```

This is not about Docker, and not about the session. A `mcp-server-linkedin` process from **two
days earlier** had never exited and still held the flock on `~/.linkedin-mcp/profile.lock`, with
nine orphaned patchright Chromium processes under it. While it lived, **every**
`--import-from-browser` AND `--login` refused — the tool is right to refuse, and the fix is one
`kill`.

**What made it expensive is that `--doctor` said the opposite.** It reported `containers_running:
0`, `batch_lock: free` and *"session looks DEAD — run `--import-from-browser`"*: the one command
that could not possibly work. It checked Docker and its own batch lock and never looked at the
host. `--doctor` now reports **`host_clients`** and names the pid to kill.

```sh
node $D/li.mjs --doctor            # host_clients: none  ← what a healthy host says
kill <pid>                         # flock is kernel-held, so killing IS the fix
```

⚠ **`lsof` cannot answer this on macOS** — it reports an empty lock field even for a genuinely
held flock (measured), and Docker Desktop's VM always has the lock file open because
`~/.linkedin-mcp` is bind-mounted. So the doctor greps `ps` for the process, not the file.

## An IMPORT can fail where a LOGIN succeeds

Also 2026-08-29, once the stranded process was gone. `--import-from-browser` found **five** Chrome
profiles with unexpired `li_at` (into 2027) and every one of them was rejected:

```
Feed auth check failed: HTTP ERROR 400 at https://www.linkedin.com/feed/
❌ Imported cookies did not produce a valid session.
```

**`--login` in the same browser, minutes later, worked first time.** So a 400 here is not "your
cookies expired" — the tool says that, and it was wrong. Four hypotheses died on the way, each by
measurement rather than argument: a clean browser reaching `/feed` got a normal 302 (so the
machine, the network and LinkedIn are fine); a 12 KB junk cookie header got 302 (not a size
limit); duplicate `bscookie` names — the import seeds it three times — got 302; an unquoted
`JSESSIONID` got 302. LinkedIn only produces the 400 for a request it actually authenticates,
which is why none of it reproduces with fake credentials.

⚠ **`--no-headless` does not reach the import's validation** — the log says `headless=True`
whatever you pass, so "is it headless detection" stays untested.

**So: when an import fails, go straight to `--login` rather than debugging the import.**

⚠ **`source-state.json` no longer carries `user_agent`** (v4.23.1) — the `python3 -c …['user_agent']`
recipe in *First-time setup* raises `KeyError` now. Whatever is already in `.env` stays; there is
nothing to re-read after a login.

⚠ **The container image and the host CLI drift apart.** A fresh host login ran **4.23.1** while the
container that then scraped reported **4.20.0**. It worked, but `docker pull
stickerdaniel/linkedin-mcp-server` is what rules the skew out.

## Photos: harvest with a real browser, import with `import-avatars.mjs`

Since the scraper cannot supply a photo (below), the only route that works is a browser session
that is already logged in — a browser-use agent, driven by the operator. Two halves, both in this
skill:

- **`references/harvest-photos-prompt.md`** — the prompt to hand that session. It works the
  CONNECTIONS LIST (`/mynetwork/invite-connect/connections/`) rather than one profile at a time,
  because every row there already carries the avatar `<img>`; it forbids Connect/Message/`…`
  clicks and any Messaging access, tells the agent to stop on the first captcha and return
  partials, and fixes the output as one JSON array keyed by contact id.
- **`bin/import-avatars.mjs`** — the return leg. `node …/import-avatars.mjs harvested.json [--dry]`
  fetches each URL, writes `assets/avatars/<id>` and sets `contacts.avatar`.

⚠ **It sniffs MAGIC BYTES, not the HTTP status and not the URL.** A licdn photo URL carries no
extension at all, and filling the company logos found two of seventeen "200 OK" fetches were HTML
error pages and one PNG named `.svg`. A ghost avatar (`static.licdn.com`) is rejected by host.

⚠ **`linkedin_degree` and `linkedin_mutuals` are relative to the signed-in ACCOUNT.** Harvesting
from an alternate account and writing those two fields records the wrong network. Photos, names,
roles and companies are account-neutral; those two are not.

## THE SCRAPER RETURNS NO PHOTO

`get_person_profile` returns TEXT sections only. There is **no** profile-photo URL in any response:
`photo`, `avatar`, `image`, `licdn` and `displayphoto` appear **nowhere** in the entire
`linkedin_mcp_server` package (grepped 2026-08-29). So `contacts.avatar` cannot be filled from this
path at all, however healthy the session — see
`rnd/open-questions/harvesting-linkedin-profile-photos-at-scale`.

## Reading failures — the expensive lesson

**An all-null profile means a stale server version, not a bad session.** This cost a debugging
session on 2026-07-29 (decision 83): Docker's MCP Toolkit catalog pinned **v1.4.0** (Aug 2025), whose
Selenium selectors had rotted. It returned this, after 40 seconds, with **no error**:

```json
{ "name": null, "about": [], "experiences": [], "educations": [], "company": null, "job_title": null }
```

That is upstream issue #42, fixed in v2 — the maintainer's fix explicitly included *"improved error
handling"*, because the silence was part of the bug. **v4 fails loudly instead**, in about a second:

```
No valid LinkedIn session is available in Docker. Run --login on the host machine to create a
session, then retry this tool.        [isError: true]
```

So: **a clear error message is the normal failure mode now.** Trust it and act on it. If you ever
again see fields that are all `null` with no error, check the version before anything else — the
server prints it in its startup banner (`mcp-server-linkedin, 4.20.0`), and `docker pull
stickerdaniel/linkedin-mcp-server:latest` refreshes it. Note `:latest` resolves to **whatever was
last pulled**, so it goes stale silently; a pull is how you rule that out.

### `ERR_TOO_MANY_REDIRECTS` means the session is DEAD — and the log lies about it

Every navigation failing with `net::ERR_TOO_MANY_REDIRECTS` — profiles, search, everything — is
LinkedIn bouncing between its authwall and your target. **`auth_barrier=None` in the server log is a
red herring**: the navigation dies at the network layer before any page can be classified, so the
detector reports "no auth barrier" when an auth barrier is precisely the cause. Don't trust that field.

**The mount makes the browser's own screenshots readable on the host** — this is the fastest diagnosis
available, so reach for it before theorising:

```sh
ls -td ~/.linkedin-mcp/trace-runs/*/ | head -1        # newest run
# then open <run>/screens/003-bridge-after-cookie-import.png
```

If that screenshot shows LinkedIn's **Sign in** page, the cookie is gone: re-run
`uvx mcp-server-linkedin@latest --import-from-browser` on the host. Nothing to restart — the next batch
starts a fresh container that re-derives from the new cookies. A blank white `004-feed-after-goto.png`
(~4 KB, versus ~36 KB for a real page) says the same thing, so file size alone is a usable signal, and
`--doctor` automates exactly this check. `<run>/server.log` is the full narrative for anything the
screenshots don't settle.

## The scarce resource is *the session*, not credit

There is no per-call charge. What actually breaks:

1. **Never let two containers hold the same profile. MEASURED, not assumed** — this killed a fresh
   session inside ~9 minutes on 2026-07-29 (decision 84). Two Claude Code sessions in this repo each
   spawned their own container from a stdio `.mcp.json` entry, both mounting `~/.linkedin-mcp`;
   LinkedIn invalidated the `li_at` for using it from two places, and **stopping the containers does
   not undo it** — the session is dead server-side and needs a fresh login. `li.mjs`'s lock is what
   prevents a repeat, and it is verified: with a batch running, a second invocation is refused and the
   container count stays at 1. Sanity check any time:
   `docker ps --filter ancestor=stickerdaniel/linkedin-mcp-server` should be **0 between batches**.
2. **The session expires** — LinkedIn's cookie lifetime is weeks, and a password change kills it
   early. `--doctor` tells you before you spend a request; the fix is another `--import-from-browser`.
3. **The wall is ~6 PAGE LOADS per session, and page loads are not tool calls.** Measured twice on
   2026-07-29 (decision 86), with the same result from two independent sessions: **two profile calls
   succeeded, then every navigation redirect-looped** and the session was dead. Each requested section
   is a **separate navigation**, so:

   | call | page loads |
   |---|---|
   | `get_person_profile(slug)` | **1** |
   | `get_person_profile(slug, sections: "experience,education")` | **3** |

   Two profiles at 3 loads each = 6, and load 7 was refused. So `sections` is the expensive parameter,
   not the number of people. **Budget in loads.** Ask for no section you will not write down, take the
   top card alone on a first pass, and come back for sections only on people who matter.
4. **Volume looks like automation.** LinkedIn restricts accounts for automated access — it's against
   their User Agreement. A captcha or a "confirm in the mobile app" prompt means **stop** and tell the
   operator; it needs a human on a phone, and retrying escalates toward a restriction. Never sweep the
   whole `draft` queue.

**Set `LINKEDIN_USER_AGENT` in `.env`, and use the RIGHT string.** Not one from DevTools and never an
invented one — use exactly what the host login recorded, because that is the browser the cookie was
minted in:

```sh
python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.linkedin-mcp/source-state.json')))['user_agent'])"
```

The reason this is more than generic anti-detection hygiene: `source-state.json` reports
`source_runtime_id: macos-arm64-host` while every scrape reports `current_runtime_id:
linux-arm64-container`. So by default **the same session token arrives from a different platform than the
one it was issued to**, which is what session hijacking looks like from LinkedIn's side. Matching the UA
removes that discrepancy. `li.mjs` passes it through and warns on stderr when it is unset.

**Still unproven as the fix for the page-load wall.** It was unset during both measured sessions, and
setting it does **not** revive an already-dead cookie (tested — a dead cookie stays dead). Testing it
properly needs a fresh `--import-from-browser` followed by a top-card-only batch, which is the next
experiment, not a solved problem. The server tracking `source_runtime_id` vs `current_runtime_id` at all
suggests upstream knows about the mismatch and may already compensate somewhere — no evidence either way
in the logs, and no upstream issue on it.

If any of these fire, **fall back to web search** rather than retrying. It's free and risks nothing —
and a web-only pass is a legitimate result, not a failure, as long as `creation_context` says so.

**When the session dies mid-batch, write up what you already got.** Both measured sessions produced two
good profiles before dying; discarding them because the batch was incomplete would waste the only
expensive thing here. Record the ones you have, leave the rest `draft`, and say which is which.

## Name → slug

The built-in path, `search_people`, is **dead** — upstream #526. Verified 2026-07-29 on a healthy
session: both a `network`-filtered and a plain keyword query returned `ERR_TOO_MANY_REDIRECTS`. Skip it
entirely and use `WebSearch`:

```
WebSearch: "Dana Oren" northwind linkedin.com/in
```

Google indexes the public shell of most profiles, so the slug is usually right in the result URL.
`get_company_employees(company_name, keywords)` is the second angle, and the strongest one when you
know the employer but not the person — it is how a colleague was identified from an email convention
alone. **`company_name` is the URL slug**, not the display name (`northwind-group`, not
`northwind`); `search_companies` returns the slug if you don't have it.

The third angle is free: **a scraped profile's `references` list leaks other people's slugs.** One
scraped top card handed over the slug of a person who was already a `draft` contact.
Harvest those from every scrape before spending a call on resolution.

**Confirm the person before scraping.** Two matching signals minimum (company, city, headline, role),
because a wrong slug writes wrong data into a contact record — a worse failure than wasting a call.

## What the profile says about YOUR relationship

Not a structured field, so it has to be parsed out of the `main_profile` text, but it's there and it's
worth capturing while you have the page:

| in the text | means | record as |
|---|---|---|
| `· 1st` / `· 2nd` / `· 3rd` | network distance from the operator | `linkedin_degree` |
| `Priya, Tom and 67 other mutual connections` | 69 mutuals — **a floor, not exact** | `linkedin_mutuals` |
| the action button: `Connect` / `Message` / `Pending` | `Pending` = the operator already has an invitation out to them | note it in the body |

There is **no way to query by degree** — `search_people`'s `network` filter is the only such facet and
that tool is dead. So capture it during the scrape or pay for a re-scrape later.

## Phase 2 — complement from web search (free, and often the only thing that works)

LinkedIn is one source and frequently not the best one. **After** the scrape — or **instead of** it
when LinkedIn has nothing, the person has no profile, or the session is dead — fill the gaps with
web search. It costs nothing and risks nothing, so there is no reason to skip it.

What web search reliably adds that a LinkedIn scrape does not: a **current** role when the profile is
stale, company news that explains why they are in a meeting, conference talks and podcasts, published
writing, and a personal or company site. What it is bad at: employment dates, and telling two people
with the same name apart — cross-check against something you already know (company domain from the
meeting they appeared in, city, a mutual contact).

**Per-field provenance is the whole point.** Do not blend sources into one anonymous blob:

| field came from | `source` |
|---|---|
| the LinkedIn MCP scrape | `linkedin:<slug>` |
| a web page you read | `url:<the page>` |
| the calendar attendee list (a placeholder's starting point) | `calendar:<id>` |
| your own inference from the above | leave `source` as whatever you read, and put the inference in `creation_context` with `confidence: low` |

Records scraped before 2026-07-29 carry `source: apify:harvestapi` — the retired Apify path, still
true of those fields. Don't rewrite it; new fields get `linkedin:<slug>`.

When two sources **disagree** (LinkedIn says one company, a recent article says another), do not silently
pick one: record the more current value in the field, and name the discrepancy in the body with both
sources. That is exactly the case the quad exists for.

## Status transitions — the enrichment queue

`contacts.status` is what makes the queue derivable, so move it deliberately:

- **`draft`** — a placeholder, usually created by `fetching-meetings` from an attendee list: a name, maybe
  an email, nothing else. `/scrape-contact` shows as *available* on exactly these.
- **`enriched`** — set it after a pass that actually produced something, whether from LinkedIn, web
  search, or both. A pass that found nothing leaves the record `draft` and says why in
  `creation_context`; marking an empty record `enriched` hides it from the queue forever, which is
  the one unrecoverable mistake here.
- **`verified`** — **never yours to set.** The operator confirms a person; a scraper does not.

## Why there is no MCP entry (and no Toolkit entry)

Both obvious install routes are wrong here, for different reasons.

**Docker Desktop → MCP Toolkit** pins **v1.4.0**, and its config schema (a `cookie` secret mapped to a
`LINKEDIN_COOKIE` env var) is the **v1 contract** — v4 dropped that variable entirely for the mounted
profile directory. Leave the catalog version and you get the silent-null bug; retag the image inside a
Toolkit profile and you get a container with no session at all (decision 83).

**A stdio `linkedin` entry in `.mcp.json`** looks right and is worse, because it fails quietly and
expensively: a stdio server serves exactly one client (one stdin/stdout pair), so Claude Code spawns
**one container per session** — and two containers on one profile invalidate the cookie (decision 84).
A long-lived HTTP server would fix that by making the singleton explicit, and was rejected as a daemon
nobody wants running with a live LinkedIn session on it (decision 85).

What's left is the honest trade: **native `mcp__linkedin__*` tools require something reachable when a
session starts**, so you cannot have native tools *and* zero idle footprint. `li.mjs` takes the second,
and pays for it with ~200 lines that this skill would rather not have.

## Common mistakes

- **Touching `connect_with_person` or `send_message`** — irreversible, public, and as the operator.
- **Diagnosing an all-null result as an auth problem** — it's a version problem. See above.
- **Trusting `auth_barrier=None`** on a redirect-loop failure — it means "couldn't classify", not
  "not an auth wall". Look at the screenshot instead.
- **Putting the server back in the Docker MCP Toolkit** — that's the bug, not the fix.
- **Adding a `linkedin` entry to `.mcp.json` at all** — a stdio entry spawns one container per Claude
  session, and two containers on one profile kill the session. There is no entry on purpose; batches go
  through `bin/li.mjs`.
- **Not calling `close_session`** after a batch — leaves a browser holding the session.
- **Using `search_people`** — confirmed dead (upstream #526): both filtered and unfiltered queries
  return `ERR_TOO_MANY_REDIRECTS` even on a healthy session. Use `WebSearch` or
  `get_company_employees`, and mine a scraped profile's own `references` — they leak other people's
  slugs for free.
- **Batching the whole `draft` queue** — you will not get through it anyway (the session dies at ~6
  page loads), and a long run of authenticated fetches is what an automation pattern looks like from
  LinkedIn's side. Budget in loads, most-important-first.
- **Retrying through a captcha or a mobile-app confirmation** — that escalates. Stop and report.
- **Passing the full URL where the slug is wanted** — `linkedin_username` is `dana-oren`, not
  `https://www.linkedin.com/in/dana-oren/`.
- **Letting Docker create `~/.linkedin-mcp`** — it lands root-owned and the host `--login` then fails.
- **Trusting a `search_people` or web-search hit blindly** — they are *candidates*. Confirm on two
  signals before scraping, especially for common names.
- **Skipping phase 2 because the scrape succeeded** — web search is free and usually has the *current*
  role.
- **Marking a record `enriched` when the pass found nothing** — it drops out of the queue permanently.
  Leave it `draft` and say why in `creation_context`.
- **Setting `status: verified`** — that is the operator's, never a scraper's.
- **Blending sources into one blob** — `source` is per-field (`linkedin:<slug>` vs `url:<page>`), and a
  disagreement between sources gets named in the body, not silently resolved.
- **Committing scraped JSON dumps** — write them to scratch; commit only the distilled contact records.
