# @dreamteamer/docker-workspaces

`dt-docker` runs a dreamteamer workspace as a local Docker container — a code-server editor at a
loopback URL, over three named volumes — and moves a container's workspaces to another container as
one encrypted file. It needs Node 20+ and Docker (Docker Desktop, or a daemon on its socket), and
nothing else: no workspace, no engine, no dependency. It talks to the Docker Engine API directly over
its socket.

```bash
npm i -g @dreamteamer/docker-workspaces
dt-docker setup                                   # checks Docker, writes ~/.dreamteamer/.env defaults
dt-docker start container hq-dana --template hq   # pulls the image if needed, creates, starts, prints the URL
```

Installed in a workspace as well, it brings the `running-workspaces-in-containers` skill, so the
coding agent there knows these verbs:

```bash
npm install --save-dev @dreamteamer/docker-workspaces
```

## verbs

| verb | what it does |
|---|---|
| `dt-docker setup [--template <t>] [--json]` | check Docker, write the host defaults the `.env` lacks, list the templates present, pull one on request |
| `dt-docker start container <name> --template <t>` | create if absent, start, wait for the editor, print its URL. Idempotent; on an existing container the create-only flags (`--template`, `--mount`, `--repo`, `--name`, `--email`) are ignored — `rm` it (volumes kept) and start again to change them. `--workspace [<w>]` · `--repo <git url>` · `--mount <src>:<target>[:ro]` (repeatable) · `--rotate-token` · `--name` · `--email` · `--no-open` · `--json` |
| `dt-docker stop container <name>` | stop it; the volumes stay |
| `dt-docker open container <name>` | print (and open) its URL, token included · `--workspace [<w>]` · `--vscode` (Dev Containers attach URI) · `--no-open` · `--json` |
| `dt-docker list containers` · `list images` | the containers and templates dreamteamer made, as a table or `--json` |
| `dt-docker get container <name>` · `get image <ref>` | the detail as JSON; `--json` the raw inspect |
| `dt-docker rm container <name> [--force]` | remove it and its network; `--force` removes its three volumes too |
| `dt-docker add image --template <t>` · `rm image <ref> [--force]` | pull or remove a template's image |
| `dt-docker export container <name> --out <file>` | every workspace under `/workspaces` as one file · `--workspace <w>`… · `--no-encrypt` · `--with-secrets` · `--json` |
| `dt-docker import container <name> <file>` | unpack an export into a running container · `--workspace <w>`… · `--replace` · `--as <name>` · `--json` |
| `dt-docker help` · `dt-docker --version` | |

Every form refuses a flag it does not take. `rm` and `add image` take no `--json`; under `--json`
on every other form, stdout is exactly one JSON document and every human line goes to stderr.

**Configuration** — defaults, then `~/.dreamteamer/.env`, then any `DT_*` in the environment:
`DT_PORT_BASE` (8100; each container takes the lowest free port from here), `DT_BIND` (127.0.0.1),
`DT_REGISTRY` (`ghcr.io/dreamteamer`), `DT_TEMPLATE_TAG` (the image release this package pins —
`setup` never writes it, so upgrading the package moves it), `DT_IMAGE_<template>=<ref>` (pin one
template to any image), `DT_DOCKER_TIMEOUT` (30 s a request may sit idle before the verb fails; 0
disables), `DT_HEALTH_TIMEOUT` (environment only: 90 s `start` waits for the editor to answer; 0
skips the wait), `DT_PERSON_NAME` / `DT_PERSON_EMAIL` (the git identity a container gets; default: your
global git config). `DT_HOME` moves `~/.dreamteamer`; `DT_DOCKER_SOCKET` names the socket.

## what a container is

- **Name** `<name>`, labelled `dreamteamer.workspace=<name>`; the verbs refuse to touch a container
  without that label.
- **Image** `<DT_REGISTRY>/<template>:<DT_TEMPLATE_TAG>`, or `DT_IMAGE_<template>`. A template is an
  image carrying `dreamteamer.template`, `dreamteamer.ports` (the in-container editor port, 8080) and
  `dreamteamer.modules` labels.
- **Volumes** `dreamteamer-<name>-workspace` at `/workspaces/<name>`, `-home` at `/home/node`
  (logins, editor settings), `-files` at `/files`. Plain `rm` keeps them; `start` with the same name
  reattaches them.
- **Network** its own bridge, `dreamteamer-<name>`, and no other.
- **Port** the editor port published on `DT_BIND:<port>`, loopback by default.

## the isolation model, and its limits

What `dt-docker` does:

- It **binds to loopback** unless you change `DT_BIND`. Nothing on your network reaches the editor.
- It **injects no credential.** You log in inside the container once; the home volume keeps the
  login. `--repo` refuses a URL carrying credentials.
- It reads the image's **URL token** (hq 0.6+): the image's proxy refuses a request without it. The
  token is read by `docker exec` as root, lives only in this process, and is printed on the one line
  that carries the URL. It is never written to a file on the host, never in `--json`, and never a
  process argument (on macOS the URL reaches the browser over `osascript`'s stdin; elsewhere it is
  printed for you to open).
- It gives the container **NET_ADMIN and no other capability**, for the image's root entrypoint to
  apply its egress policy before it drops to an unprivileged user.
- It **restricts `--mount`**: targets only under `/workspaces`, `/home/node`, `/files` or `/mnt`,
  never at or under another mount (a symlink planted in a volume would otherwise redirect a mount
  point into the image), and no bind source inside another bind source, compared by file identity so
  a case-insensitive volume cannot spell its way around it.
- A create that Docker refuses removes the network and the volumes **that attempt** made, never ones
  that were there before.

What it does not do:

- **The per-container bridge is naming, not isolation.** On Docker Desktop, a container on
  one user-defined bridge reaches another by IP, and reaches another's published port through
  `host.docker.internal`. What keeps workspaces apart is the image's egress policy. An image that
  applies none is isolated by nothing here.
- **It trusts the image.** Templates are referenced by tag, not digest, and the image runs its root
  entrypoint with NET_ADMIN. Pull templates from a registry you trust, or pin `DT_IMAGE_<template>`.
- **Anyone who can use Docker on this machine can read every workspace and login** in these volumes
  (`docker exec`, `docker cp`) — Docker access is root on the host.
- **The tokened URL is a credential in your terminal.** Anyone who can read your terminal's scrollback
  can open the editor while the token is valid; `--rotate-token` replaces it.
- **A bind mount gives the container that host folder**, read-write unless `:ro`.

## moving workspaces: export and import

`export` writes every folder under `/workspaces` (or the ones `--workspace` names) as one file,
**encrypted by default** under a passphrase from `DT_EXPORT_PASSPHRASE` or a no-echo prompt — never a
flag. The home volume never travels, so no login does. The files volume (`/files`, where
`FILES_FOLDER` points) does not travel either: a record that points into it arrives with a dangling
path. `node_modules` and `.files` stay behind.

**Secrets stay behind by default, by name:** `.env` and `.env.*` (not `.example`, `.sample`,
`.template`), `.envrc`, `.npmrc`, `.netrc`, `.git-credentials`, `.pypirc`, `.docker/config.json`, at
any depth; each `.git/config` travels with its credential sections, auth headers and URL userinfo cut,
and one too large to rewrite (over 1 MiB) fails the export rather than travel whole. This is a list of
known names, not a scanner: a token written into any other file travels with it. `--with-secrets`
carries everything unchanged, and says so.

A symlink travels only if it is relative and stays inside its workspace; any other is skipped and
reported, and no link is ever followed. Hard links, devices and fifos are skipped too.

`import` authenticates and checks the whole file before writing anything, refuses a workspace that
already holds files unless `--replace`, and refuses a target on the container's own layer (it would
vanish with the container). It uploads into a staging folder inside the target and switches it in only
once the whole upload has landed; a failure before the switch leaves the target as it was, and a
failure during the switch (renames, not atomic) is reported with what the target holds and where the
complete import is — never as success. It runs no install: it prints the `npm ci` to run next.

The file format is a protocol any other implementation can read and write: [FORMAT.md](FORMAT.md).

## develop

```bash
npm install && npm test -- --only=docker-workspaces    # from the repository root; read the exit code
```

The tests drive the real `dt-docker` binary against a fake Docker Engine API (`test/helpers/fake-docker.js`,
a child process whose container filesystems are real folders and whose archive routes are the system
`tar`), with `DT_HOME` in a temp dir — no Docker, and nothing in your `~/.dreamteamer`.

Apache-2.0.
