---
name: writing-html-pages
description: "Use when a record should carry a page of HTML, or one already does: declaring an html field (the `html-page` mixin, or the same lines by hand), writing or changing a page with `dt set`, reading one as text with `dt html text`, choosing between a page, the markdown body and an `artifacts` record, or reading the page warning lines `dt check` and `dt html check` print (a script, an address that will not load, a form, a field with no `maxLength`)."
---

# writing html pages

**A page is a field of static HTML on a record.** The dreamteamer desktop app draws it in a sandboxed
frame; everywhere else it is text. The field is an ordinary string field whose `display.viewer` is
`html`, so the record stays a file you can read, diff and commit.

## when a page, and when not

Write a page when the record has something markdown cannot show: a layout, colour, a table with
merged cells, an inline SVG chart, a picture kept in the record as a `data:` address.

**The meaning still goes in the body.** Search, a list cell, a hover card and a NotebookLM export read a
page as text, and an agent reads the record's fields and body first. Put what the record says in its
fields and its markdown body, and the page beside them as the way to look at it. A record whose only
content is its page is a record most readers get as one long line.

A page that needs a script, loads anything, or is larger than the limit is not a page: it is an
`artifacts` record, a folder with an `index.html` that runs from disk.

## declaring the field

One line, in the collection's descriptor:

```yaml
name: briefs
mixins: [html-page]
```

and one in the `package.json` of the module that holds the collection (`modules/default` in a new
workspace), so `dt compile` refuses when this module is not installed:

```json
"dreamteamer": { "dependencies": ["@dreamteamer/ui-html"] }
```

Then `dt compile`. The collection has a field `page`, titled Page, 204,800 characters at most.

**Write the field by hand** when it needs another name, when a collection needs a second page, or
when it must be `sensitive`, hidden from lists or held to another limit. A collection cannot change a
field a mixin declares, so these are the mixin's lines, in the descriptor, in place of the mixin:

```yaml
fields:
  sheet:
    type: string
    title: Sheet
    maxLength: 204800
    description: The record as a page of static HTML.
    display:
      viewer: html
      editor: html
```

Keep `maxLength`. It is the only thing that refuses a page for its size; a field without one draws a
warning line in `dt check`, and only the app's own ceiling holds it.

## writing a page

Write the HTML to a file and set the field from it:

```bash
dt set briefs/northwind-weekly page="$(cat page.html)"
```

Use `dt set`, on a record that exists, and not `dt add`: `dt set` stores the page as a block of lines
you can read in the file and in a diff, and a page given to `dt add` may be stored folded or quoted.
Create the record first (`dt add briefs --name "Northwind weekly"`), then set its page.

A value over the limit is refused and nothing is written. The limit counts characters, not bytes.

## what the frame does with a page, and so what not to write

The frame is what keeps a page from acting. It does not ask and it does not report: the part of a
page it will not run or load is simply dead.

| in the page | in the frame |
|---|---|
| a `script`, an `onclick` or any other `on…` attribute, a `javascript:` address | does not run |
| a picture, font, stylesheet, video or frame from another address (`src`, `srcset`, `poster`, CSS `url()` and `@import`, `link`, `iframe`, `object`, `embed`) | is not loaded |
| a picture or a font as a `data:` address, inline `style`, inline SVG | drawn |
| a `form`, a `base`, a `meta http-equiv`, a `target` on a link | does nothing |
| a link to a record, `href="/content/<collection>/<id>"` or `href="<collection>/<id>"` | opens the record in the app |
| a link to a place in the page, `href="#totals"` | scrolls there |
| a link to an outside address | the app asks before it opens |

So: style with a `style` attribute or a `style` element, draw with inline SVG, embed a picture as
`data:`, link to records by their reference, and leave scripts, forms and anything fetched out.

## checking a page

`dt check` prints one warning line for each of those dead parts, naming the record's file, the field
and the construct. A warning is never a violation: the count and the exit code are what they are
without the page. After writing a page, look at that record alone:

```bash
dt html check briefs/northwind-weekly
```

```
⚠ data/briefs/northwind-weekly.brief.md — page: script element will not run (<script>)
⚠ data/briefs/northwind-weekly.brief.md — page: src address will not load (<img src="https://harbor-mutual.example/chart.png">)
1 page read, 2 warnings
```

Each line reads `<field>: <construct> <effect> (<where>)`, and the effect is one of `will not run`,
`will not load`, `does nothing`. Fix the page until the record reads `0 warnings`, or leave a line
you have understood: nothing is refused on its word. `dt html check` with no argument reads every
page, with a collection that collection's, and `--json` gives the same as data. It exits 0 with or
without warnings, and 2 when the collection or the record it was pointed at does not exist.

The check reads a page once, front to back, and can miss a construct or name one that is only text.
It tells an author what will be dead; it is not what keeps a page from acting.

## reading a page

```bash
dt html text briefs/northwind-weekly
```

prints the page as the text a reader gets from it: headings and paragraphs as lines, a list item as
`- item`, a table row as its cells joined by ` | `, a link as `text (address)`, a picture as its alt
text in square brackets. Read a page this way before quoting or summarising it, and name the field
when the collection has several html fields: `dt html text memos/q3 appendix`. `dt get` prints the
page's source.
