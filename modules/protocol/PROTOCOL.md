# The dreamteamer host protocol

The dreamteamer UI is one app that asks a HOST for everything it draws and writes. Three hosts answer it:
the VS Code extension (in-process, over the webview's `postMessage`), `dt serve` and `dt web` (over HTTP at
`/api`). This document is what every host answers. `src/routes.js` is the same list as data, and the
contract suite (`lib/contract/`) runs it against any host: a host that answers a route differently fails
there, not in a user's window.

The UI's components speak an older internal wire (`/items`, `/relations`, `/revisions`, `/utils/infer`)
that the UI's own adapter translates into the routes below inside the page. That wire is not part of this
protocol, and no host implements it.

## Paths and parameters

A route's pattern is everything after `/api`. `:name` is ONE path segment, percent-decoded: a namespaced
collection (`lab/samples`) is sent ENCODED, `lab%2Fsamples`. A collection sent unencoded splits into extra
segments; a host answers `404` naming the collection the caller meant. `*name` is greedy and always last:
record ids are paths (`2026/11/northwind-kickoff`) and are sent unencoded. The query string is
`application/x-www-form-urlencoded`; bodies are JSON.

## Errors

**Handler errors** — the same on every host, and asserted by the contract:

| status | when |
|---|---|
| `400` | validation refused the write; a compile refused a schema write (the source is restored); a malformed request |
| `404` | no such record; no such route (`unhandled request <METHOD> <path>`, or `unhandled field op …` under `/fields`) |
| `409` | the record is referenced by another, or already exists; a repository is blocked (an in-progress merge or rebase); the workspace would not re-open before a compile-gated write (`… did not load, so nothing was written`) |

Every error body is `{ "error": "<the engine's own sentence>" }`.

**Transport errors** — a network host's alone, never the contract's: `401` (no or a wrong token), `403`
(a `Host` or `Origin` that is not the server's own), `415` (a write body that is not JSON).

## Dry run

A write sent with `?dry-run=true` changes no file and makes no commit on any host. Where the handler has a
PLANNER it answers the engine's plan: the module remove, the collection move (`PATCH
/collections/collections/records/<name>` with `{module}`), the ui-view move (`PATCH
/collections/ui-views/records/<id>` with `{module}`), the field rename, the enum-value rename, the field
remove, and the commit (`{"dryRun": true}` in the body). Every other write answers
`200 { "plan": null, "dry-run": "unsupported" }` and is not performed. A caller plans destructive gestures
this way, then asks, then sends the write without `dry-run`.

## Computed keys on records

A row (`GET …/records`) and a record (`GET …/records/*id`, under `fields`) carry the engine's fields plus
keys the host computes, each prefixed `$` (or named as below) so a write never persists them:

| key | meaning |
|---|---|
| `id` | the record id (wins over a field named `id`) |
| `created` | the record's `created`, or the engine's derivation (the id's date, or the first commit) |
| `last-modified`, `last_modified` | the last commit's date touching the record's file |
| `$last-modified-by`, `$last-commit-message`, `$created-by` | the last commit's author and subject; the first commit's author |
| `$source`, `$source-kind` | the NAME of the root the record was read from, and its kind (`own`, `layer`, `module`) |
| `$module` | the module that owns the record's collection or root |
| `$repo`, `$dirty`, `$ahead` | the repository holding the file (workspace-relative, `.` the workspace), whether the file has uncommitted changes, and how many commits that repository holds that no remote has |
| `$duplicates` | other roots holding the same id (the first root wins) |
| `$stubs` | roots holding a `stub: true` record of this id that this row shadows |

## Routes

### GET /info

The workspace, as the host loaded it. `200 { name, host, compiled, modules: [...], ui: [...], user, stale,
collections: [name, ...] }` — `user` is the operator's id slug from `git config user.name`, or `null`;
`stale` counts sources changed since the last compile.

### GET /schema

Every compiled descriptor, ordered by `display.nav.order`. `200 [descriptor, ...]`.

### GET /presentation

How to render each collection and field — the engine's `presentation()` — with one key the host adds to
each collection row: `sources`, every root the collection's records are read from (name, kind, repo, path,
installed, count, access), narrowed by the host's scope (`PUT /scope`). `200 { collections: [row, ...], … }`.

### GET /sources

The stack of roots, top to bottom as `dt status` prints its `layers:` block. `200 { workspace, layers: [...],
modules: [...] }`, each `{ name, kind, repo, installed, via, access, collections: [{ collection, count }],
record? }` — `record` is the `repos/<id>` whose `url` matches the root's remote, when one does.

### GET /activity

Git history as named entries. Query: `module` (one module's history; absent, every module merged), `limit`
(default 20, at most 500), `offset`, `settled` (how many scopes the asker already has). `200 { module,
scopes, offset, limit, entries: [{ sha, repo, source, author, date, subject, records: [{ collection, id,
title? }], files }], hasMore, pending: [repo, ...], failed: [repo, ...], settled }`. A page is answered before
its slowest repository is read: `pending` names those still being read, and the asker repeats the request
with `settled` until it is empty.

### GET /nav

The navigation the editor draws as its tree, as data, so a host without a native tree draws the same
folders. `200 [NavNode, ...]`, `NavNode = { kind, key, label, icon?, route?, marks?, count?, tooltip?,
children? }`, `kind` one of `workspace`, `page`, `folder`, `collection`, `view`, `layers`, `layer`,
`layer-group`, `layer-collection`, `note`. It honours the workspace's `dreamteamer.navGroups`,
`dreamteamer.navOrder`, `dreamteamer.navHidden` and `dreamteamer.layersFolder` settings and the host's scope.

### PUT /scope

Sets the host's source scope. Body `{ "scope": "all" | "private" | "shared" }`. `200 { scope }`. Every list
and every collection row's `sources` is narrowed by it until it is set again.

### POST /fields/:collection

Add a field. Body `{ name, field }` with a whole field object, or `{ name, type, required?, many?, enum?, … }`
in the CLI's flag vocabulary. The source is written, compiled and committed; a compile refusal is `400` and
the source is restored. `200 { collection, field, file, value, commits?, … }` — `value` the field as written.

### PATCH /fields/:collection/:field

Edit a field. Body `{ field }` replaces it; flags change only what they name over the field as its source
declares it. `?module=<id>` selects which module's source the edit lands in. `200` as for add.

### DELETE /fields/:collection/:field

Remove a field — its values are cleared from every record. `?dry-run=true` answers the plan: the records
and descriptors it would touch. `200 { collection, field, … }`.

### POST /fields/:collection/:field/rename

Rename a field everywhere — every record, descriptor, view and binding that names it. Body `{ "to": "<new>" }`.
`?dry-run=true` answers the plan. `200 { collection, from, to, … }`.

### POST /fields/:collection/:field/rename-value

Rename one enum value in every record and every descriptor. Body `{ "from": "<old>", "to": "<new>" }`.
`?dry-run=true` answers the plan. `200 { … }`.

### GET /folder/:collection/*id

The images a record's folder-template field points at. Query `field` (required). `200 { path, files:
[name, ...], reason }` — `path` the folder rendered for this machine (or `null`), `reason` why nothing is
listed (the field is empty, a variable is unset, the folder holds no images), or `null`. Never an error for
a missing folder: a reason the UI shows.

### GET /collections/:collection/values/:field

The values a field actually uses, with counts, for filter vocabularies. Query `limit`. `200 { collection,
field, values: [{ value, count }], total, truncated }`. The computed keys (`$source`, `$module`,
`$last-modified-by`, `$created-by`) are answered the same way.

### GET /collections/:collection/records

A page of rows. Query: `limit` (default 200), `offset`, `sort` (`field` or `-field`), `q` (substring over the
row), `filter` (JSON, the engine's operators `_eq` `_contains` `_in` `_and` … and one-hop relational
conditions), `field=value` or `filter[field]=value` (equality), `with-body=true` (include the body field).
`200 { records: [row, ...], total, sources: [{ name, kind, …, count }] }` — `count` per source counts the
rows the filter leaves before paging. Rows carry the computed keys above.

### POST /collections/:collection/records

Create a record. Body: the fields, plus `id` for an explicit id. Query `target=<source name>` chooses which
root a new record is written to (a layer that takes writes); absent, the collection's write root. A system
collection (`collections`, `modules`, `skills`, `ui-views`, …) is written through its schema operation
instead — see *System writes*. `200 { id, path, source }`; a refusal is `400` with the engine's sentence.

### GET /collections/:collection/records/*id

One record. `200 { id, fields: { …, computed keys }, path }`.

### PATCH /collections/:collection/records/*id

Set fields. Body: the fields to change; echoed computed keys are ignored, never written. The record is
validated exactly as `dt set` validates it; a refusal is `400` and nothing is written. A record held by a
`git_modules` layer is written in that layer's clone. `200 { id }`.

### DELETE /collections/:collection/records/*id

Remove a record. Query `force=true` removes one that others reference. `409` when it is referenced and not
forced. `200 { id }`.

### POST /collections/:collection/files

Import a file AS a record of a binary collection. Body `{ id, from, force? }` — `from` a path the host can
read. `200 { id, path }`.

### PATCH /collections/:collection/position/*id

Manual order, on the collection's one `position` field. Body `{ top: true }`, `{ bottom: true }`,
`{ before: <id> }` or `{ after: <id> }`. One record is written. `400` when the collection has no position
field or the neighbour is not in the order. `200 { id }`.

### POST /collections/:collection/rename

Rename a record (or, on a system collection, the entity). Body `{ old, new }`. Every reference to it is
rewritten. A record held by a `git_modules` layer is refused: `… is held by layer <name> … a layer's record
is renamed in its own workspace, never from here. nothing was renamed.` `200` the engine's rename result.

### POST /collections/:collection/records-revert/*id

Restore a record to a commit. Body `{ hash }`. `200` the engine's revert result.

### GET /commands/:collection

The commands bound to a collection and each record's state against them — what `dt next` answers. Query
`ids=<id>,<id>`. `200 { collection, ids, commands: [{ binding, command, name, description, argument-hint,
scope, invocation, states?, eligible?, done? }, ...] }` — `states` maps each id to `available`, `done` or not
eligible.

### POST /commit

Publish pending record writes — `dt commit`. Body `{ only?: ["<collection>/<id>" or "<collection>", ...],
message?, dryRun? }`. `200 [result, ...]` exactly as `dt commit --json` prints them; `{dryRun: true}` is the
pending count a header shows. A blocked repository makes it `409` on a network host.

### GET /history/:collection/*id

The record's commits. `200 [{ hash, date, author, subject }, ...]`.

### GET /history-diff/:collection/*id

One commit's diff of the record. Query `hash` (default `HEAD`). `200 { … }` the engine's `historyDiff`.

### POST /reload

Rebuild the host's store now (a compile elsewhere is picked up on the next request anyway). `200 { ok: true }`.

## System writes

A collection whose records ARE the schema — `collections`, `modules`, `skills`, `agents`, `commands`,
`command-bindings`, `ui-views`, `mixins` — is written through the same record routes, and the host
dispatches to the engine's schema operation, which writes the SOURCE, compiles and commits:

| verb | route | notes |
|---|---|---|
| add | `POST /collections/<kind>/records` | `?module=<id>` chooses the module a new collection or skill lands in |
| set | `PATCH /collections/<kind>/records/<name>` | on `collections`, a body `{module: "<id>"}` is the MOVE (plannable) and `?module=` selects which source an edit lands in |
| rename | `POST /collections/<kind>/rename` | body `{ old, new }` |
| rm | `DELETE /collections/<kind>/records/<name>` | on `modules`, plannable; `force=true` |

Before every compile-gated write the host re-opens the workspace, so a write after the declared extensions
changed compiles against what is declared now; a workspace that will not open is `409` and nothing is
written. A successful system write's result carries `commits`, including a commit in another repository
for a module that lives in a `git_modules` clone.

## Notifications and gestures

Messages between the app and its host besides the requests above. In VS Code they are `postMessage`
objects; over HTTP the host-to-app ones arrive on `GET /api/events` (server-sent events, one JSON object per
`data:` line) and the app-to-host ones are performed by the browser host (see *Hosts*).

Host to app:

| type | payload | meaning |
|---|---|---|
| `dt:invalidate` | `{ scope: "data" \| "schema" }` | records changed (`data`), or the compiled runtime changed (`schema`): refetch what is drawn |
| `dt:navigate` | `{ route }` | go to this route |
| `dt:tab` | `{ route, pinned, active }` | the editor tab's identity (VS Code only) |
| `dt:rpc-reply` | `{ id, ok, data?, error?, status? }` | the answer to a `dt:rpc` (VS Code only; HTTP answers the request itself) |

App to host:

| type | payload | meaning |
|---|---|---|
| `dt:rpc` | `{ id, method, path, body? }` | one request of the routes above (VS Code only) |
| `dt:mounted` | — | the app is mounted and wants the route it should show |
| `dt:ready` | — | the app finished its first render |
| `dt:route` | `{ route }` | the app navigated itself |
| `dt:open` | `{ route }` | open this route in a new tab |
| `dt:command` | `{ command, arg? }` | run an editor command — only commands prefixed `dreamteamer.` |
| `dt:open-file` | `{ path }` | open a workspace-relative `.html` file — a plain relative path, inside the workspace, existing |

## Boot globals

Set on `window` before the app's bundle runs:

| global | value |
|---|---|
| `__DT_UI_BASE__` | the URL of the workspace's `.dreamteamer/ui/` — module app bundles are imported from it |
| `__DT_FILE_BASES__` | the URLs under which file-record bytes are served |
| `__DT_VAR_ROOTS__` | `[{ name, path, uri }]` — each declared variable that renders to a folder, and the URL its files are served at |
| `__DT_HOST__` | the host's capabilities (below); absent means the VS Code host |

## Hosts

`__DT_HOST__ = { nav, commands, openFile, tabs, history }`:

| capability | VS Code extension | dt web |
|---|---|---|
| `nav` | `native` — the editor's tree is the nav | `app` — the app draws `GET /nav` |
| `commands` | `true` | `false` — buttons that fire editor commands are not drawn |
| `openFile` | `external` | `tab` |
| `tabs` | `true` | `false` |
| `history` | `memory` | `hash` |

`dt serve` answers the routes alone and serves no app.

A workspace module's prebuilt bundle may call `fetch('/api/…')` directly: over HTTP the route is real (the
session cookie authenticates it, and a same-origin JSON body is accepted whatever its `Content-Type`); in VS
Code the app teaches `fetch` to answer `/api/…` from the host.
