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
the route to show. Messages from the host (`dt:navigate`, `dt:invalidate`, `dt:host`, `dt:select`) arrive as
window `message` events. The app re-reads the nav, the schema and the open page on every `dt:invalidate`, and
`GET /host` on `dt:host`. A 401 from the host signs the page out. Table rows and cards carry
`data-vscode-context` (`{ webviewSection: "dt-row", dtCollection, dtId, dtIds }`) for an editor's native row menu.

## what it draws

| route | page |
|---|---|
| `/` | the workspace's collections |
| `/content/<collection>` | the browse: the collection's records, by the List its layout names |
| `/<a ui-view's route>` | a collection ui-view (`/projects-board`): the same browse, seeded from the view |
| `/content/<collection>/<id>` | the record page: its record layout, the commit line and source, Commands, Info and Revisions |
| `/content/<collection>/+` | a new record |
| `/<a record ui-view's route>/<id>` | a record drawn by a record-scope ui-view's `display.record` |

Routes are the same as `ui`'s. A collection or id holding `/` resolves against the workspace's collections.

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

The browse draws a collection's records by the List its `display.list.layout` (or the view's) names, from the
`lists` registry; a module can register its own with `lists.register`, and it is handed `state`, `collection`,
`query` and `options`, as in `ui`. The built-in List is `table`: a column per field (the collection's
`list.columns`, else the title, the status and short scalars), sorted by a header click, a checkbox per row for
batch delete, row density (compact, cozy, comfortable), colour by an enum, and bands by a field's value
(`group_by`), a reference's band named by the referenced record's title. Search is the host's `q`; the filter
builder sends the engine's `filter` with `ui`'s operators, values picked by the field's own Edit (a reference by
the record picker, a string from the values its records hold), and fields of referenced records reachable by
path (`project.status`). A collection read from more than one source has the source picker; a record just
created from a list whose sources leave out the root it was saved to widens the list to that root, and says so.
The Commands panel lists the collection's bound commands over the ticked rows, with Ask in chat where a chat
reads the page. Layout options (the
panel beside the list) sets the layout, sort, the List's options and the columns and their order; **Save**
writes them to the governing ui-view, or to the collection's own `display.list`, and **Save as…** writes a new
ui-view at `/views/<collection>/<name>`. Search, filter and layout ride on the URL (`?filter=…`), as in `ui`.

`kanban` is the board: a column per value of a field (`lanes_by`, else the first enum; enum order, with each
value's colour), optional lanes by another (`group_by`), each column scrolling its own cards under a pinned
header. Dragging a card to another column writes that field; while the list is sorted by the collection's
`position_field`, dropping between cards also places it there (the protocol's position route). A column field the
form would not let you edit moves nothing, and the card says why. The `+` on a column opens a new record with the
column's value filled in. `cards` is a grid of cards with a cover picture (the `image` field, or the first field
whose View is `image`; a URL or a file record; `image_fit`), the record's title and three of the chosen columns,
banded by `group_by`. On both, `card_title` is a markdown template whose `{{ field }}` tokens are drawn by each
field's own View, and `color_by` tints the card.

The record page draws the record by the record-scoped Edit or View its `display.record.layout` names (a
record-scope ui-view's, else the collection's): `properties` by default (`page`) — one line per property,
`icon · label · value`, then the body as the document — or `form`/`doc`, the two-column form; a module can
register its own with `scope: "record"`. Both follow `form.sections` (a `collapsed` one starts shut and comes
last), each field's `hidden`, and draw a computed field dimmed with the reason on hover. A record opens read; the
pencil switches the same layout to edit mode in place, and Cancel/Save (or Cmd/Ctrl-S) end it. A list relation
on the read is drawn as the target collection's own browse (its table or board, its columns, sort and paging),
scoped to the related records; `display.record.options.relation_views.<field>` names another ui-view, or
`false` for links. The header says the id's path, the title from `record_title` (a reference read as its
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

Not yet in `ui2`, all of which `ui` has: the other Lists — calendar, map, gantt, diagram, counts and carousel
(a view naming one draws the table, and says so); page ui-views; the `data-model` record page and the record's
stage map (`display.record.options.stages`); module apps; the schema editor and settings (and the remote-access mark of
its Sources pane); note marks on rows and cards; file uploads. A route to one of these shows a line saying `ui2`
doesn't draw it yet, and the nav still lists it.

## building and testing

```bash
npm run build -w modules/ui2       # dist/lib and dist/app
npm test -w modules/ui2            # routes, fields, filters, grouping, the board's moves, card templates, the record page's rules, the nav's gestures and history, the pane report, markdown, the API client
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
