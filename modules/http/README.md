# @dreamteamer/http

`dt serve` — a JSON REST api at `/api` over a dreamteamer workspace, through the same validating
store the CLI uses. A record written over HTTP is validated, serialized and refused exactly as
`dt add` / `dt set` would; a schema write compiles through the same workspace handle, so every
installed extension judges it.

## install

In a dreamteamer workspace (engine `>=0.31.0`):

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

`dt serve` answers the dreamteamer host protocol — every route, shape and error the VS Code extension's
in-process host answers — through the shared handler in `@dreamteamer/protocol`. The routes are written
once, in that package's `PROTOCOL.md`; its contract suite runs against `dt serve` in this repository's
tests (`modules/protocol/test/contract-http.test.mjs`) and passes every case.

What `dt serve` adds is the TRANSPORT, which an in-process host has none of:

- **`Host` and `Origin`.** The `Host` header names the server's own address and port (`localhost` and
  `127.0.0.1` too, on loopback); an `Origin`, when sent, is `http://` plus that host and port. Anything
  else is `403` — a page on another origin, or a DNS name rebound to this address.
- **A token.** A server started with `--token` answers `401` to a request without
  `Authorization: Bearer <token>`. A `--host` beyond loopback needs one.
- **Bodies.** A write's body is JSON. One that does not parse is `415`. A same-origin or Origin-less body
  is parsed whatever its `Content-Type` — a workspace module's bare `fetch('/api/…', { method, body })`
  sends `text/plain` — while a cross-site one is already `403`.
- **A blocked commit.** `POST /commit` answers `409` when a repository is blocked by an in-progress merge
  or rebase, with the same results array.

See `UPDATING.md` for what changed from 0.1.0.
