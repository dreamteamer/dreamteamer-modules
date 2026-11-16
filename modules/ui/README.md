# @dreamteamer/ui

The dreamteamer UI as a package: the nav, lists, boards, calendars, maps, record pages and the schema editor, as
one React app written in TypeScript. A host mounts it and hands it a **transport** — how requests reach the host
and how the host's notifications come back. The app speaks one REST contract, written in
[`@dreamteamer/protocol`](../protocol/PROTOCOL.md), on every host.

> It is `0.x`: 0.4 rewrote the app in React (it was Vue through 0.3) over the same host contract, and a module app
> now draws with its own framework — see
> [versions](#versions). Apache-2.0.

```bash
npm install @dreamteamer/ui
```

## what is in the package

- `dist/lib/` — the library a host bundles: `index.js` (`mount`, `httpTransport`, `HostError`),
  `index.d.ts` and `style.css` (icons, the `--dt-*` tokens light and dark, a small base, and the Tailwind
  utilities the app's components use). Each colour reads the VS Code theme variable first, so inside a webview
  the app takes on the editor's theme.
- `dist/app/` — the browser page (`index.html` + `assets/`) over the HTTP transport.
- `dist/guest/` — the module frames' guest: `guest.js` (the guest runtime, no framework, as one inline text) and
  `guest.css` (this app's stylesheet, fonts inlined: the tokens a module draws with). See
  [module apps](#module-apps).
- `src/` — the source all three are built from.

React is bundled into the library and the page, so a host does not install it.

## mounting it

```ts
import { mount, type Transport } from "@dreamteamer/ui"
import "@dreamteamer/ui/dist/lib/style.css"

const transport: Transport = {
  request: (method, path, body) => callMyHost(method, path, body), // path is everything after /api
  notify: (type, payload) => tellMyHost(type, payload), // dt:mounted, dt:route, dt:open, dt:open-file
}
await mount("#app", { transport })
```

After its first render the app sends `dt:mounted`, and the host replies with a `dt:navigate` message naming
the route to show. Messages from the host (`dt:navigate`, `dt:invalidate`, `dt:host`, `dt:select`) arrive as
window `message` events. The app re-reads the nav, the schema and the open page on every `dt:invalidate`, and
`GET /host` on `dt:host`. A 401 from the host signs the page out. Table rows and cards carry
`data-vscode-context` (`{ webviewSection: "dt-row", dtCollection, dtId, dtIds }`) for an editor's native row menu.

## what it draws

| route                                  | page                                                                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                    | the workspace's collections                                                                                                                                    |
| `/content/<collection>`                | the browse: the collection's records, by the List its layout names                                                                                             |
| `/<a ui-view's route>`                 | a collection ui-view (`/projects-board`): the same browse, seeded from the view                                                                                |
| `/<a page ui-view's route>`            | a page ui-view (layout `page` or `activity`): its nested views as panels; `?source=<layer>` scopes it; any other layout names a module app, drawn in its frame |
| `/a/<app>[/…]`                         | a module app ([module apps](#module-apps))                                                                                                                     |
| `/content/<collection>/<id>`           | the record page: its record layout, the commit line and source, Commands, Info and Revisions                                                                   |
| `/content/<collection>/+`              | a new record                                                                                                                                                   |
| `/<a record ui-view's route>/<id>`     | a record drawn by a record-scope ui-view's `display.record`                                                                                                    |
| `/settings/schema[/<kind>[/<id>]]`     | the Schema tab: Activity, every internal collection (modules, collections, skills, …), Sources                                                                 |
| `/settings/data-model[/<name>]`        | the old address of the data model: lands on `/settings/schema/collections[/<name>]`                                                                            |
| `/settings/system/<collection>[/<id>]` | a list or record kept under the settings prefix                                                                                                                |

A collection or id holding `/` resolves against the workspace's collections.

The nav is `GET /nav` (the workspace's `nav.yaml`, resolved by the host) under a toolbar: the workspace's name,
Back and Forward through the app's own history (a move that changes only the query, such as the browse writing
its filter back, replaces the entry rather than adding one), and the arrange lock. The lock starts locked;
unlocked, rows drag (before, into or after a row, or to the bottom of the top level) and have a right-click menu
— New folder, Rename, Dissolve, Move up/down/to top/to bottom, Set icon, Hide — and the toolbar offers New folder
and Show hidden…. Each gesture is one `PATCH /nav` op, built from the nodes' `target`s; a refusal shows the
host's sentence. Layers keep their own nav and take no gesture.

On a pane host (`GET /host` answers a workspace id, as `dt web` does; never the editor) the name is the
workspace switcher (`/_dt/workspaces`, `/_dt/handoff`) and the toolbar ends in the level (`eye`, `edit`,
`shield`), whose menu lowers it (`POST /_dt/level`) and sends a raise to the chat; at Read the arrange lock is
disabled. The page reports its place and ticked rows with `PUT /selection` (200 ms after the last change, at most
50 refs), and the chat's `dt:select` ticks those rows, going to their list first.

Every page draws from the display contract (`GET /presentation`): a collection's title, icon,
list columns and sort, form sections and record title template; a field's surfaces (`hidden`), choices with
their labels, icons and colours, and its `editor` and `viewer`. Fields are drawn through registries of Edits
and Views, resolved in this order: the field's own id, then its shape
(body, reference, enum, list, object with sub-fields), then its type. A module can register its own Edit or
View (see [module apps](#module-apps)); it is registered under its own id and drawn in its frame.

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

The browse draws a collection's records by the List its `display.list.layout` (or the view's) names, from the
`lists` registry; a module app's List is registered there too and drawn in its frame, handed the documented
`collection`, `query` and `options` and a snapshot of the browse's `state`. The built-in List is `table`: a column per field (the collection's
`list.columns`, else the title, the status and short scalars), sorted by a header click, a checkbox per row for
batch delete, row density (compact, cozy, comfortable), colour by an enum, and bands by a field's value
(`group_by`), a reference's band named by the referenced record's title. Search is the host's `q`; the filter
builder sends the engine's `filter` with its operators, values picked by the field's own Edit (a reference by
the record picker, a string from the values its records hold), and fields of referenced records reachable by
path (`project.status`). A collection read from more than one source has the source picker; a record just
created from a list whose sources leave out the root it was saved to widens the list to that root, and says so.
The Commands panel lists the collection's bound commands over the ticked rows, with Ask in chat where a chat
reads the page. Layout options (the
panel beside the list) sets the layout, sort, the List's options and the columns and their order; **Save**
writes them to the governing ui-view, or to the collection's own `display.list`, and **Save as…** writes a new
ui-view at `/views/<collection>/<name>`. Search, filter and layout ride on the URL (`?filter=…`).

`kanban` is the board: a column per value of a field (`lanes_by`, else the first enum; enum order, with each
value's colour), optional lanes by another (`group_by`), each column scrolling its own cards under a pinned
header. Dragging a card to another column writes that field; while the list is sorted by the collection's
`position_field`, dropping between cards also places it there (the protocol's position route). A column field the
form would not let you edit moves nothing, and the card says why. The `+` on a column opens a new record with the
column's value filled in. `cards` is a grid of cards with a cover picture (the `image` field, or the first field
whose View is `image`; a URL or a file record; `image_fit`), the record's title and three of the chosen columns,
banded by `group_by`. On both, `card_title` is a markdown template whose `{{ field }}` tokens are drawn by each
field's own View, and `color_by` tints the card.

`calendar` is a Monday-first month grid, a record on the day its `start` field (else the first date field) names.
`gantt` draws a bar per record from `start` to `end` on a time axis of day columns: runs where nothing starts or
ends fold into one narrow column a click opens (`fold_gaps`), a record with no start is listed under the chart, an
end before its start is drawn as a marked point, `color_by` colours the bars (past six values the rest go neutral,
and it says so), and `group_by` makes lanes — collapsed at first (`start_collapsed`), each with its extent drawn
one segment per run, a reference lane named, pictured and summarised from the record it points at
(`group_title`, `group_icon`, `group_summary`). The bar's text is `template`, else `bar_label`, else the title.
`carousel` is a card per record over the images in the folder its `folder` field (a `${env:…}` template) points at
(`GET /folder/…`), or the reason there are none. `counts` is one number per value of `group_by`, each a link to the
list filtered to it (the view's own filter carried, and the page's layer). `map` plots records with coordinates on
OpenStreetMap tiles (Leaflet), fitting them on open (`auto_fit`). `diagram` is a node-and-edge canvas (React Flow):
over `collections` with `link_by: schema` it draws each collection as a table of its fields with an edge per
reference, grouped by module; over any other collection a record is a dot sized by its links, linked by reference,
a shared value or a value of its own, optionally grouped. Names appear as you zoom in; hovering a node dims the
rest; dragging a node or a group (which carries its members), or resizing a group from its corner, is kept in the
view's `arrangement` for **Save**. Calendar, gantt and carousel cards carry the row context too.

A page ui-view (`scope: page`, `display.list.layout: page`) draws the views in `options.views` as panels in one or
two columns (`grid_columns`): each collection view in its own layout through the embedded browse, an `activity`
view as the module's feed, a nested page as its own grid. A reference to nothing, a cycle, a record view or a
module app's page is refused in its panel, saying why. A module whose page view names it (`options.module`) lands
on that page in the Schema tab instead of its Activity.

The record page draws the record by the record-scoped Edit or View its `display.record.layout` names (a
record-scope ui-view's, else the collection's): `properties` by default (`page`) — one line per property,
`icon · label · value`, then the body as the document — or `form`/`doc`, the two-column form; a module can
register its own with `scope: "record"`. Both follow `form.sections` (a `collapsed` one starts shut and comes
last), each field's `hidden`, and draw a computed field dimmed with the reason on hover. A record opens read; the
pencil switches the same layout to edit mode in place, and Cancel/Save (or Cmd/Ctrl-S) end it. A list relation
on the read is drawn as the target collection's own browse (its table or board, its columns, sort and paging),
scoped to the related records; `display.record.options.relation_views.<field>` names another ui-view, or
`false` for links. A collection that declares `display.record.options.stages` gets its stage map above the
properties on the read: the stages in a row, each checked when its gate's commands are done and the current one
marked, the current stage's next command under it (a click copies its invocation), and each stage's fields,
reviews and gate in a card on hover or focus. The header says the id's path, the title from `record_title` (a reference read as its
target's title), a duplicate id, the last commit, and where the record is read from with its repo state
(`ahead 1 · uncommitted`); a root that takes no write draws the record read-only and says why. Under it come the
`display.record` subtitle, badge and `color_by` tint, and what extensions say about the record (`GET /notes`).
The side panel has Commands (the bound commands and the record's state against each, `dt next`; pick one to copy
its invocation, or, where a chat reads the page, Ask in chat), Info, and Revisions (each commit, its diff, and
restore). **Commit to <repo>** publishes pending writes (`dt commit`), per repo, on the record page and the
browse. **⋯** has Rename (every reference rewritten) and Delete; a record others reference is refused and
can then be deleted anyway. Leaving with unsaved edits asks first.

Save sends only the changed fields, and the host validates them as `dt set` does. If it refuses, the page
shows its reason and nothing is written. A new record says where it saves when there is more than one answer,
can start from an existing record (**Start from existing…**), and takes `?prefill=` and `?target=` from a
list. When the host answers `GET /host` with level `read`, the page draws values and offers no edits; rename,
restore and commit are offered at `admin` only.

The Schema tab (`/settings/schema`, where the nav's workspace row lands) has a rail of kinds — Activity, every
collection the engine marks internal (Modules and Collections first, each with its record count), Sources — and
the kind's page beside it. `?module=<id>` narrows every count and list to that module (`$module`), with a banner
whose ✕ widens it again. **Activity** is git history as named entries, grouped by day, paged, each with the
records it touched (`GET /activity`, asked again while a repo is still being read). **Collections** is the data
model: every collection by namespace, **New collection** (namespace, name, the mixins it starts from in the order
ticked, an id template, an icon, the module it is written into), and per collection the **designer**: its
fields as a grid, engine-held ones locked on top, the rest dragged to reorder (local only — the engine stores no
order), each with Edit field, Hide, Rename field…, Rename value… and Delete. The field drawer has Field (type,
description, required, editable, hidden surfaces, form section, placeholder, unit, direction, width), Edit and
View (which registered Edit and View, and their own options — an enum's values are the `select-dropdown`
choices) and, for a reference, Relationship: where the link is kept, two-way, at most one, the delete rule, the
field on the other collection (checked live), the display template. Changes stage until **Save changes**, which
writes one compile-gated op per field (`POST`/`PATCH`/`DELETE /fields/…`, the other side of a relation too) and
reports what each did; a rename shows the engine's dry-run plan, then rewrites and commits at once. Delete
collection asks for its name. `?field=<name>` opens one field. A record of `collections` can be drawn as the
designer with `display.record.layout: data-model`. **Modules** lists them as `dt list modules` does; a module's
record page adds **New collection in this module…**. **Sources** is the stack of roots — the workspace, each
layer (installed or not), each module-owned collection, with their records — and what each remote grants, asked
live (Re-check, Who has access). Every other kind is the ordinary browse and record page, kept inside the tab; a
ui-view's record page has its **Module** dropdown, which moves the view's source. **Save as…** picks the new
view's icon and module too.

## module apps

A module's own UI is a prebuilt bundle, `ui/app.js` in the module, which `dt compile` stages to
`.dreamteamer/ui/<module>/app.js` and `GET /info` names in `ui` (cr-modules-005, cr-modules-008). Its default export
takes the register API — `registerEdit`, `registerView`, `registerList`, `registerApp`, `registerPanel`,
`registerKindDefault` and a `router` — and registers **components that are mount functions**, not components of any
framework. A module draws with whatever it bundles — plain DOM, React, Vue — so neither this app nor a later rewrite
of it constrains a module:

```js
export default function register({ registerView, registerEdit, registerList, registerApp, router }) {
  registerView({
    id: "northwind-badge",
    name: "Badge",
    types: ["string"],
    component: {
      // el: the element to draw into; props: { field, value, options, context, … }; ctx: { emit, router }
      mount(el, props, ctx) {
        el.textContent = String(props.value ?? "")
        return {
          update: next => (el.textContent = String(next.value ?? "")), // new props from the host
          unmount: () => el.replaceChildren(), //                          the frame is done with it
        }
      },
    },
  })
}
```

A component is `{ mount(el, props, ctx) }` or the bare function; it returns (or resolves to) `{ update?, unmount? }`
or nothing. An **Edit** says a new value with `ctx.emit("update:value", v)` or the `onChange(v)` prop. A **List** is
handed `props.state` — the browse's rows (`items`), `columns`, selection, sort and paging as plain values, and its
actions (`openRecord`, `toggleSelect`, `setSort`, `nextPage`, …) as functions — and a new one through `update` when
the browse changes. An **app** lists `routes: [{ path, component }]`; the route component is handed `props.route`,
and `router` (`push`, `replace`, `currentRoute`, `onChange`) moves it. A View drawn in a table cell is mounted into a
detached element, read back as markup after one task (so a framework that renders asynchronously can finish) and
unmounted.

Through 0.3 the guest carried Vue and a module's components were Vue components read from `window.Vue`; a bundle
built that way must be rebuilt as mount functions (wrapping its Vue components in `createApp(…).mount(el)` is
enough).

A frame's document carries `guest.css`: the tokens (`var(--dt-fg)`, `var(--dt-border)`, `var(--dt-accent)`, …) and
the base, so a module that draws in the tokens wears the editor's theme. The app's own looks are Tailwind utilities
generated for its components, not a class vocabulary — a module brings its own CSS in its bundle.

No module code runs in this page. Before the first render, `mount` opens one hidden **registry frame** per module
(sandboxed, `allow-scripts` only, the frame policy loading nothing by URL), which loads the bundle with the guest
and reports what it registered. For each id nobody holds yet, the app registers a React **proxy** in its own registry
— `edits`, `views`, `lists`, `apps` — so the field, list or page that resolves to it draws a **surface frame**:

| registered | drawn                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| an Edit    | a frame where the field's Edit goes; a value it sends is written only to a collection the person granted the module                                                 |
| a View     | a frame on the record page; in a cell, the registry frame's markup, sanitised to a short allow-list of tags                                                         |
| a List     | a frame filling the browse, handed a snapshot of the rows, columns, selection and sort; its actions (open, select, sort, page) come back as intents the host checks |
| an app     | a page at `/a/<id>[/…]`, the frame kept across the app's own routes; and a page ui-view whose `display.list.layout` names the app draws it at the view's route      |

Every `fetch('/api/…')` a frame makes is a message: the host checks it with `@dreamteamer/protocol`'s gate under
the module's scope (its own collections, plus what the person's grant adds — `moduleGrants` on `GET /host`, or
the editor's `__DT_MODULE_GRANTS__`), sends it through the transport and reshapes the answer. Navigation is held
to the module's own apps and views and the collections it reads; requests, intents and writes are rate-bounded;
`dt:invalidate` reaches a frame only for collections it reads, and a schema change marks its frames "updated —
reload". A field outside the module's read scope falls back to the built-in. The checks are in
`src/modules/policy.ts`, and the host is `src/modules/host.tsx`.

Where the frame's document comes from is the host's choice: dt web (`__DT_HOST__.moduleFrames: "url"`) serves it
from the frames base `GET /host` answers; an editor (the default) lets the page build it as `srcdoc` from the
guest at `__DT_GUEST_URL__`, the stylesheet beside it and the bundle under `__DT_UI_BASE__`. A host that offers
neither loads no module app and says so in the console — the playground is one: a page view naming an app then
draws "Page '<id>' is not registered".

`mount` also teaches the page's `fetch` to answer `/api/*` through the transport (`src/api/installApiFetchShim.ts`), for any
code in the page that still speaks the HTTP contract.

**The React contract.** Inside the app everything drawable is a React component in a registry: an Edit takes
`EditProps` (`field`, `value`, `onChange`, `options`, `record`), a View `ViewProps` (`field`, `value`, `options`,
`context`, `record`), a List `ListProps` (`state`, `collection`, `query`, `options`), a record layout
`RecordLayoutProps`, an app `{ route }` (`src/registry/props.ts`, `src/registry/index.ts`). The built-ins and the
module proxies register through it; it is not a module's contract, which stays the frame and the bundle above.

Not drawn since the React rewrite (0.3 had them): registering an unregistered folder and the source picker on the
data model and module lists; note marks on rows and cards; file uploads. A module's panels are registered and held,
and drawn nowhere, as in 0.3.

## styling

The app is styled with [Tailwind](https://tailwindcss.com) v4 (`@tailwindcss/vite`), in the components, over the
tokens — never Tailwind's palette:

- `src/styles/app.css` — the tokens (`--dt-*`, each reading the VS Code variable first, light and dark), a small base
  layer (box sizing, the body's font and colours, links, the focus ring, form controls; no preflight, so a host's page
  around a mounted app is left alone), and a `@theme` that names the tokens for Tailwind and clears its colours:
  `bg-bg-subtle`, `text-fg-subtle`, `border-border`, `text-danger`, `bg-chart-green`, `font-mono`, `text-small`,
  `rounded-dt`, … A component can only reach for a token.
- `src/styles/classes.ts` — the looks several parts share, as class strings and variant maps (`button`, `buttonTone`, `menu`,
  `menuItem`, `hint`, `notice`, `chip`, `page`, `formRow`, …) and `cx(...)` to join them; a folder's own shared looks
  sit in its `looks.ts` (`browse/`, `lists/`, `record/`, `settings/`, `components/`).
- `src/styles/vendor.css` — the few rules for DOM a library draws (Leaflet's markers, React Flow's canvas and
  handles), hooked on a class the app hands the library. CodeMirror is themed in code.

Three rules keep it honest. Two utilities that set one property are ordered by the stylesheet, not the class list,
so no two classes on an element set the same property: a look with variants is a frame plus flat
`as const satisfies Record<string, string>` maps, one entry from each (`cx(button, buttonTone.primary,
buttonSize.small)`), or the choice is made in code (`open ? "border-focus" : "border-input-border"`); `!important`
only beats a library's unlayered stylesheet (codicon.css), and a parent's `[&_td]:…` is never overridden by a class on the
child — the child carries its own. A class is written out whole in the source: Tailwind finds class names by reading
the files, so one built at run time is never generated. And code never finds an element by its look: a hook is a
`data-*` attribute (`data-nav-row`, `data-control`, `data-items`, `data-md`).

## building and testing

```bash
npm run build -w modules/ui        # dist/lib, dist/app and dist/guest
npm test -w modules/ui             # routes, fields, filters, grouping, the board's moves, card templates, the calendar, gantt, map and page views, the stage map, the record page's rules, the nav's gestures and history, the pane report, the designer's writes, the settings pages, markdown, the API client, the module-frame rules and the fetch shim
npm run typecheck -w modules/ui    # tsc, strict, over src/
npm run ui                         # from the repo root: the app from source, over a sample workspace
```

`npm run ui` serves `src/` with Vite and hot reload, at http://localhost:5173.

From the repo's runner, `test/repo/ui-suite.test.ts` runs the unit tests and the typecheck as children, and
`test/repo/tarball.test.ts` builds and packs the package and checks it carries `dist/lib`, `dist/app`,
`dist/guest`, the source and this README, and no tests. They sit one folder down so `npm test` stays fast and never
runs itself. The playground
([`playground/dev.ts`](../../playground/dev.ts)) answers `/api` with the protocol's shared handler over the
Northwind sample workspace.

The build runs before every publish (`prepublishOnly`). Nothing under `dist/` is committed.

## versions

| @dreamteamer/ui | @dreamteamer/protocol | engine (`dreamteamer`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.4.x           | ^0.3.0                | `>=0.43.0`; the app is React (Vue through 0.3) over the same transport, routes and host messages, styled with Tailwind over the same `--dt-*` tokens. A module app's components are mount functions, with no framework from the guest (0.3 handed modules `window.Vue`): a 0.3 bundle must be rebuilt. Module frames get this app's stylesheet — the tokens and the base, and only the utilities the app itself uses; 0.3's `dt-` classes are gone, so a bundle styled with them carries its own CSS (drawn in the tokens, it still wears the editor's theme) |
| 0.3.x           | ^0.3.0                | `>=0.43.0`; the pane routes (`GET /host`, selection, queue) are the protocol's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 0.2.x           | ^0.2.0                | `>=0.43.0`; the nav is `nav.yaml` (module fragments from 0.49)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 0.1.x           | ^0.1.0                | `>=0.43.0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
