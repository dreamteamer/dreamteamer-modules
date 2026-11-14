# @dreamteamer/protocol

The host protocol the dreamteamer UI speaks — written down once, as a document and as data.

- `PROTOCOL.md` — every method and path, request and response shapes, the error maps, dry run, the
  notifications and gestures, the boot globals and the host capabilities.
- `src/routes.js` — `ROUTES` (the same routes as data) and `matchRoute(method, path)`.
- `src/nav-doc.js` (`@dreamteamer/protocol/nav-doc`) — the nav document every host speaks: the `NavDoc`,
  `NavTarget` and `NavOp` types, `applyNavOp` (the one pure function every gesture goes through), the reader and
  writer of `nav.yaml`, and `migrateNavSettings`.
- `bin/dt-nav.mjs` — `dt-nav migrate`: a workspace's old nav settings written into `nav.yaml`, once.

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

## 0.2.0

The left nav is a document a person arranges: `nav.yaml` at the workspace root (engine 0.49, cr-dt-008).

- `GET /nav` draws `nav.yaml` — its folders, namespace folders and rows in order, then what it does not place, by
  title. Node kinds are `folder` and `namespace` (no more `group`); every folder, namespace and collection node
  carries `target`, the NavTarget a host sends back. Module marks and module routes no longer sit on folders.
- `PATCH /nav` (one NavOp) and `PUT /nav` (the whole document) write it, through the engine's writer when the
  workspace's engine has one (0.49), else the protocol's own; a refusal is 400 and writes nothing.
- The old settings (`dreamteamer.navGroups`, `navOrder`, `navHidden`) still draw the tree they drew until migrated;
  while they stand unmigrated the two write routes answer 409. To migrate by hand:

  ```bash
  npx -p @dreamteamer/protocol@0.2 dt-nav migrate
  ```

  The editor migrates on activation and `dt web` on its first `GET /nav`, so most workspaces never run it.
- `$stubs` is gone from records and rows: the engine has written no stub record since 0.45.

## 0.1.1

Engine floor `>=0.47.0` and the peer list mirrored for `dt install`'s closure; nothing else changes. `dt update @dreamteamer/protocol` then `dt compile`.
