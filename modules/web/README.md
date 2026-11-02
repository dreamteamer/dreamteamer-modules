# @dreamteamer/web

`dt web` — the dreamteamer UI in a browser, over any compiled workspace on your machine: the same nav,
lists, boards and record pages the VS Code extension draws, served on a loopback address with a one-time
token, refreshed as records change on disk. Run it from a terminal, or let a Claude Code desktop session
start it and open it in the pane beside the chat. No editor needed.

> **Not released yet.** This README is written ahead of the code: it is the contract the module is built
> to. Until a version is published, the commands below are what it will answer.

## install

In a dreamteamer workspace (engine `>=0.43.0`):

```bash
npm install --save-dev @dreamteamer/web
dt web                     # starts, prints the URL, opens your browser
```

```text
✔ dreamteamer web at http://127.0.0.1:53817/?token=4f1c…e9a2
```

Or without adding a dependency to the workspace — it uses the workspace's own engine either way:

```bash
npx -p @dreamteamer/web dt-web .
```

## run it

```bash
dt web                       # loopback, a free port, opens the default browser
dt web --port 4870           # a fixed port; PORT in the environment works too
dt web --no-open             # print the URL, open nothing (what a session uses)
dt web --idle 30             # stop after 30 minutes with no page open (the default)
dt web --owner-pid 4242      # stop when that process exits
dt web url                   # print the running server's URL again, token included
dt web status                # running at http://127.0.0.1:<port> · pid · owner · since — exit 0; not running — exit 1
dt web stop                  # stop it
```

One server serves one workspace. `dt status` names a running one on its `editor:` line, and `dt doctor`
carries a `web` row. A server started by a Claude Code session stops when that session ends; one started
by hand stops on Ctrl-C, `dt web stop`, or the idle timer.

## what you see

**In a browser.** The left bar is the workspace's nav — module folders, collections with their record
counts, saved views, a Layers folder for the workspaces read under `git_modules/` — drawn from the same
model the extension's tree is built from, and honouring the workspace's `.vscode/settings.json`
(`dreamteamer.navGroups`, `navOrder`, `navHidden`, `layersFolder`). Lists, boards, calendars, record pages
and the schema pages are the extension's own. The page follows your system's light or dark scheme. A
record changed on disk — by `dt set` in a terminal, an agent, a `git pull` — appears without a reload,
usually within a second.

**In the Claude Code desktop pane.** Ask a desktop session to show the workspace: it runs
`dt web --no-open` in the background, reads the URL, and opens it in its Browser pane with
`preview_start` — the same page, beside the chat. A workspace can also carry the entry itself:

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "dreamteamer-web", "runtimeExecutable": "npx", "runtimeArgs": ["dt", "web", "--no-open"], "port": 4870, "autoPort": true }
  ]
}
```

in `.claude/launch.json`. Started that way the pane opens the bare address first, which answers a short
page saying how to get in: the token URL is the first line of the server's output (`preview_logs`) or
`dt web url`. A Codex session starts it the same way and hands the URL back for a browser. A cloud session
(Claude Code on the web, Codex cloud) cannot reach a server on your machine, and says so.

## security

- **Loopback only.** `dt web` binds `127.0.0.1` and takes no `--host`. There is no tunnel and no
  multi-user mode. For the API alone on another address, `dt serve --host … --token …` is
  `@dreamteamer/http`'s.
- **This server's names only.** Every request's `Host` must be this server's own address and port, and an
  `Origin`, when sent, must be `http://` plus the same — anything else is `403`, which also closes a DNS name
  rebound to `127.0.0.1`.
- **A token, then a cookie.** Each start mints a new random token. Opening the printed URL swaps it for a
  cookie (`HttpOnly; SameSite=Strict; Path=/`) and redirects to `/`, so the token leaves the address bar.
  Every route then accepts that cookie or `Authorization: Bearer <token>` (for a script); without either it
  is `401`. The token is never written to logs after the first line, never to a redirect, never to the
  editor marker; it is kept in `.dreamteamer/web.json` (mode `0600`, readable by you alone) so
  `dt web url` can print it again.
- **Writes are the engine's.** A record edited in the page is validated and written exactly as `dt set`
  writes it, and a refusal is the engine's own sentence, shown beside the control. A write's body must be
  JSON; a same-origin or Origin-less one is accepted whatever its `Content-Type`.
- **Never exposed:** files outside the workspace, `.env` values, credentials, and any folder a declared
  variable does not render to. Images a record points at are served from declared roots only, with `..`,
  absolute paths and links out of the root refused; an `.html` page a record names opens only from inside the
  workspace.
- **Workspace code runs as in the editor.** A module's prebuilt app (`.dreamteamer/ui/`) runs in the page
  with your session, exactly as it runs inside VS Code: install modules you trust.

## the editor marker

`dt status` prints an `editor:` line from `.dreamteamer/editor.json`, the marker an editor writes when it
opens a workspace. While it serves, `dt web` writes its own there:

```json
{ "extension": "dreamteamer-web", "version": "0.1.0", "engine": "0.44.0", "state": "serving", "activated": "…", "host": "http://127.0.0.1:53817" }
```

so `dt status` reads `editor: dreamteamer-web 0.1.0 · serving … · engine 0.44.0 · http://127.0.0.1:53817`
— never the token. **Replace, then restore:** when the file already holds another editor's marker (the VS
Code extension's), `dt web` keeps those bytes beside `web.json`, replaces the file while it serves, and
puts them back byte for byte when it stops — on Ctrl-C, `dt web stop`, its owner's exit or the idle timer.
A server killed outright leaves its marker behind; the next `dt web status` or `dt web` notices the dead
process and restores the saved one.

## how it fits

| piece | role |
|---|---|
| `@dreamteamer/protocol` | the contract the UI speaks — `PROTOCOL.md`, a contract suite every host runs, and the shared handler that answers it |
| `@dreamteamer/http` | the transport: `Host`/`Origin`, the token, JSON bodies. `dt serve` is that alone, with no page |
| `@dreamteamer/web` | `http` over the shared handler, plus the page, the live channel (server-sent events), the token-to-cookie exchange, the editor marker and the owner watch |
| the VS Code extension | the same app inside the editor, its host in-process; the editor's tree is its nav |

**The page is the extension's own build.** Until the app ships as a package of its own, `dt web` serves the
webview of a PUBLISHED extension version, pinned in `dist/app/SOURCE.json` — the version (0.24.27, the
first to carry the browser page), its Open VSX download URL, and its sha256. `scripts/vendor-app.mjs
--version <v>` downloads that package, checks the hash, and unpacks its webview; a missing or mismatched
copy stops `dt web` with a message naming the script, never a blank page. Nothing built is committed to
this repository.

## requirements

- Node 20 or newer, and git.
- A dreamteamer workspace on engine `0.43.0` or newer, compiled (`dt compile`).
- macOS or Linux. Live refresh uses a recursive file watch, which Linux has from Node 20.
- No VS Code, no extension, no browser extension.

## limits and known gaps

- One workspace per server, one person per machine; loopback only.
- Gestures that belong to the editor — New Module…, New Skill…, running an editor command — are not drawn.
- The nav reads the workspace's `.vscode/settings.json` only; a setting kept in your VS Code user settings
  is not seen.
- Whether the desktop pane keeps the cookie across a restart of the desktop app is not yet known; if it
  does not, open the token URL again.
- Codex has no pane of its own here; its session hands back the URL.
- Windows is untested.

## troubleshooting

- **A page saying how to get in** — you opened the bare address. Open the token URL: `dt web url`.
- **`403`** — the address in the bar is not the one printed (another host name, another port). Use the
  printed URL.
- **A port in use** — `dt web --port 0` takes a free one; with `.claude/launch.json`, `autoPort: true`.
- **The page does not change when a record does** — check that the server is still running
  (`dt web status`); on Linux, check Node is 20 or newer.
- **`dt status` still names `dreamteamer-web` after the server died** — run `dt web status`; it restores
  the marker it saved.
- **"the app is missing" or "does not match"** — run `node node_modules/@dreamteamer/web/scripts/vendor-app.mjs
  --version` with the version in `dist/app/SOURCE.json`.

## not yet

Ideas, not plans, with no date:

- **Artifact pages with read-only live queries** — a built page (an `artifacts` record) that reads the
  workspace's records live through the same protocol, read-only, served beside the app.
