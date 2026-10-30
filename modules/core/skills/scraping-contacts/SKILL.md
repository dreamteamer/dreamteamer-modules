---
name: scraping-contacts
description: Use when you need LinkedIn profile or company data (headline, current role, experience, education, skills) for one or more people — to build or enrich contact records — given their profile URLs, or just names to search for, and WebFetch/a logged-in browser can't get past LinkedIn's auth wall.
---

# Scraping Contacts

## Overview

Pull LinkedIn data through **`linkedin-mcp-server` v4** (stickerdaniel), a container driving a headless
Chromium that holds **your own LinkedIn session**. LinkedIn blocks direct `WebFetch` with a
domain-verification wall, so this is the way in.

**The session is a singleton, and the whole design follows from that.** One browser, one profile
directory, one cookie. Used from two places at once, LinkedIn invalidates it, and that costs a host
re-login rather than a retry. So there is **no `linkedin` entry in `.mcp.json`**: a registered stdio
server spawns one container per agent session, which is exactly that collision. Instead you run **one
ephemeral, lock-guarded container per batch** through `bin/li.mjs`, and it exits when the batch does.
Nothing idles, and the lock makes "exactly one" true.

**Every call is an authenticated request from your real account.** That, not money, is the constraint
that shapes everything below.

## NEVER use these tools

The server ships write and inbox tools. They are not part of contact enrichment, and each one acts as
you, irreversibly and in public:

| tool | why not |
|---|---|
| `connect_with_person` | sends a real connection request. **No confirmation parameter** — the call *is* the action |
| `send_message` | sends a real DM. `confirm_send` is a guard, not permission |
| `get_inbox` / `get_conversation` / `search_conversations` | reads your private DMs. Enrichment never needs this |
| `get_feed` / `search_posts` / `get_saved_jobs` / `get_recommended_jobs` | a different job |

`li.mjs` refuses `connect_with_person` and `send_message` with exit code 3 before any container
starts. If a task seems to want one of these, **stop and ask** — that is a person's decision, not a
scraper's.

## The tools you do use

| tool | signature | use |
|---|---|---|
| `get_person_profile` | `(linkedin_username, sections?, max_scrolls?)` | one person. **`linkedin_username` is the slug**, not the URL: `https://www.linkedin.com/in/dana-oren/` → `dana-oren` |
| `get_company_profile` | `(company_name, sections?)` | a company page (slug from `linkedin.com/company/<slug>`) |
| `search_companies` | `(keywords)` | company name → slug |
| `get_company_employees` | `(company_name, keywords?)` | find a person through their employer — identifies a colleague from an email convention alone |
| `close_session` | `()` | end the browser session after a batch (`li.mjs` calls it for you) |

`search_people` fails even on a healthy session (upstream #526). Do not spend a call on it.

**`sections` is a comma-separated STRING, not an array** — `"experience,education"`. A list is a
pydantic validation error. Available: `experience`, `education`, `interests`, `honors`, `languages`,
`certifications`, `skills`, `projects`, `contact_info`, `posts`. **Omitting `sections` returns only the
top card** — name, headline, location, current company, school, follower count. Each section is another
page load, so ask only for what you will write down.

`max_scrolls` (1–50) caps "Show more" clicks per section, default 5 (10 for posts). Raise it for a
profile with 30+ items in one section, and request heavy sections in a separate call.

A section can fail on its own while the rest succeed: its value is LinkedIn's `"Something went wrong"`,
and `li.mjs` lists it under `failed_sections`. Fetching by URN fails this way more often than by slug,
so prefer the slug once you have it.

## First-time setup

**Order matters** — the login (step 2) must exist before any container runs. Docker creates a missing
bind-mount source **as root**, so a container started first leaves `~/.linkedin-mcp` root-owned and the
login cannot write to it (recoverable with `sudo rm -rf ~/.linkedin-mcp`).

**1. Two things installed.**
- **Docker Desktop**, running. Add nothing to its MCP Toolkit and nothing to `.mcp.json` (see
  *Why there is no MCP entry*).
- **`uv`** (which provides `uvx`): `brew install uv`, or the installer at astral.sh/uv. Check with
  `uvx --version`.

**2. The LinkedIn session, on the HOST.** Prefer the import — it reuses the session already in
Chrome/Brave/Edge/Arc/Vivaldi, and repeated fresh logins are what trigger a captcha:

```sh
uvx mcp-server-linkedin@latest --import-from-browser
# if the import fails or finds nothing: --login  (opens a browser; 2FA/captcha fine, ~5 min allowed)
```

This creates **`~/.linkedin-mcp/`** — outside the repo, never committed — holding `cookies.json`,
`source-state.json`, a Patchright browser and `trace-runs/` diagnostics, about 220 MB in all. Each
container derives a fresh browser profile from it at startup, so there is nothing to restart afterwards.

**3. Optionally, `LINKEDIN_USER_AGENT` in the workspace `.env`.** `li.mjs` passes it to the container
as `USER_AGENT` and warns on stderr when it is unset. The session token is minted on the host and then
used from a Linux container; a matching user agent removes that one discrepancy. Use the exact string
of the browser the session came from, never an invented one. Whether it raises the page-load ceiling is
unproven, and it does not revive a dead cookie.

**4. Confirm it worked**, spending no LinkedIn request:

```sh
node .dreamteamer/skills/scraping-contacts/bin/li.mjs --doctor
```

Want `cookies: true`, a recent `login_at`, `batch_lock: free`, `containers_running: 0`,
`host_clients: none`. Right after a login the verdict is *"login is NEWER than any scraping evidence —
session untested"*: the doctor never reuses evidence older than the login. The **first** batch also
pulls the image (about 0.5 GB), so it runs slow once.

## Running a batch — `bin/li.mjs`

Run from the workspace root, after a compile:

```sh
D=.dreamteamer/skills/scraping-contacts/bin

# is the session alive? costs NO LinkedIn request — always start here
node $D/li.mjs --doctor

# one call
node $D/li.mjs get_person_profile '{"linkedin_username":"dana-oren","sections":"experience,education"}'

# a BATCH: one container, one browser, N calls, then gone
echo '[
  {"tool":"get_person_profile","args":{"linkedin_username":"dana-oren"}},
  {"tool":"get_person_profile","args":{"linkedin_username":"sam-diaz"}},
  {"tool":"get_company_employees","args":{"company_name":"northwind-group","keywords":"Diaz"}}
]' | node $D/li.mjs --stdin
```

Batch rather than looping single calls — a container per person pays startup and session derivation
every time. Output is a JSON array of `{tool, args, ok, result|error}`, plus `failed_sections` when a
call returned `ok` with some section missing.

Exit codes: `0` all good · `1` at least one call failed · `2` bad usage · `3` refused a banned tool ·
**`4` another batch holds the lock** — not an error to retry past. Wait, or find out why the other
batch is stuck; two containers on one profile is what invalidates the session.

`--doctor` reads the newest trace run's post-import screenshot from disk: a real page is about 36 KB, a
bounce to the sign-in wall leaves it blank at about 4 KB. It also lists `host_clients`, any
`mcp-server-linkedin` process on the host still holding the browser lease. It finds them with `ps`,
because on macOS `lsof` shows no holder for a held flock and Docker's VM always has the lock file open.

## The session is the scarce resource

There is no per-call charge. What breaks:

1. **Two containers on one profile.** LinkedIn invalidates the `li_at` cookie for being used from two
   places, and stopping the containers does not undo it — the session needs a fresh login. `li.mjs`'s
   lock prevents it. `docker ps --filter ancestor=stickerdaniel/linkedin-mcp-server` is **0 between
   batches**.
2. **Expiry.** The cookie lasts weeks, and a password change ends it early. `--doctor` tells you before
   you spend a request.
3. **About six PAGE LOADS per session, and a page load is not a tool call.** Each requested section is
   a separate navigation:

   | call | page loads |
   |---|---|
   | `get_person_profile(slug)` | **1** |
   | `get_person_profile(slug, sections: "experience,education")` | **3** |

   Two profiles at 3 loads each = 6, and load 7 was refused. So `sections` is the expensive parameter,
   not the number of people. **Budget in loads**: take the top card alone on a first pass (4–5 people),
   come back for sections only on people who matter, and order the batch most-important-first — once
   the wall hits, every later call returns nothing.
4. **Volume looks like automation.** LinkedIn restricts accounts for automated access. A captcha or a
   "confirm in the mobile app" prompt means **stop** and tell the person; it needs a human on a phone,
   and retrying escalates toward a restriction. Never sweep the whole `draft` queue.

If any of these fire, **fall back to web search** rather than retrying. A web-only pass is a legitimate
result as long as `creation_context` says so.

**When the session dies mid-batch, write up what you already got.** Record the profiles that arrived,
leave the rest `draft`, and say which is which.

## Reading failures

| what you see | what it means | do |
|---|---|---|
| `No valid LinkedIn session is available in Docker` (`isError: true`) | the cookie is gone | re-run `--import-from-browser` (or `--login`) on the host; the next batch picks it up |
| every navigation fails with `net::ERR_TOO_MANY_REDIRECTS` | LinkedIn is bouncing between its authwall and the target: the session is dead | check `<newest trace run>/screens/003-bridge-after-cookie-import.png` (`ls -td ~/.linkedin-mcp/trace-runs/*/ \| head -1`); a Sign in page confirms it. `auth_barrier=None` in the server log is not evidence — the navigation dies before the page is classified |
| a profile with every field `null` and no error | a stale server image, not a bad session | read the version in the startup banner; `docker pull stickerdaniel/linkedin-mcp-server:latest` (`:latest` is whatever was last pulled) |
| `BrowserBusyError: Another LinkedIn MCP client is using the browser` on `--login` or `--import-from-browser` | a host `mcp-server-linkedin` process never exited and holds `~/.linkedin-mcp/profile.lock` | `--doctor` names the pid under `host_clients`; `kill` it — the kernel releases the flock |
| `Feed auth check failed: HTTP ERROR 400` then `Imported cookies did not produce a valid session` | the import failed; the cookies may still be good | run `--login` instead of debugging the import |
| a section's value is `"Something went wrong"` | that section failed alone | re-fetch it by slug, in its own call |
| host CLI and container report different versions | the image drifted from the host tool | `docker pull stickerdaniel/linkedin-mcp-server` |

`--no-headless` does not reach the import's validation; the log says `headless=True` whatever you pass.

## Name → slug

`WebSearch` is the first angle — Google indexes the public shell of most profiles, so the slug is
usually in the result URL:

```
WebSearch: "Dana Oren" northwind linkedin.com/in
```

`get_company_employees(company_name, keywords)` is the second, and the strongest when you know the
employer but not the person. **`company_name` is the URL slug**, not the display name
(`northwind-group`, not `northwind`); `search_companies` returns it.

The third is free: **a scraped profile's `references` list carries other people's slugs.** Harvest them
from every scrape before spending a call on resolution.

**Confirm the person before scraping** on two matching signals (company, city, headline, role). A wrong
slug writes wrong data into a contact record, which is worse than a wasted call.

## What the profile says about your relationship

Parsed out of the `main_profile` text; capture it while you have the page, because nothing queries by
degree:

| in the text | means | record as |
|---|---|---|
| `· 1st` / `· 2nd` / `· 3rd` | network distance from the signed-in account | `linkedin_degree` |
| `Priya, Tom and 67 other mutual connections` | 69 mutuals — **a floor, not exact** | `linkedin_mutuals` |
| the action button: `Connect` / `Message` / `Pending` | `Pending` = an invitation is already out | note it in the body |

`linkedin_degree` and `linkedin_mutuals` are relative to the **signed-in account**. Write them only from
your own account; photos, names, roles and companies are account-neutral.

## Photos

`get_person_profile` returns text sections only — no profile-photo URL in any response — so
`contacts.avatar` cannot be filled from the scraper. The route that works is a browser session that is
already logged in, plus `bin/import-avatars.mjs`.

**The browser session** works the connections list (`/mynetwork/invite-connect/connections/`), where
every row already carries the avatar `<img>`, rather than one profile at a time. Tell it: no Connect,
Message or `…` clicks and no Messaging; stop on the first captcha and return what it has; and return one
JSON array keyed by contact id:

```json
[
  { "id": "dana-oren", "photo": "https://media.licdn.com/dms/image/…" },
  { "id": "sam-diaz", "photo": null, "note": "ghost avatar" }
]
```

**The import** fetches each URL, writes `assets/avatars/<id>` and sets `contacts.avatar`:

```sh
node .dreamteamer/skills/scraping-contacts/bin/import-avatars.mjs harvested.json --dry   # then without --dry
```

It accepts only `media.licdn.com` URLs (a ghost avatar on `static.licdn.com` is rejected), sniffs the
**magic bytes** rather than trusting the HTTP status or the URL — an error page can arrive as `200 OK`
and a licdn URL has no extension — and refuses anything over the `assets` collection's 200 KB cap.

## Web search — after the scrape, or instead of it

LinkedIn is one source and often not the best one. After the scrape — or instead of it when the person
has no profile or the session is dead — fill the gaps from web search. It is free and risks nothing.

Web search reliably adds a **current** role when the profile is stale, company news that explains why
they are in a meeting, talks, podcasts, published writing, and a personal or company site. It is bad at
employment dates and at telling two people with the same name apart — cross-check against something
you already know (the company domain from their meeting, a city, a mutual contact).

## Writing the record

**`source` names what you read**, prefixed:

| you read | `source` |
|---|---|
| the LinkedIn scrape | `linkedin:<slug>` |
| a web page | `url:<the page>` |
| the calendar attendee list (a placeholder's starting point) | `calendar:<id>` |

`source` holds one value. When a pass read several, set the one most fields came from and name the
others in the body. When two sources **disagree** (LinkedIn says one company, a recent article another),
put the more current value in the field and name the discrepancy in the body with both sources.
Anything you inferred rather than read gets `confidence: low` and the reason in `creation_context`.

`author` is `agents/<harness>` (for example `agents/claude-code`); the model goes in `creation_context`.

**`status` is what makes the queue derivable** — `/scrape-contact` enters on `draft`:

- **`draft`** — a placeholder, usually created from a meeting's attendee list (`fetching-meetings`, in
  the meetings module): a name, maybe an email.
- **`enriched`** — set it after a pass that actually produced something, from LinkedIn, web search or
  both. A pass that found nothing leaves the record `draft` and says why in `creation_context`; an empty
  record marked `enriched` drops out of the queue for good.
- **`verified`** — **never yours to set.** A person confirms a contact; a scraper does not.

Write scraped JSON dumps to scratch space; commit only the distilled contact records.

## Why there is no MCP entry

- **Docker Desktop's MCP Toolkit** pins an old v1 image whose config (a `cookie` secret mapped to
  `LINKEDIN_COOKIE`) v4 no longer reads: the old image returns all-null profiles, and a retagged one
  starts with no session at all.
- **A stdio `linkedin` entry in `.mcp.json`** serves exactly one client, so every agent session spawns
  its own container — and two containers on one profile invalidate the cookie.
- **A long-lived HTTP server** would make the singleton explicit, at the price of a daemon holding a
  live LinkedIn session.

Native `mcp__linkedin__*` tools need something reachable when a session starts, so you cannot have
native tools and zero idle footprint. `li.mjs` chooses zero idle footprint.

## Common mistakes

- **Calling `connect_with_person` or `send_message`** — irreversible, public, and as you.
- **Reading an all-null profile as an auth problem** — it is a stale image.
- **Trusting `auth_barrier=None`** on a redirect loop — look at the screenshot.
- **Adding the server to the MCP Toolkit or `.mcp.json`** — batches go through `bin/li.mjs`.
- **Passing the full URL where the slug is wanted** — `linkedin_username` is `dana-oren`, not
  `https://www.linkedin.com/in/dana-oren/`.
- **Letting Docker create `~/.linkedin-mcp`** — it lands root-owned and the host login then fails.
- **Trusting a web-search hit blindly** — it is a candidate. Confirm on two signals, especially for
  common names.
- **Asking for sections you will not write down** — each one is a page load against a budget of six.
- **Retrying through a captcha or a mobile-app confirmation** — stop and report.
- **Skipping web search because the scrape succeeded** — it usually has the current role.
- **Marking a record `enriched` when the pass found nothing, or setting `verified` at all.**
