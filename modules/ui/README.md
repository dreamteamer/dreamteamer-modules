# @dreamteamer/ui

The dreamteamer UI as a package: the nav, lists, boards, calendars, maps, record pages and the schema
editor, as one Vue app. A host mounts it and hands it a **transport** — how requests reach the host and
how the host's notifications come back. The app speaks one REST contract, written in
[`@dreamteamer/protocol`](../protocol/PROTOCOL.md), on every host.

```bash
npm install @dreamteamer/ui
```

## what is in the package

- `dist/lib/` — the library a host bundles: `index.js` (`mount`, `httpTransport`, `HostError`),
  `index.d.ts` and `style.css` (icons, tokens and the base styles). A host adds its own theme mapping
  after the stylesheet.
- `dist/app/` — the browser page (`index.html` + `assets/`) over the HTTP transport, with `browser.css`
  (light and dark colours, and the fallback for a theme colour no editor defines). `@dreamteamer/web`
  serves it as `dt web`.
- `src/` — the source both are built from.

## mounting it

```ts
import { mount, type Transport } from '@dreamteamer/ui';
import '@dreamteamer/ui/dist/lib/style.css';

const transport: Transport = {
	request: (method, path, body) => callMyHost(method, path, body), // path is everything after /api
	notify: (type, payload) => tellMyHost(type, payload),          // dt:mounted, dt:route, dt:open-file, …
	setState: (state) => keep(state),                               // optional
};
await mount('#app', { transport });
```

The host answers `dt:mounted` with a `dt:navigate` window message naming the route to show, and sends
`dt:invalidate` when records change. A request that fails rejects with a `HostError` carrying the status.

In a host with no native tree (`window.__DT_HOST__.nav === 'app'`, as under `dt web`) the app draws the nav
itself from `GET /nav`, and the nav is arranged by hand: drag a row onto another (onto the middle of a folder to
put it inside), or right-click a row for New folder, Rename, Dissolve, Move up / down / to top / to bottom, Set icon
and Hide — and the workspace row for Show hidden. Each gesture is one `PATCH /nav` that writes the workspace's
`nav.yaml`; a refusal shows the host's sentence above the tree. Layers keep their own nav: nothing drops onto them.

Workspace modules' `app` bundles are loaded from `window.__DT_UI_BASE__` before the first render; they get
the host's Vue as `window.Vue` and may call `fetch('/api/…')`, which the UI routes through the transport.

## building and testing

```bash
npm run build -w modules/ui        # dist/lib and dist/app
npm test -- --only=modules/ui      # the logic and render tiers, the types, and the packed tarball
```

The build runs before every publish (`prepublishOnly`). Nothing under `dist/` is committed.

## versions

| @dreamteamer/ui | @dreamteamer/protocol | engine (`dreamteamer`) |
|---|---|---|
| 0.2.x | ^0.2.0 | `>=0.43.0`; the nav is `nav.yaml` (module fragments from 0.49) |
| 0.1.x | ^0.1.0 | `>=0.43.0` |
