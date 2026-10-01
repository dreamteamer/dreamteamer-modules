# scraping-contacts — field notes (not shipped)

How the skill's rules were found. The skill states each rule in the present tense; this file keeps the
measurements behind them for whoever maintains `li.mjs` next.

## The all-null profile (July 2026)

Docker Desktop's MCP Toolkit catalog pinned `linkedin-mcp-server` v1.4.0 (Aug 2025), whose Selenium
selectors had rotted. It returned `{ "name": null, "about": [], "experiences": [], … }` after about 40
seconds with no error — upstream issue #42, fixed in v2 with improved error handling. v4 fails loudly
in about a second (`No valid LinkedIn session is available in Docker`). The Toolkit's config schema
(a `cookie` secret mapped to `LINKEDIN_COOKIE`) is the v1 contract; v4 reads a mounted profile
directory instead, so retagging the image inside a Toolkit profile gives a container with no session.

## Two containers kill the session (July 2026)

Two agent sessions each spawned a container from a stdio `.mcp.json` entry, both mounting
`~/.linkedin-mcp`. LinkedIn invalidated `li_at` within about nine minutes, and stopping the containers
did not revive it. A long-lived HTTP server was considered and rejected as a daemon holding a live
session; the lock-guarded, per-batch container in `li.mjs` is what replaced both. With a batch running,
a second invocation is refused and the container count stays at 1.

## The six-page-load wall (July 2026)

Measured twice from independent sessions: two `get_person_profile` calls with
`sections: "experience,education"` (3 loads each) succeeded, then every navigation redirect-looped.
`LINKEDIN_USER_AGENT` was unset both times, so whether a matching user agent raises the ceiling is
untested; setting it on an already-dead cookie does not revive it. The host login reports
`source_runtime_id: macos-arm64-host` while scrapes report `current_runtime_id: linux-arm64-container`,
which is the reason to suspect the user agent at all.

`search_people` returned `ERR_TOO_MANY_REDIRECTS` for both a `network`-filtered and a plain keyword
query on a healthy session (upstream #526).

## BrowserBusyError and the doctor (August 2026)

A host `mcp-server-linkedin` process from two days earlier still held the flock on
`~/.linkedin-mcp/profile.lock`, with nine orphaned Patchright Chromium processes under it, so every
`--import-from-browser` and `--login` refused. `--doctor` reported `containers_running: 0`,
`batch_lock: free` and "session looks DEAD — run --import-from-browser", because it checked only Docker
and its own lock. It now reports `host_clients`. macOS `lsof` showed an empty lock field even for a
deliberately locked file, which is why the check greps `ps`.

## Import fails where login succeeds (August 2026)

With the stranded process gone, `--import-from-browser` found five Chrome profiles with unexpired
`li_at` and rejected every one (`Feed auth check failed: HTTP ERROR 400`). `--login` in the same
browser minutes later worked first time. Ruled out by measurement: the network (a clean browser
reaching `/feed` got a normal 302), header size (a 12 KB junk cookie header got 302), duplicate
`bscookie` names (302), an unquoted `JSESSIONID` (302). LinkedIn produces the 400 only for a request it
actually authenticates. `--no-headless` never reached the import's validation, so headless detection
stayed untested.

Since v4.23.1 `source-state.json` no longer carries `user_agent`, so the old
`python3 -c "…['user_agent']"` recipe raises `KeyError`. A host login on 4.23.1 was followed by a
container scrape reporting 4.20.0; it worked, and `docker pull` rules out the skew.

## Photos

`photo`, `avatar`, `image`, `licdn` and `displayphoto` appear nowhere in the `linkedin_mcp_server`
package, so the scraper cannot supply a profile photo. Filling company logos found two of seventeen
`200 OK` fetches were HTML error pages and one PNG was named `.svg` — why `import-avatars.mjs` sniffs
magic bytes.

## Process

`li.mjs` once called `process.exit()` inside its `try`, which skips `finally` and leaked the batch lock
on every successful batch; `--doctor` caught it reporting a lock held by a pid long gone.
