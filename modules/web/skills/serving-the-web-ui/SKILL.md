---
name: serving-the-web-ui
description: >-
  use when a person asks a session to show the workspace, open the web UI, see the records in a browser or in the Browser pane beside the chat — "show me the workspace", "open dt web", "give me the URL", "stop the web UI", "is the web UI running" — in Claude Code desktop, Codex, a terminal or a cloud session. How to start `dt web` in the background, read its sign-in URL, hand the URL to whatever shows it, and stop it.
---

# serving-the-web-ui

`dt web` serves the dreamteamer UI over this workspace on loopback. It prints ONE thing you need: its first
stdout line, `✔ dreamteamer web at http://127.0.0.1:<port>/sign-in/<code>`. The code in that URL signs in
once and expires after 10 minutes; `dt web url` mints a fresh one from the running server.

## 1. Is one already running?

```bash
npx dt web status        # exit 0: "running at http://127.0.0.1:<port> · pid <n> · since <time>"; exit 1: "not running"
```

Running: go to step 3 with a fresh URL from `npx dt web url`. A second `dt web` in the same workspace refuses
to start and names the running one.

## 2. Start it in the background

Run it as a background command, never in the foreground: it serves until it is stopped.

```bash
npx dt web --no-open                      # Claude Code: CLAUDE_PID is read on its own, and the server stops when the session ends
npx dt web --no-open --owner-pid "$PPID"  # Codex, or any harness without CLAUDE_PID: stops when that process exits
```

Read the URL from the first line of the command's output. Without the package installed, the same works through
`npx -p @dreamteamer/web dt-web . --no-open`.

The server also stops after 30 minutes with no page connected (`--idle <minutes>`, `0` never).

## 3. Hand the URL to what shows it

- **Claude Code desktop:** open it in the Browser pane beside the chat with `preview_start` and the URL as
  `url`. Mint the URL right before opening it (`npx dt web url`): a code used once, or older than 10 minutes,
  shows a sign-in page instead of the workspace.
- **Codex, a terminal session, or any harness without a browser pane:** give the person the URL and say it
  signs in once; `npx dt web url` gives another.
- **A cloud session (Claude Code on the web, Codex cloud):** the capability is unavailable. The server listens
  on the cloud machine's loopback, which the person's browser cannot reach, and `dt web` has no tunnel and no
  other address by design. Say so, and suggest running it on their own machine.

Never paste the URL into a file, a commit, a record or a note: until it is used it is a key to the workspace.

## 4. Stop it

```bash
npx dt web stop          # "stopped", exit 0 — or "not running", exit 1
```

## A launch entry for the Browser pane

A workspace may keep a `.claude/launch.json` entry so the pane can start the server by name. `dt web` takes
its port from `--port` (or `DT_WEB_PORT`), not from `PORT`, so give it a fixed port rather than `autoPort`:

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "dreamteamer-web", "runtimeExecutable": "npx", "runtimeArgs": ["dt", "web", "--no-open", "--port", "4870"], "port": 4870 }
  ]
}
```

The pane opens `http://localhost:4870/`, which answers the sign-in page: then open a fresh URL from
`npx dt web url` (or the entry's output in `preview_logs`) in the same pane.

## What the page reads

- The nav follows the workspace's `.vscode/settings.json` (`dreamteamer.navGroups`, `navOrder`, `navHidden`,
  `layersFolder`). A setting kept in the person's VS Code user settings is not seen by the browser.
- Records change on the page as they change on disk — a `dt set`, an agent's write, a `git pull` — with no
  reload.
