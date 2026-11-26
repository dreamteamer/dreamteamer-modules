# @dreamteamer/ui-html

A page on a record of a [dreamteamer](https://github.com/dreamteamer/dreamteamer) workspace: a field of
static HTML, declared in one line with the `html-page` mixin and drawn by the dreamteamer desktop app in a
sandboxed frame. The record stays a file: the page is one of its fields, read, diffed and committed
like the others.

```bash
npm install @dreamteamer/ui-html
npx dreamteamer compile
```

| needs | for |
|---|---|
| nothing | the mixin, the warnings in `dt check`, `dt html`, the `writing-html-pages` skill |
| the dreamteamer desktop app | seeing a page drawn |
| `@dreamteamer/notebooklm` 0.4.0 or later, when NotebookLM is installed | a page exported as text |

## what it ships

- **`html-page`**, a mixin: one field, `page`, 204,800 characters at most.
- **warning lines in `dt check`** for what a page holds that the app's frame will not run or load.
- **`dt html check`** and **`dt html text`**: those warnings for one collection or one record, and a
  page as text.
- **`writing-html-pages`**, a skill: how an agent declares, writes, checks and reads a page.
- **`htmlToText`**, exported as `@dreamteamer/ui-html/htmlToText`: a page as the text a reader gets
  from it.

## what it does not do

- **It draws nothing.** The desktop app draws a page. In a terminal and in a list, a page is its
  source or its text.
- **It refuses nothing.** `maxLength` on the field is what refuses a page, and only for its size. The
  warnings are printed and never counted: `dt check` has the same count of violations and the same
  exit code with and without this module.
- **It is not what keeps a page from acting.** The app's frame is: no script runs in it, nothing is
  loaded, a form goes nowhere. The warnings tell an author which parts of a page will be dead.

## declaring a page

In the collection's descriptor:

```yaml
name: briefs
description: A brief, with a page.
mixins: [html-page]
ids:
  from: '{{ name | slug }}'
fields:
  name:
    type: string
    required: true
  body:
    type: markdown
    body: true
```

In the `package.json` of the module that holds the collection (`modules/default` in a new workspace):

```json
"dreamteamer": { "dependencies": ["@dreamteamer/ui-html"] }
```

Then `npx dreamteamer compile`. With that line, compile refuses when this module is not installed.

The mixin declares exactly this field, and a collection that lists the mixin cannot change it:

```yaml
fields:
  page:
    type: string
    title: Page
    maxLength: 204800
    description: >-
      The record as a rich page, for what markdown cannot show: layout, colour, tables, inline SVG, pictures as
      data: addresses. Static HTML only: no script runs and nothing is loaded; the desktop app draws it in a
      sandboxed frame. Write it with dt set.
    display:
      viewer: html
      editor: html
```

A collection that needs the field under another name, a second page, a `sensitive` page, one hidden
from lists or one held to another limit writes those lines by hand in its own `fields`, without the
mixin. The field is an html field by its `display.viewer`; the check, the verb and the NotebookLM
export all read it the same way. Keep `maxLength`: a field without one draws a warning line, and
only the app's own ceiling holds it.

## writing and reading one

```bash
npx dreamteamer add briefs --name "Northwind weekly"
npx dreamteamer set briefs/northwind-weekly page="$(cat page.html)"
npx dreamteamer html text briefs/northwind-weekly
```

Write a page with `set`, on a record that exists: `set` stores it as a block of lines, and a page
given to `add` may be stored folded or quoted. A value over the limit is refused and nothing is
written; the limit counts characters, not bytes. `html text` prints the page as text: a list item as
`- item`, a table row as its cells joined by ` | `, a link as `text (address)`.

## what the frame does with a page

| in the page | in the frame |
|---|---|
| a `script`, an `on…` attribute, a `javascript:` address | does not run |
| a picture, font, stylesheet, video or frame from another address | is not loaded |
| a picture or a font as a `data:` address, inline `style`, inline SVG | drawn |
| a `form`, a `base`, a `meta http-equiv`, a `target` on a link | does nothing |
| a link to a record, `/content/<collection>/<id>` or `<collection>/<id>` | opens the record in the app |
| a link to a place in the page, `#id` | scrolls there |
| a link to an outside address | the app asks before it opens |

A page that needs a script, loads anything or is larger than the limit is an `artifacts` record: a
folder with an `index.html` that runs from disk.

## the warnings

`dt check` prints one line for each construct of the first, second and fourth rows, naming the
record's file, the field and the construct:

```
⚠ data/briefs/northwind-weekly.brief.md — page: script element will not run (<script>) (@dreamteamer/ui-html)
⚠ data/briefs/northwind-weekly.brief.md — page: src address will not load (<img src="https://harbor-mutual.example/chart.png">) (@dreamteamer/ui-html)
✔ 0 violations (28 records across 12 collections)
```

`dt html check [<collection>[/<id>]] [--json]` prints the same lines for every page, one collection
or one record, and ends with a count:

```
1 page read, 2 warnings
```

It exits 0 with or without warnings, and 2, with one line saying which, when the collection or the
record does not exist or the collection has no html field. A page of more than 2,000,000 characters
is one line and is not read. A page with more than 50 constructs lists the first 50 and counts the
rest.

The check reads a page once, front to back. It can miss a construct, and it can name one that is
only text.

## NotebookLM

`@dreamteamer/notebooklm` 0.4.0 exports a page as text. Below 0.4.0 it exports a page's source, markup
and all, as the field's value. This module names 0.4.0 as the oldest NotebookLM it sits beside, and
what npm does beside an older one depends on where this module comes from.

- Installed from the registry, as the line at the top does, npm refuses (`npm error code ERESOLVE`,
  exit 1) and changes nothing; this module is not installed and NotebookLM stays as it was.
- Installed from a local tarball, npm warns (`npm warn ERESOLVE overriding peer dependency`), exits 0
  and removes the older NotebookLM from `node_modules`, so `dt notebooklm` is gone until NotebookLM
  is installed again.

When the two are put side by side anyway, `dt compile` refuses and names both. No page's source is
exported on either route. The fix is the same for both: update NotebookLM to 0.4.0 or later first,
`dt update @dreamteamer/notebooklm`, then install this module.

A workspace that writes the field by hand, without this module, has no such guard: mark the field
`sensitive: true` until the workspace has NotebookLM 0.4.0, and it does not travel at all.
