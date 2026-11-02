# Updating @dreamteamer/http

One section per release, newest first. Each says what a caller of `dt serve` has to **do**.

```bash
npm install --save-dev @dreamteamer/http@latest
```

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
