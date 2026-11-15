# Updating @dreamteamer/web

One section per release, newest first. Each says what a person or a session using `dt web` has to **do**.

```bash
npm install --save-dev @dreamteamer/web@latest
```

## 0.3.0

`dt web` is now one step to the pane beside the chat, on one listener that keeps its port.

- **One URL from `dt web open`.** `dt web` plus `dt web url` is gone: `npx dt web open [<ref>|<collection>|<ui-view>]`
  starts the server when it is not running and prints a sign-in URL for that target as its first line. It no
  longer opens a browser unless you pass `--browser`, so `--no-open` is gone too. A launch entry or a script that
  ran `dt web --no-open` runs `dt web start --foreground` instead.
- **A 60-second code.** The code in the URL signs in once and is refused a minute after it was minted (it was
  10 minutes). Mint it right before you open it.
- **A stable port.** The first start picks a free port and stores it; every later start reuses it, so the pane
  keeps its address. When another program took it, the server moves and says so.
- **A restart signs the pane out.** The session lives in the server's memory only: `dt web stop`, the idle stop or
  a reboot ends it, and the next `dt web open` pairs the pane again. The cookie (`dt_pane_<port>`) is a
  browser-session cookie, sent only on `/api/` and `/_dt/`, renewed on use while the server runs and ended after 7
  days idle. `dt web revoke` ends
  every session; `dt web stop` does too.
- **The server stops after 60 minutes** with no page and no token request (it was 30), and no longer stops with the
  chat that started it unless you pass `--owner-pid`.
- **`dt serve` is this package's** and prints a client token of the pane's own server (`dt web token --name serve`):
  loopback only, at Read unless `--edit`. **Remove `@dreamteamer/http` first: both claim `dt serve`, and the engine
  refuses two packages claiming one verb** — every `dt` command fails until one is gone.
  `npm uninstall @dreamteamer/http`.
- **Levels.** The workspace has a level, Edit until you choose: `dt web open --read`, `--edit` or `--admin`. The
  page shows it and can lower it; only the chat raises it.
- **The chat sees the pane.** Run `npx dt web hook --install` once per workspace: it writes a `UserPromptSubmit`
  entry into `.claude/settings.local.json` (per machine) so each prompt carries what the page shows, the ticked
  rows and anything queued with Ask in chat. Run it again after a Node upgrade that moved `node`.
- **Record files and frames moved** onto the same port: under `/_files/<key>/` and `/_frames/<key>/`, where they
  were on a second port. A link copied from an older page no longer opens; open the record again.
- **The page reads its boot values from `GET /api/host`** behind the cookie, so `@dreamteamer/ui` 0.3.0 is
  required (the dependency says so).

## 0.2.0

`@dreamteamer/protocol` and `@dreamteamer/ui` ^0.2.0: the nav is the workspace's `nav.yaml`, written on the first
page load from the old `.vscode/settings.json` keys when it does not exist yet. Nothing to do.
