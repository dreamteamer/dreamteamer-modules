# @dreamteamer/protocol

The host protocol the dreamteamer UI speaks — written down once, as a document and as data.

- `PROTOCOL.md` — every method and path, request and response shapes, the error maps, dry run, the
  notifications and gestures, the boot globals and the host capabilities.
- `src/routes.js` — `ROUTES` (the same routes as data) and `matchRoute(method, path)`.

A host is anything that answers the UI: the VS Code extension in-process, `dt serve` and `dt web` over HTTP.
A library module: it contributes no collection and no verb.

```bash
npm install @dreamteamer/protocol
```

```js
import { ROUTES, matchRoute } from '@dreamteamer/protocol';
matchRoute('GET', '/collections/lab%2Fsamples/records/2026/11/a');
// → { route: { id: 'record-read', … }, params: { collection: 'lab/samples', id: '2026/11/a' } }
```
