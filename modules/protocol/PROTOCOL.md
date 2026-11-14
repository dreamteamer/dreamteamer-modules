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
| `404` | no such record; no such route (`unhandled request <METHOD> <path>`, or `unhandled field op …` under `/fields`). A collection name with a `/` sent unencoded matches no route, and the message goes on to name the collection meant: `… — unknown collection "lab" — did you mean "lab/samples"? a collection name containing "/" must be percent-encoded …` |
| `409` | the record is referenced by another, or already exists; a repository is blocked (an in-progress merge or rebase); the workspace would not re-open before a compile-gated write (`… did not load, so nothing was written`); a nav write while the old nav settings are not migrated |

Every error body is `{ "error": "<the engine's own sentence>" }`.

**Transport errors** — a network host's alone, never the contract's: `401` (no or a wrong token, or a token on a
prefix it does not open), `403` (a `Host` or `Origin` that is not the server's own, a cross-site request, a route
above the pane's level — `this pane is at <Level>: <METHOD> <pattern> needs <Level> …`), `415` (a write whose
`Content-Type` is not `application/json`).

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

## Routes

Every route carries a **level** — the least a pane must be at to be answered: `read` (every `GET`, and `PUT
/selection`, so a Read pane still reports its place), `edit` (record writes, the nav writes, `POST /queue`) and
`admin` (fields, rename, revert, commit, reload). A host that enforces levels (dt web) refuses a route above the
pane's level with `403` naming both — and a record write on a collection the engine reports internal or runtime
needs `admin` there; the editor answers every route at admin. `src/routes.js` carries the same `level` on each
entry.

### GET /info

Level: read

The workspace, as the host loaded it. `200 { name, host, compiled, modules: [...], ui: [...], user, stale,
collections: [name, ...] }` — `user` is the person's id slug from `git config user.name`, or `null`;
`stale` counts sources changed since the last compile.

### GET /schema

Level: read

Every compiled descriptor, ordered by `display.nav.order`. `200 [descriptor, ...]`.

### GET /presentation

Level: read

How to render each collection and field — the engine's `presentation()` — with one key the host adds to
each collection row: `sources`, every root the collection's records are read from (name, kind, repo, path,
installed, count, access). `200 { collections: [row, ...], … }`.

### GET /sources

Level: read

The stack of roots, top to bottom as `dt status` prints its `layers:` block. `200 { workspace, layers: [...],
modules: [...] }`, each `{ name, kind, repo, installed, via, access, collections: [{ collection, count }],
record? }` — `record` is the `repos/<id>` whose `url` matches the root's remote, when one does.

### GET /sources/access

Level: read

What each source's REMOTE grants, as the account the remote pushes as — computed live by the host's
remote-access provider and never stored. `200 { available, access: { <source name>: { state, level?, role?,
account?, tiedToPushKey?, remote?: { provider, host, owner, repo }, reason?, note? } } }`. `state` is one of
`ok · no-login · no-access · unknown · not-checked`. A host with no provider (dt web, dt serve, a test) answers
`available: false` and every source `not-checked` with the reason `remote access is not available in this host`.
Query: `fresh=1` drops what the provider holds in memory and asks again. Nothing a provider says reaches the
body unredacted: a token shape, or a credential value the host holds, is `[redacted]`.

### GET /sources/access/members

Level: read

Who has access to one source's remote, by the same provider. Query: `source=<source name>` (required; an
unknown name is 404 `no such source`). `200 { state, members: [{ name, kind, level, role?, via? }], account?,
remote?, reason? }` — `state` is one of `ok · partial · refused · no-login · no-access · unknown`; below the
provider's threshold the list is empty and `reason` says why. Without a provider: `state: unknown`, no members,
the same reason as `/sources/access`.

### GET /activity

Level: read

Git history as named entries. Query: `module` (one module's history; absent, every module merged), `limit`
(default 20, at most 500), `offset`, `settled` (how many scopes the asker already has). `200 { module,
scopes, offset, limit, entries: [{ sha, repo, source, author, date, subject, records: [{ collection, id,
title? }], files }], hasMore, pending: [repo, ...], failed: [repo, ...], settled }`. A page is answered before
its slowest repository is read: `pending` names those still being read, and the asker repeats the request
with `settled` until it is empty.

### GET /nav

Level: read

The navigation the editor draws as its tree, as data, so a host without a native tree draws the same
folders. `200 [NavNode, ...]`, `NavNode = { kind, key, label, icon?, route?, marks?, description?, tooltip?,
target?, notice?, children? }`, `kind` one of `workspace`, `folder`, `namespace`, `collection`, `view`,
`layers`, `layer`, `layer-group`, `layer-collection`, `layer-note`, `message`. Every `folder`, `namespace` and
`collection` node carries `target`, the NavTarget a host sends back in a `PATCH /nav` op; a key is never decoded.

The tree is the workspace's `nav.yaml` (see *The nav document*): its entries in order, then what it does not
place — rows by title, then namespaces — and the layers folder last. With no `nav.yaml` and none of the old
settings `dreamteamer.navGroups`, `dreamteamer.navOrder`, `dreamteamer.navHidden`, the tree is flat; with no
`nav.yaml` and one of them set, it is the tree those settings drew, until they are migrated. A `nav.yaml` that
cannot be read — not YAML, not a mapping, `tree` or `hidden` not a list, a folder that contains itself through a
YAML alias, a directory — draws the flat tree and puts the reason on the workspace node's `notice` — never a 500.
One that reads but holds entries of none of the four shapes (`null`, `{ folder: [1, 2] }`, a non-name in `hidden`)
draws the rest and names each skipped entry on the `notice`.
`dreamteamer.layersFolder` still names the layers folder. A record layer draws the same way from its own clone:
by the `nav.yaml` in `git_modules/<key>`, over the rows it holds (its folders and namespaces as `layer-group`
nodes, keyed `l/<key>/<the key it would have in that workspace>`), else as its own old settings drew it; an
unreadable one draws the layer flat with the reason on the `layer` node's `notice`. A list is narrowed to some sources by an ordinary filter
chip (`$source`), never by a host-wide scope.

### PUT /nav

Level: edit

Replace the whole `nav.yaml`. Body: a NavDoc `{ tree: [Entry, ...], hidden?: [name, ...] }`. The shape is
checked first — every entry a collection name, `{ collection, icon? }`, `{ folder, icon?, hidden?, items }` or
`{ namespace, icon?, hidden?, items? }`, a folder label not empty and not starting with `ns:` — then every
name: a collection or a namespace this workspace does not have is `400` naming each. Then the file is written
(the engine's writer when the loaded engine has one, else the protocol's own: atomic, the header comment, one
trailing newline) and the answer is `200 { doc }`. PUT is how a `nav.yaml` that cannot be read is replaced —
an empty directory named `nav.yaml` included; a directory that holds files is `400` naming it and is left alone.
`409` when there is no `nav.yaml` and an old nav setting is still set (below).

### PATCH /nav

Level: edit

One gesture. Body: one NavOp (see *The nav document*) — `move`, `new-folder`, `rename`, `dissolve`, `icon`,
`hide`, `show`. The host reads `nav.yaml` (none is an empty document), applies the op with the workspace's
collections in drawn order, writes the result as `PUT /nav` does and answers `200 { doc }`. Refused, with
nothing written: a malformed op, an unknown name, a folder path that resolves to nothing, a move into a row or
into the moved folder itself — `400` with the sentence naming the input; a `nav.yaml` that cannot be read, or
that holds entries of no valid shape — `400` naming the file (and each such entry), which is left byte for byte as
it was. With no `nav.yaml` and any of
`dreamteamer.navGroups`, `dreamteamer.navOrder`, `dreamteamer.navHidden` set (an empty list or object counts as
unset), both write routes answer `409 your nav settings are not in nav.yaml yet — run: npx -p
@dreamteamer/protocol@0.2 dt-nav migrate`, so the first write can never strand the settings.

### POST /fields/:collection

Level: admin

Add a field. Body `{ name, field }` with a whole field object, or `{ name, type, required?, many?, enum?, … }`
in the CLI's flag vocabulary. The source is written, compiled and committed; a compile refusal is `400` and
the source is restored. `200 { collection, field, file, value, commits?, … }` — `value` the field as written.

### PATCH /fields/:collection/:field

Level: admin

Edit a field. Body `{ field }` replaces it; flags change only what they name over the field as its source
declares it. `?module=<id>` selects which module's source the edit lands in. `200` as for add.

### DELETE /fields/:collection/:field

Level: admin

Remove a field — its values are cleared from every record. `?dry-run=true` answers the plan: the records
and descriptors it would touch. `200 { collection, field, … }`.

### POST /fields/:collection/:field/rename

Level: admin

Rename a field everywhere — every record, descriptor, view and binding that names it. Body `{ "to": "<new>" }`.
`?dry-run=true` answers the plan. `200 { collection, from, to, … }`.

### POST /fields/:collection/:field/rename-value

Level: admin

Rename one enum value in every record and every descriptor. Body `{ "from": "<old>", "to": "<new>" }`.
`?dry-run=true` answers the plan. `200 { … }`.

### GET /folder/:collection/*id

Level: read

The images a record's folder-template field points at. Query `field` (required). `200 { path, files:
[name, ...], reason }` — `path` the folder rendered for this machine (or `null`), `reason` why nothing is
listed (the field is empty, a variable is unset, the folder holds no images), or `null`. Never an error for
a missing folder: a reason the UI shows.

### GET /collections/:collection/values/:field

Level: read

The values a field actually uses, with counts, for filter vocabularies. Query `limit`. `200 { collection,
field, values: [{ value, count }], total, truncated }`. The computed keys (`$source`, `$module`,
`$last-modified-by`, `$created-by`) are answered the same way.

### GET /collections/:collection/records

Level: read

A page of rows. Query: `limit` (default 200), `offset`, `sort` (`field` or `-field`), `q` (substring over the
row), `filter` (JSON, the engine's operators `_eq` `_contains` `_in` `_and` … and one-hop relational
conditions), `field=value` or `filter[field]=value` (equality), `with-body=true` (include the body field), `notes=1` (each row also carries `$notes`, the lines
`GET /notes/:collection` answers for it).
`200 { records: [row, ...], total, sources: [{ name, kind, …, count }] }` — `count` per source counts the
rows the filter leaves before paging. Rows carry the computed keys above.

### POST /collections/:collection/records

Level: edit

Create a record. Body: the fields, plus `id` for an explicit id. Query `target=<source name>` chooses which
root a new record is written to (a layer that takes writes); absent, the collection's write root. A system
collection (`collections`, `modules`, `skills`, `ui-views`, …) is written through its schema operation
instead — see *System writes*. `200 { id, path, source }`; a refusal is `400` with the engine's sentence.

### GET /collections/:collection/records/*id

Level: read

One record. `200 { id, fields: { …, computed keys }, path }`.

### PATCH /collections/:collection/records/*id

Level: edit

Set fields. Body: the fields to change; echoed computed keys are ignored, never written. The record is
validated exactly as `dt set` validates it; a refusal is `400` and nothing is written. A record held by a
`git_modules` layer is written in that layer's clone. `200 { id }`.

### DELETE /collections/:collection/records/*id

Level: edit

Remove a record. Query `force=true` removes one that others reference. `409` when it is referenced and not
forced. `200 { id }`.

### POST /collections/:collection/files

Level: edit

Import a file AS a record of a binary collection. Body `{ id, from, force? }` — `from` a path the host can
read. `200 { id, path }`.

### PATCH /collections/:collection/position/*id

Level: edit

Manual order, on the collection's one `position` field. Body `{ top: true }`, `{ bottom: true }`,
`{ before: <id> }` or `{ after: <id> }`. One record is written. `400` when the collection has no position
field or the neighbour is not in the order. `200 { id }`.

### POST /collections/:collection/rename

Level: admin

Rename a record (or, on a system collection, the entity). Body `{ old, new }`. Every reference to it is
rewritten. A record held by a `git_modules` layer is refused: `… is held by layer <name> … a layer's record
is renamed in its own workspace, never from here. nothing was renamed.` `200` the engine's rename result.

### POST /collections/:collection/records-revert/*id

Level: admin

Restore a record to a commit. Body `{ hash }`. `200` the engine's revert result.

### GET /commands/:collection

Level: read

The commands bound to a collection and each record's state against them — what `dt next` answers. Query
`ids=<id>,<id>`. `200 { collection, ids, commands: [{ binding, command, name, description, argument-hint,
scope, invocation, states?, eligible?, done? }, ...] }` — `states` maps each id to `available`, `done` or not
eligible.

### GET /notes/:collection

Level: read

What the workspace's installed extensions say about records — the lines `dt next` prints under its
commands (a session holding a record, say). Query `ids=<id>,<id>`. `200 { notes: [{ id, text, refs, … }] }`,
each reference in a line marked by whether this workspace holds it. `200 { notes: [] }` on an engine that
predates contributed notes. The answer also says where the host reads sessions from — `sessionsFrom`: `null` when the
workspace has no `sessions` collection, `{ unavailable }` with the reason when its records cannot be read, else
`{ roots: [<source name>, …] }` — which a record page names beside its sessions.

### POST /commit

Level: admin

Publish pending record writes — `dt commit`. Body `{ only?: ["<collection>/<id>" or "<collection>", ...],
message?, dryRun? }`. `200 [result, ...]` exactly as `dt commit --json` prints them; `{dryRun: true}` is the
pending count a header shows. A blocked repository makes it `409` on a network host.

### GET /history/:collection/*id

Level: read

The record's commits. `200 [{ hash, date, author, subject }, ...]`.

### GET /history-diff/:collection/*id

Level: read

One commit's diff of the record. Query `hash` (default `HEAD`). `200 { … }` the engine's `historyDiff`.

### POST /reload

Level: admin

Rebuild the host's store now (a compile elsewhere is picked up on the next request anyway). `200 { ok: true }`.

### GET /host

Level: read

What the page needs from its host before it draws: `200 { level, chat, workspace: { id?, name }, raisedAt?,
filesBase?, framesBase?, fileBases?, varRoots?, moduleGrants?, moduleGrantProblem? }`. `level` is the pane's
(`read`, `edit` or `admin`); `chat` is `true` only when a chat of this workspace can read the page's place and
queue (dt web: a prompt hook ran in the last 24 hours); `workspace.id` is present on a host that can switch
workspaces. A browser host answers here, behind its cookie, what it no longer puts in the page: the record-file
base (`filesBase`, `fileBases`), the frame base (`framesBase`), `varRoots` (`[{ name, path, uri }]`) and the
module grants. No value is the workspace root's path. The editor answers `{ level: 'admin', chat: false,
workspace: { name } }`.

### PUT /selection

Level: read

The page's place and ticked rows, reported on every navigation and selection change. Body `{ view, refs }` and
nothing else. `view` is exactly one of `{ collection }` (a list), `{ collection, id }` (a record), `{ uiView }` (a
compiled ui-view's id) or `{ other: true }` (a page none of those name — home, a module app, settings — which
clears the place); the collection, the record and the ui-view must exist. `refs` is at most 50
`<collection>/<id>` references of existing records (a namespaced collection splits at its declared prefix). The
host renders the place itself — `tasks · List`, `rnd/change-requests/cr-x`, `<ui-view id> · View`, or `null` —
and answers `200 { view, refs, place }`. Anything else is `400` naming the first problem (`a view is {
collection }, { collection, id }, { uiView } or { other: true }`, `more than 50 refs`, `no record <ref>`).

### GET /selection

Level: read

The last place and selection put. `200 { view, refs, place, at }` — `view` and `place` `null`, `refs` empty, until
the page reports.

### POST /queue

Level: edit

Ask the chat to run a command on records. Body `{ command, refs }`: `refs` 1 to 50 existing records of ONE
collection; `command` a command `GET /commands/<collection>` lists for them with an `invocation`. `200 { item }`,
`item = { id, command, refs, invocation, state: 'waiting', queuedAt }` — `invocation` is the ready-to-paste `/name
<ref> …`. A command not available for those records is `400 <command> is not available for these records`.

### GET /queue

Level: read

The queued items, newest first, at most 20: `200 { items: [item, ...] }`. An item is `waiting` until a chat's
hook delivers it (`delivered`, with `deliveredAt`) and `expired` one hour after `queuedAt`.

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

## The nav document

`nav.yaml` at the workspace root is the left nav, arranged by a person and tracked like any other file. Every host
reads and writes it through one grammar (`src/nav-doc.js`, typed in `nav-doc.d.ts`; the engine's own reader and
writer from 0.49):

```yaml
# The left nav of this workspace. Drag and drop writes this file; so may you.
tree:
  - folder: Work                 # a folder: a label, an optional icon, its items; folders nest
    icon: rocket
    items: [tasks, projects, { folder: Plans, items: [deliverables, risks] }]
  - { collection: contacts, icon: person }   # a row with its icon overridden; a bare name is a row
  - namespace: rnd               # a namespace folder: its label is its module's title
    items: [rnd/change-requests, { folder: Product, items: [rnd/user-stories] }]
  - { folder: Old, hidden: true, items: [metrics] }
hidden: [teams]                  # rows (or whole namespaces) not drawn
```

What the document does not place still draws: an unplaced row trails its parent (the top level, or its namespace's
folder) by title, an unplaced namespace draws as a folder after the top level's rows, and a name listed twice draws
at its first place. A name that resolves to nothing is skipped (`dt check` warns about it).

**NavTarget** — what a host sends back to address a node, read from the node's `target` and never decoded from its
key: `{ name }` is a collection or a namespace exactly as `nav.yaml` writes it; `{ folder: [labels] }` is the label
path from the top level, a namespace entry being the element `ns:<name>` (`{ folder: ['ns:rnd', 'Product'] }`).
Labels match exactly, at their first occurrence at each level; the path is an array, never a joined string.

**NavOp** — the body of `PATCH /nav`, one gesture:

| op | body | does | refused (400) when |
|---|---|---|---|
| `move` | `{ target, into?, after?, position?: top \| bottom }` | moves the target right after `after`, or to the top or bottom of `into` (a folder, or `{ name }` of a namespace), or of the top level | the target or anchor is unknown; `into` is a row; a folder into itself or its descendant; both `into` and `after`; `position` beside `after` |
| `new-folder` | `{ label, into? }` | appends an empty folder | the label is empty or starts with `ns:` |
| `rename` | `{ target: { folder }, label }` | relabels a folder | the path resolves to nothing, or to a namespace; the label as above |
| `dissolve` | `{ target: { folder } }` | puts a folder's items where it stood | as rename |
| `icon` | `{ target, icon: name \| null }` | sets or clears an icon | the icon is neither a name nor `null` |
| `hide` | `{ target }` | a row leaves its place in the tree and goes to `hidden`; a folder, and a namespace the document places, get `hidden: true` and keep their arrangement; an unplaced namespace goes to `hidden` | the target is unknown |
| `show` | `{ target }` | the reverse: a row hidden and placed nowhere goes back at the end of its home level — its namespace's entry, or the top level (the document does not record the folder it left); `hidden: true` is cleared | the target is unknown |

A name the document does not place but the workspace has is a valid target and a valid anchor: `move` places it,
`icon` places it at the end of its parent with the icon, `hide` adds it to `hidden`. Either way a name is placed
once: in the tree, or in `hidden`. Placing one never moves anything
else on screen — an anchor among unplaced rows first places the rows of its parent that draw before it, in drawn
order, and an unplaced namespace a gesture reaches into (`into` it, or a row inside it as target or anchor) is placed
the same way, after its level's unplaced rows and the namespaces drawn before it. Move up is `move` with `after` the sibling two above (or `into` the parent with `position: top` for the second
row); Move down is `after` the next sibling.

**The old settings.** Before `nav.yaml`, `dreamteamer.navGroups`, `dreamteamer.navOrder` and `dreamteamer.navHidden`
in `.vscode/settings.json` arranged the nav. While they are set and there is no `nav.yaml`, `GET /nav` draws the tree
they drew and both write routes answer `409`. They are migrated once — by the editor on activation, by `dt web` on
its first `GET /nav`, or by hand with `npx -p @dreamteamer/protocol@0.2 dt-nav migrate` — into a `nav.yaml` that draws
the same folders, rows and order (a hidden folder kept with `hidden: true`), after which they are no longer read. On
an engine that merges module nav fragments (0.49) the migration applies them after; they place only what the
document does not.

## Notifications and gestures

Messages between the app and its host besides the requests above. In VS Code they are `postMessage`
objects; over HTTP the host-to-app ones arrive on `GET /api/events` (server-sent events, one JSON object per
`data:` line) and the app-to-host ones are performed by the browser host (see *Hosts*).

Host to app:

| type | payload | meaning |
|---|---|---|
| `dt:invalidate` | `{ scope: "data" \| "schema", pages?: true }` | records changed (`data`), or the compiled runtime changed (`schema`): refetch what is drawn. With `pages`, the open page re-fetches its records too, after the schema settles: a browser host sets it on every event (the page is the only view there), an editor host only from its refresh button (its native tree already shows the change) |
| `dt:navigate` | `{ route }` | go to this route — also pushed by `dt web show` |
| `dt:select` | `{ refs: string[] }` | tick these rows on the drawn list (`[]` clears) — pushed by `dt web select` |
| `dt:host` | `{}` | what `GET /host` answers changed (the level, `chat`, a new files key): refetch it |
| `dt:queue` | `{}` | an item of `GET /queue` changed state: refetch it |
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

Set on `window` before the app's bundle runs. A browser host (dt web) puts only `__DT_HOST__` in the page — its
shell is served without a cookie and holds no workspace data — and delivers the file bases, the variable roots,
the files and frames bases and the module grants through `GET /host`, behind the session cookie. The editor sets
them in the page as before.

| global | value |
|---|---|
| `__DT_UI_BASE__` | the URL of the workspace's `.dreamteamer/ui/` — module app bundles are imported from it |
| `__DT_FILE_BASES__` | the URLs under which file-record bytes are served (dt web: `GET /host`'s `fileBases`) |
| `__DT_VAR_ROOTS__` | `[{ name, path, uri }]` — each declared variable that renders to a folder, and the URL its files are served at (dt web: `GET /host`'s `varRoots`) |
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
session cookie authenticates it from the page's own origin, and a write sends `Content-Type: application/json`); in VS
Code the app teaches `fetch` to answer `/api/…` from the host.

## Module apps

A module's `ui/app.js` never runs in the app's page. The host loads each module surface in a sandboxed frame
(`sandbox="allow-scripts"`, never `allow-same-origin`) built by `frame-document.js` — one document, the bundle
embedded as data and imported as a `blob:`, a frame policy with no host, hash or nonce — and answers the frame's
`/api` calls itself, through `gate()` and `reshape()` under the module's scope. A frame holds no token, cookie
or nonce, and makes no network request.

**Boot globals added** (set by the editor on the app's page; dt web answers them from `GET /host`, behind the cookie):

| global | value |
|---|---|
| `__DT_HOST__.moduleFrames` | `'url'` (dt web: `/_frames/<key>/…`, under `GET /host`'s `framesBase`, serves the frame document) or `'srcdoc'` (VS Code) |
| `__DT_MODULE_GRANTS__` | `{ "<module>": { reads: [collection], writes: [collection] } }` — read by the host from the workspace root's own `.vscode/settings.json` (`dreamteamer.moduleApps`) and nowhere else (dt web: `GET /host`'s `moduleGrants`) |

**Frame messages** — every message is `{ dt: 1, id, op, … }`; the host accepts one only from a frame it
registered (`event.source`), and drops a frame whose document is replaced. Host → frame: `init`, `props`, `state`,
`route`, `theme`, `invalidate`, `reply`, `render-cells`, `paste`. Frame → host: `registered`, `request`, `emit`,
`intent`, `navigate`, `resize`, `key`, `cells`, `error`.

**The routes a module app may call** (`kind: 'module'`), each through `gate()`:

| route | when |
|---|---|
| `GET /info`, `GET /schema`, `GET /presentation` | always — cut to the module's read scope; `/info` answers `user: null` |
| `GET /collections/:collection/records`, `GET /collections/:collection/records/*id`, `GET /collections/:collection/values/:field` | the collection is its own, or granted and referenced by its own; filters without relational conditions, without `_regex`, bounded |
| `GET /commands/:collection` | its own collection |
| `POST /collections/:collection/records`, `PATCH /collections/:collection/records/*id`, `DELETE /collections/:collection/records/*id`, `PATCH /collections/:collection/position/*id` | its own collection, granted writes, no query of its own; a create lands in the module's own root; an update, delete or move only of a record its own root holds |

Every other route answers `403`; a path that is no route answers `404`. A refusal is `{ error }` with a
sentence naming the collection or route, the module or root that owns it, and what this module app may reach.
