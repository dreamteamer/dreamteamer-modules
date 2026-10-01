---
name: running-workspaces-in-containers
description: Use when a dreamteamer workspace should run in a local Docker container, or a container already holds one — starting, stopping, opening or removing a workspace container, listing templates or containers, checking Docker is ready, or moving a container's workspaces to another container or machine as one encrypted file (dt-docker export / import).
---

# running workspaces in containers

`dt-docker` runs a dreamteamer workspace as a local Docker container: a code-server editor at a
loopback URL, over three named volumes. It is a global command, not a `dt` verb, because its main
jobs happen before a workspace exists. **Core principle:** the container is disposable and the
volumes are not — `rm` without `--force` keeps every workspace and login, and `start` with the same
name reattaches them.

## when to use

someone asks to run, open or stop a workspace in Docker; to try a template; to move workspaces
between containers; or a `dt start` / `dt export` typed in a workspace failed saying it left core.

**not for:** the records inside the workspace (`using-dreamteamer`), or the hosted service.

## the verbs

```bash
dt-docker setup                                   # is Docker reachable; writes ~/.dreamteamer/.env defaults
dt-docker start container <name> --template hq    # create if absent, start, print the URL (token included)
dt-docker open container <name>                   # print the URL again · --vscode for a Dev Containers URI
dt-docker stop container <name>                   # stop; volumes stay
dt-docker list containers                         # · list images (the templates present)
dt-docker rm container <name>                     # remove; volumes stay · --force removes them too
dt-docker export container <name> --out <file>    # every workspace as one encrypted file
dt-docker import container <name> <file>          # into a running container · --replace · --as <w>
```

Every verb takes `--json` (one document on stdout, human lines on stderr) and refuses a flag it does
not know. `dt-docker help` has every form.

## rules that matter

- **The URL carries a token.** It is printed once, on the line with the URL. Never paste it into a
  record, a commit or a message; `--rotate-token` replaces it.
- **Never pass a passphrase as a flag.** `export` reads `DT_EXPORT_PASSPHRASE` or prompts without echo.
- **Secrets stay behind on export by default** (`.env`, `.npmrc`, `.git-credentials` and the other
  known names). `--with-secrets` carries them; say so if you use it. A token in any other file travels.
- **`--force` on `rm container` deletes the volumes**, and with them every workspace and login in that
  container. Confirm with the person first.
- **`import` runs no install.** It prints the `npm ci` to run inside the container next.
- **A per-container bridge is not isolation.** What keeps containers apart is the image's egress
  policy. Do not describe a container as sandboxed beyond that.

## configuration

Defaults, then `~/.dreamteamer/.env`, then `DT_*` in the environment: `DT_PORT_BASE` (8100),
`DT_BIND` (127.0.0.1), `DT_REGISTRY` (`ghcr.io/dreamteamer`), `DT_TEMPLATE_TAG`, `DT_IMAGE_<template>`,
`DT_DOCKER_TIMEOUT`, `DT_PERSON_NAME` / `DT_PERSON_EMAIL`, `DT_HOME`, `DT_DOCKER_SOCKET`.
