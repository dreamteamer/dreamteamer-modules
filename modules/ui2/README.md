# @dreamteamer/ui2

The dreamteamer UI in React and TypeScript: the nav, collection lists and record pages, as one React app. It is
mounted the same way as [`@dreamteamer/ui`](../ui) (the Vue app) and speaks the same REST contract, written in
[`@dreamteamer/protocol`](../protocol/PROTOCOL.md), so a host can mount either one.

> `0.x` and a subset of `ui`: see [what it draws](#what-it-draws). Apache-2.0.

```bash
npm install @dreamteamer/ui2
```

## what is in the package

- `dist/lib/` — the library a host bundles: `index.js` (`mount`, `httpTransport`, `HostError`),
  `index.d.ts` and `style.css` (icons, tokens and styles, light and dark). Each colour reads the VS Code
  theme variable first, so inside a webview the app takes on the editor's theme.
- `dist/app/` — the browser page (`index.html` + `assets/`) over the HTTP transport.
- `src/` — the source both are built from.

React is bundled into both builds, so a host does not install it.

## mounting it

```ts
import { mount, type Transport } from "@dreamteamer/ui2"
import "@dreamteamer/ui2/dist/lib/style.css"

const transport: Transport = {
  request: (method, path, body) => callMyHost(method, path, body), // path is everything after /api
  notify: (type, payload) => tellMyHost(type, payload), // dt:mounted, dt:route, dt:open, dt:open-file
}
await mount("#app", { transport })
```

After its first render the app sends `dt:mounted`, and the host replies with a `dt:navigate` message naming
the route to show. Messages from the host (`dt:navigate`, `dt:invalidate`) arrive as window `message` events.
The app re-reads the nav, the schema and the open page on every `dt:invalidate`. A 401 from the host signs
the page out.

## what it draws

| route | page |
|---|---|
| `/` | the workspace's collections |
| `/content/<collection>` | the list: search, sort by a column, 200 rows a page |
| `/content/<collection>/<id>` | the record: its fields as a form, each by its Edit, and what the engine knows about it (created, last changed, source, file) |
| `/content/<collection>/+` | a new record |

Routes are the same as `ui`'s. A collection or id holding `/` resolves against the workspace's collections.

Every page draws from the display contract (`GET /presentation`), as `ui` does: a collection's title, icon,
list columns and sort, form sections and record title template; a field's surfaces (`hidden`), choices with
their labels, icons and colours, and its `editor` and `viewer`. Fields are drawn through the same registries
as in `ui`, under the same ids and `types`, resolved in the same order: the field's own id, then its shape
(body, reference, enum, list, object with sub-fields), then its type. A module can register its own Edit or
View with `edits.register` or `views.register`.

The Edits: `input`, `input-number`, `textarea`, `markdown-body` (CodeMirror with live preview, a toolbar and
a source toggle), `boolean`, `datetime` (a date as a calendar day, a datetime as the wall clock),
`select-dropdown` (searchable), `relation-picker` (searches the target, names records by their title, a chip
per record of a list), `tags`, `json`, `code`, `color`, `slider`, `list`, `nested`, `field-select`,
`field-multi-select` and `display-template`. A cleared field is written as null, a reference as
`collection/id`.

The Views: `text`, `label`, `boolean`, `date`, `relation` (the target's title, a hover card, a link on the
record page), `markdown` (rendered; one plain line in a cell), `tags`, `json`, `color`, `filesize`, `image`,
`list`, `nested`, `progress`, `source` and `stage-checks`. A cell is one line; the record page shows the
whole value.

Save sends only the changed fields, and the host validates them as `dt set` does. If it refuses, the page
shows its reason and nothing is written. When the host answers `GET /host` with level `read`, the page
draws values and offers no edits.

Not yet in `ui2`, all of which `ui` has: boards, calendars, maps and other ui-views; filters and grouping;
the record-scoped pages (`form`, `doc`, `properties`, `data-model`); module apps; the schema editor and
settings; nav arranging; history, commit and revert; notes and commands; file uploads. A route to one of
these shows a line saying `ui2` doesn't draw it yet, and the nav still lists it.

## building and testing

```bash
npm run build -w modules/ui2       # dist/lib and dist/app
npm test -w modules/ui2            # routes, fields, value rules, markdown and the API client (node --test)
npm run typecheck -w modules/ui2   # tsc, strict, over src/
npm run ui2                        # from the repo root: the app from source, over a sample workspace
```

`npm run ui2` serves `src/` with Vite and hot reload, at http://localhost:5173. The playground
([`playground/dev.ts`](../../playground/dev.ts)) answers `/api` with the protocol's shared handler over the
Northwind sample workspace, the same as for `ui`.

## versions

| @dreamteamer/ui2 | engine (`dreamteamer`) |
|---|---|
| 0.1.x | `>=0.43.0` |
