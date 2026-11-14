# Updating @dreamteamer/http

One section per release, newest first. Each says what a caller of `dt serve` has to **do**.

```bash
npm install --save-dev @dreamteamer/http@latest
```

## 0.2.1

`@dreamteamer/protocol` ^0.2.0: `dt serve` answers `PUT /nav` and `PATCH /nav`, which write the workspace's
`nav.yaml`, and `GET /nav` draws that file (see the protocol's `PROTOCOL.md`, "The nav document"). Rows no longer
carry `$stubs`. Nothing to do.

## 0.2.0

`dt serve` now answers through the shared handler in `@dreamteamer/protocol` — the routes and shapes the
VS Code extension's host answers — instead of routes of its own. The engine floor is unchanged. A caller
that used 0.1.0's shapes changes these:

- **Created** records answer `200 { id, path, source }`, not `201 { id, path }`.
- **Field writes** moved to `/fields/:collection[/:field]` (`POST` add, `PATCH` edit, `DELETE` remove,
  `POST …/rename { to }`, `POST …/rename-value { from, to }`). The `/collections/:name/fields…` routes are
  gone.
- **Dry run** is the handler's: a write with `?dry-run=true` answers the engine's plan where there is a
  planner and `200 { plan: null, "dry-run": "unsupported" }` elsewhere — never `400`. A value other than
  `true` or `false` is still `400`, and nothing is written.
- **`POST /commit`** takes `{ only?, message?, dryRun? }`; an absent or empty `only` publishes every
  pending record write, as the editor's Commit button does. Unknown keys are ignored. `?dry-run=true` and
  `{ "dryRun": true }` both plan.
- **New routes**: `GET /sources`, `GET /activity`, `GET /nav`, `GET /folder/:collection/*id`,
  `POST /collections/:collection/files`; rows carry `$source`, `$module`, `$repo`, `$dirty`, `$ahead` and the
  rest of the computed keys `PROTOCOL.md` lists.
- **Bodies** — see the README: a same-origin or Origin-less write body is JSON whatever its
  `Content-Type`; one that does not parse is `415`.

## 0.1.1 — a hash is a commit id, and a cross-site request is refused

A security fix. **Upgrade now if you run `dt serve`**, and do not run 0.1.0 on a machine that browses
the web. There is nothing else to do; with the engine, upgrade to `dreamteamer` 0.44.1 as well.

- `GET /history-diff/:name/*id?hash=` and `POST /collections/:name/records-revert/*id` (`{hash}`) take
  a commit hash (4 to 40 hex digits) or `HEAD`. Anything else — a branch name, `HEAD^`, a value that
  is not a string, a repeated `?hash=` — is `400 {error}` and the engine is not called. 0.1.0 handed
  the value to git as given, and git reads a revision that starts with a dash as an option, some of
  which write files; with no token on loopback and no `Origin` on an image request, a page the user
  visited could reach that route.
- Every request a browser marks `Sec-Fetch-Site: cross-site` is `403`, whatever its method or path.
  `curl`, scripts and the editor send no such header and are unaffected; a same-origin page is too.
- Every answer carries `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`, and no
  longer says `X-Powered-By`.

## 0.1.0

The first release: `dt serve` and the JSON REST api at `/api`.
