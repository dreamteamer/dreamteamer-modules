# @dreamteamer/http

`dt serve` — the dreamteamer REST api at `/api`, over the same validating store the CLI uses. A
record written over HTTP is validated, serialized and refused exactly as `dt add` / `dt set` would;
a schema write compiles through the same workspace handle, so every installed extension judges it.

## install

In a dreamteamer workspace (engine `^0.31.0`):

```bash
npm install --save-dev @dreamteamer/http
dt serve                       # http://127.0.0.1:8080/api
dt serve --port 3000           # --port 0 picks a free port
dt serve --host 0.0.0.0 --token <secret>   # beyond loopback needs a token
```

The engine loads the package because it is a direct dependency that declares
`"dreamteamer": { "extension": … }`; `dt status` lists it and `dt help` shows its usage. The verb
runs until the process is stopped. Unknown flags are refused, and so is a `--host` beyond loopback
without `--token`.

Mounting it in your own server instead:

```js
import * as dt from 'dreamteamer';
import { bind, createApp } from '@dreamteamer/http';
bind(dt);
const ws = await dt.openWorkspace(root);   // the handle carries the loaded extensions
myServer.use(createApp(ws));               // createApp never listens; serve(ws, { port, host, token }) does
```

## routes

All under `/api`. Bodies and responses are JSON. **A namespaced collection name carries a slash and
must be percent-encoded** (`/collections/lab%2Fsamples/records`); **record ids are paths and are
not encoded** (`/records/2026-09-01/alpha`), which is why every `*id` is the last segment.

| method | path | does |
|---|---|---|
| GET | `/info` | `{name, host, compiled, modules, ui, stale, collections}` |
| GET | `/schema` | every descriptor, by `order` |
| GET | `/presentation` | how to render each collection and field |
| GET | `/commands/:name?ids=a,b` | bound commands and per-record state (`dt next`) |
| GET | `/collections/:name/records` | `{records, total}` · `?limit` (200) `?offset` `?sort` `?q` `?filter=<json>` `?field=value` `?filter[field]=value` `?with-body=true` |
| GET | `/collections/:name/records/*id` | `{id, fields, path}`; `fields` adds `last-modified`, `$last-modified-by`, `$last-commit-message` |
| POST | `/collections/:name/records` | create → `201 {id, path}`; an `id` in the body is the explicit id |
| PATCH | `/collections/:name/records/*id` | set fields → `{id}`; echoed synthetic keys are ignored |
| DELETE | `/collections/:name/records/*id` | remove → `{id}` · `?force=true` |
| PATCH | `/collections/:name/position/*id` | manual order: `{top}` `{bottom}` `{before: id}` `{after: id}` |
| POST | `/collections/:name/rename` | `{old, new}` |
| POST | `/collections/:name/records-revert/*id` | `{hash}` |
| GET | `/collections/:name/values/:field` | the values a field uses · `?limit` |
| GET | `/history/:name/*id` | the record's commits |
| GET | `/history-diff/:name/*id` | one commit's diff · `?hash` (HEAD) |
| POST | `/collections/:name/fields` | add a field (`{name, type, …}` flags, or `{name, prop}`) |
| PATCH | `/collections/:name/fields/:field` | edit a field |
| PATCH | `/collections/:name/fields/:field/name` | rename a field everywhere · `{to}` |
| DELETE | `/collections/:name/fields/:field` | remove a field |
| POST | `/commit` | publish pending writes (`dt commit`) · `{only: ["<c>/<id>" or "<c>", …], message?, dryRun?}`, `only` required and non-empty → the `dt commit --json` results; `409` when a repo is blocked |
| POST | `/reload` | rebuild the store now |

The **system collections** (`collections`, `modules`, `skills`, `ui-views`, …) are written through the
same record routes and dispatched to their schema operation — `POST /collections/collections/records`
creates a collection, `PATCH /collections/collections/records/<name>` with `{module}` moves one,
`?module=<id>` selects which module's source an edit lands in.

**Requests.** The `Host` header names the server's own address and port (`localhost` and `127.0.0.1`
too, on loopback); an `Origin`, when sent, is `http://` plus that same host and port. Anything else
is `403`. A server started with a token answers `401` to a request without
`Authorization: Bearer <token>`. Every `POST` and `PATCH`, and any `DELETE` with a body, is
`Content-Type: application/json`, or `415`.

**Dry runs.** `?dry-run` is `true` or `false`; any other value, a bare `?dry-run`, or a repeat is `400`
on every write. `?dry-run=true` on `DELETE modules/…`, a `PATCH collections/…` move, a field rename
and `POST /commit` returns the plan and writes nothing. On every other write it is
`400 {error, "dry-run": "unsupported"}` and the operation is not called.

**Errors** are `{error}`: `400` validation, a compile refusal or a bad request · `401` no token ·
`403` a foreign `Host` or `Origin` · `404` no such record or no such route · `409` referenced by
another record, or already exists · `415` a write that is not JSON.

The store is rebuilt whenever the compiled manifest changes, so a `dt compile` elsewhere is visible
to the next request.

## not carried from the in-core server (0.30 and earlier)

No compatibility is kept for the pre-0.31 spellings.

- **`dt start`** is now `dt serve`.
- **Docker-driver collections** (`containers`, `images`) are not answered here: they moved to
  `@dreamteamer/host`, which has no HTTP surface.
- **`/admin`** (the studio) is gone — the studio is archived and nothing serves it.
- **`/ui/<module>/app.js`** is gone. No current client loads module bundles over HTTP; the mobile app
  reads the `ui` list from `/info` and nothing else. `/info` still carries that list.
- `GET /` redirects to `/api/info` rather than to the studio.

Apache-2.0.
