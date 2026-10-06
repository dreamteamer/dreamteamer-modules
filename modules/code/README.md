# @dreamteamer/code

The code module provides a browser editor and a Claude coordinator over an existing local Dreamteamer workspace, without Docker. The editor
and every terminal run as your OS user, over the original files. This is not a sandbox.

```sh
npm install @dreamteamer/code
```

This module is an unpublished development build. Install its local packed tarball until released.
The default installs Dreamteamer 0.23.3 from code-server's configured marketplace (Open VSX by default).
An exact release is pinned; identical verified installations are reused. A prior local VSIX is replaced
on the first marketplace start, even if it reports the same version.

```sh
npx dt-editor start .
# Optional exact published version:
npx dt-editor start . --extension-version 0.23.3
# Explicit development override only:
npx dt-editor start . --vsix /path/to/development.vsix
```

The published 0.23.3 extension supports collection navigation through `display.nav.section`.
It does not include the development local control socket or the custom current-user picker. The coordinator tools below require a supporting extension
release or the explicit development override. Engine modules can contribute schemas, views and CLI
commands, but cannot replace missing editor APIs. Keep private workspace records and preferences in
the workspace repository, and credentials in ignored local environment files or the credential store.

The launcher downloads pinned code-server 4.138.0 for macOS/Linux (arm64/x64), verifies the archive
against the official release's SHA-256 asset digest, installs Dreamteamer and the Claude Code
extension, and prints an authenticated loopback URL. `--code-server /path/to/bin/code-server`
uses an existing runtime; `--claude-vsix /path/to/claude.vsix` uses an offline Claude extension.
`--port 0` (default) chooses a free port. There is intentionally no host/bind option.

Open the URL, trust your workspace if appropriate, and open Claude Code. Sign in normally if
needed. The launcher preserves the user's HOME and Claude credential mechanism, so normal Claude
authentication remains available across editor restarts; it never copies credentials. Editor
settings, extensions and conversation UI state live in a per-workspace profile under
`~/.cache/dreamteamer/editor`. `DT_EDITOR_HOME` overrides that directory. Session URLs rotate on
every start. Ctrl-C stops the server; files and the profile stay.

## A coordinator inside the editor

The dedicated editor profile uses Claude's `claudeProcessWrapper` setting to add the UI MCP server,
a coordinator name, and a short role instruction to chat sessions. Start one conversation in that
profile and send an initial message. Keep that conversation open as the coordinator. Other sessions
in the same window may receive a variant name; the relay refuses ambiguity rather than picking one.
The wrapper affects this dedicated editor profile only, not desktop VS Code or global Claude settings.

```sh
npx dt-editor claude .              # open the installed Claude chat panel
npx dt-editor state .               # inspect tools, app route, views and tabs
npx dt-editor message . --text 'Show the tasks board, then report the visible route.'
npx dt-editor url .                 # print this running session's login URL
```

`message` uses a short `claude -p` sender with only `ListAgents` and `SendMessage`. Any local coding
agent or script can invoke it. It keeps the sender alive for the coordinator’s reply (up to 90 seconds), and reports
that reply. A timeout distinguishes unconfirmed delivery from delivery without a completion reply. Normal receiver permission prompts still apply. No private inbox-file format
or undocumented socket message protocol is written. Cross-machine callers need their own authorized
local execution channel; the editor never exposes a public port.

The coordinator gets four tools: `editor_state`, `open_view`, `select_collection`, and `open_file`.
They call a narrow, opt-in socket in the Dreamteamer extension. No arbitrary VS Code command runner
is exposed. Use `editor_state` to discover authored view routes and collections, then `open_view`
with a saved view, `/content/<collection>/<record>`, or a collection route. An open result confirms
dispatch; inspect state and the visible UI before claiming rendering succeeded. Data writes use the
ordinary workspace Dreamteamer API/CLI. Existing data watchers refresh open views after changes.

## Local access

Only the gateway listens on TCP, bound to `127.0.0.1`. code-server listens on a private Unix socket
with mode 0600, inside a 0700 session directory. HTTP and WebSockets require a random session
credential; Host and Origin checks reject other sites. Login exchanges the URL secret for an
HttpOnly, SameSite=Strict cookie and redirects to a clean URL. The private control socket only starts
in a matching launcher workspace. Its caller has the same OS permissions as the editor.

The printed login URL is a credential; keep it out of shared logs. Same-user processes can access
the private session files and sockets. A hard kill can leave the `running` lock; confirm the process
is no longer running before removing that lock. Windows is not supported by this Unix-socket build.

## Verify

```sh
node --test modules/code/test/*.test.mjs
```

The native launcher passes its inherited CLI environment to code-server (`VSCODE_CLI=1`), avoiding a second login-shell environment probe during editor startup. Launch from a terminal with the PATH and tools you want the editor to inherit. Integrated terminals still use their configured shell.
