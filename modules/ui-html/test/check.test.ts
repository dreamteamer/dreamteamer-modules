// THE WARNINGS, IN dt check. The module contributes a check whose every item is a warning: dt check prints one
// line per construct, naming the record's file, the field and the construct, and its count of violations and
// its exit code are what they are without the page, and without the module.
import { test, describe, after, before } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { cleanup } from "../../../tests/helpers/workspace.ts"
import {
  api,
  briefsYaml,
  handWritten,
  workspace,
  handEdit,
  dt,
  out,
  ok,
  HOSTILE,
  CLEAN,
  warningLines,
} from "./helpers.ts"
import activate from "../lib/activate.ts"
import { readPages, pageWarnings, CEILING, LINES_PER_PAGE } from "../lib/pageWarnings.ts"
import { htmlWarnings } from "../lib/htmlWarnings.ts"

after(cleanup)
const lastLine = r => out(r).trim().split("\n").filter(Boolean).pop()
const count = r => /(\d+) violations?/.exec(out(r))?.[1]

describe("dt check, with a page that holds what the frame will not run or load", () => {
  let root: string
  before(() => {
    root = workspace()
    ok(dt(root, "add", "briefs", "--name", "Hostile"))
    ok(dt(root, "add", "briefs", "--name", "Clean"))
    ok(dt(root, "set", "briefs/clean", `page=${CLEAN}`))
  })

  test("a workspace whose pages hold none of them draws no warning line", () => {
    const r = ok(dt(root, "check"))
    assert.deepEqual(warningLines(r), [])
    assert.equal(count(r), "0")
  })

  test("the hostile page: one warning line per construct, naming the file, the field and the construct; 0 violations, exit 0", () => {
    ok(dt(root, "set", "briefs/hostile", `page=${HOSTILE}`))
    const r = dt(root, "check")
    assert.equal(r.status, 0, out(r).slice(-600))
    assert.equal(count(r), "0")
    const lines = warningLines(r)
    const expected = htmlWarnings(HOSTILE)
    assert.equal(lines.length, expected.length, lines.join("\n"))
    assert.ok(expected.length >= 17, `${expected.length} constructs in the fixture`)
    for (const [i, w] of expected.entries()) {
      assert.ok(lines[i].includes("data/briefs/hostile.brief.md"), lines[i])
      assert.ok(
        lines[i].includes(`page: ${w.construct} ${w.effect} (${w.detail})`),
        `${lines[i]}\n  wanted: ${w.construct}`
      )
    }
    for (const construct of [
      "onclick attribute will not run",
      "script element will not run",
      "javascript: address will not run",
      "target attribute does nothing",
      "form element does nothing",
      "iframe element will not load",
      "object element will not load",
      "embed element will not load",
      "base element does nothing",
      "src address will not load",
      "link element will not load",
      "href address will not load",
      "meta http-equiv does nothing",
      "@import will not load",
      "url() address will not load",
    ])
      assert.ok(
        lines.some(l => l.includes(construct)),
        `no line for: ${construct}`
      )
    assert.ok(!lines.some(l => l.includes("clean.brief.md")), "the clean page drew a line")
  })

  test("with the page made clean again the lines are gone and the exit code is the same", () => {
    ok(dt(root, "set", "briefs/hostile", `page=${CLEAN}`))
    const r = dt(root, "check")
    assert.equal(r.status, 0)
    assert.deepEqual(warningLines(r), [])
    assert.ok(!/will not|does nothing|ui-html/.test(out(r)), out(r).slice(-600))
  })

  test("a page with one picture from another place: one line, exit 0", () => {
    ok(
      dt(
        root,
        "set",
        "briefs/hostile",
        `page=<p>Chart</p><img alt="chart" src="https://harbor-mutual.example/chart.png">`
      )
    )
    const r = dt(root, "check")
    assert.equal(r.status, 0)
    assert.equal(count(r), "0")
    const lines = warningLines(r)
    assert.equal(lines.length, 1, lines.join("\n"))
    assert.match(
      lines[0],
      /data\/briefs\/hostile\.brief\.md.*page: src address will not load \(<img src="https:\/\/harbor-mutual\.example\/chart\.png">\)/
    )
  })
})

describe("dt check keeps its count and its exit code", () => {
  // The same collection, written by hand so it compiles with and without the module; one record that breaks
  // a rule of its own (no name), and one hostile page.
  const collections = { briefs: briefsYaml({ mixin: false, fields: handWritten("page", "    maxLength: 204800\n") }) }
  const fill = (root: string, page: string | null) => {
    handEdit(root, "briefs", "nameless", { created: "2026-01-05T10:00:00+00:00" }, "A record with no name.\n")
    handEdit(root, "briefs", "paged", {
      name: "Paged",
      created: "2026-01-05T10:00:00+00:00",
      ...(page ? { page } : {}),
    })
  }

  test("one violation without a page is one violation with the hostile page: exit 1 both times, and the lines are added", () => {
    const root = workspace(collections)
    fill(root, null)
    const before = dt(root, "check")
    assert.equal(before.status, 1)
    assert.equal(count(before), "1")
    assert.deepEqual(warningLines(before), [])
    fill(root, HOSTILE)
    const after = dt(root, "check")
    assert.equal(after.status, 1)
    assert.equal(count(after), "1")
    assert.equal(warningLines(after).length, htmlWarnings(HOSTILE).length)
    assert.equal(lastLine(after), lastLine(before))
  })

  test("with and without the module: the same count, the same last line, the same exit code", () => {
    const withIt = workspace(collections)
    const without = workspace(collections, { module: false })
    for (const page of [HOSTILE, null]) {
      fill(withIt, page)
      fill(without, page)
      const a = dt(withIt, "check")
      const b = dt(without, "check")
      assert.equal(a.status, 1)
      assert.equal(b.status, a.status)
      assert.equal(count(a), "1")
      assert.equal(count(b), count(a))
      assert.equal(lastLine(b), lastLine(a))
      assert.deepEqual(warningLines(b), [], "a workspace without the module printed a page warning")
    }
    // and a workspace with no violation at all: 0 and exit 0, whatever the page holds
    fs.rmSync(path.join(withIt, "data", "briefs", "nameless.brief.md"))
    fill(withIt, HOSTILE)
    fs.rmSync(path.join(withIt, "data", "briefs", "nameless.brief.md"))
    const r = dt(withIt, "check")
    assert.equal(r.status, 0, out(r).slice(-400))
    assert.equal(count(r), "0")
  })
})

describe("a field with no maxLength", () => {
  test("draws one warning naming the collection and the field; a field with one draws none", () => {
    const root = workspace({
      briefs: briefsYaml(),
      memos: briefsYaml({ mixin: false, fields: handWritten("sheet") }).replace("name: briefs", "name: memos"),
    })
    const r = dt(root, "check")
    assert.equal(r.status, 0, out(r).slice(-400))
    assert.equal(count(r), "0")
    const lines = warningLines(r)
    assert.equal(lines.length, 1, lines.join("\n"))
    assert.match(lines[0], /memos/)
    assert.match(lines[0], /sheet: field declares no maxLength: only the app's own ceiling holds \(collection memos\)/)
  })
})

describe("the check contribution", () => {
  const contribution = activate(api)
  const stub = (descriptors: any[], rows: Record<string, any[] | Error>) => ({
    CHECK_WARNINGS: true as const,
    fieldsOf: (d: any) => d.fields,
    isRuntime: (d: any) => d.runtime === true,
    isBinary: (d: any) => d.binary === true,
    Store: class {
      descriptors = new Map(descriptors.map(d => [d.name, d]))
      readAll(name: string) {
        const got = rows[name] ?? []
        if (got instanceof Error) throw got
        return got
      }
    },
  })
  const ws = { root: "/w" }
  const page = { type: "string", maxLength: 204800, display: { viewer: "html" } }
  const row = (id: string, fields: Record<string, unknown>) => ({ id, file: `/w/data/notes/${id}.note.md`, fields })
  const notes = { name: "notes", fields: { name: { type: "string" }, page } }

  test("every item it returns is a warning, in a real workspace with a hostile page", async () => {
    const root = workspace()
    ok(dt(root, "add", "briefs", "--name", "Hostile"))
    ok(dt(root, "set", "briefs/hostile", `page=${HOSTILE}`))
    const items = contribution.check({ root, ws: await api.openWorkspace(root), dt: api })
    assert.equal(items.length, htmlWarnings(HOSTILE).length)
    for (const item of items) {
      assert.equal(item.warning, true)
      assert.equal(item.file, "data/briefs/hostile.brief.md")
      assert.match(item.message, /^page: /)
    }
  })

  test("it never throws: whatever goes wrong becomes one warning saying the page check could not run", () => {
    const broken: any[] = [
      { root: "/nowhere", ws: null, dt: api },
      { root: "/nowhere", ws: { root: "/nowhere" }, dt: api },
      {
        ws,
        dt: {
          CHECK_WARNINGS: true,
          Store: class {
            constructor() {
              throw new Error("no store")
            }
          },
        },
      },
      { ws, dt: { CHECK_WARNINGS: true } },
      {},
      undefined,
    ]
    for (const ctx of broken) {
      const items = contribution.check(ctx)
      assert.ok(Array.isArray(items))
      for (const item of items) assert.equal(item.warning, true)
      if (ctx?.dt?.Store || ctx?.ws === null) {
        assert.equal(items.length, 1)
        assert.match(items[0].message, /the page check could not run/)
      }
    }
  })

  test("on an engine with no warning channel it says nothing, because there a warning would count as a violation", () => {
    const old = { ...stub([notes], { notes: [row("a", { page: "<script>x()</script>" })] }), CHECK_WARNINGS: undefined }
    assert.deepEqual(activate(old as any).check({ ws, dt: old } as any), [])
  })

  test("a page that is a number, a list, null or empty is not read: no warning, not counted", () => {
    const dtStub = stub([notes], {
      notes: [
        row("a", { page: 42 }),
        row("b", { page: ["<script>"] }),
        row("c", { page: null }),
        row("d", { page: "" }),
        row("e", {}),
      ],
    })
    assert.deepEqual(readPages({ ws, dt: dtStub }), { pages: 0, warnings: [] })
  })

  test("a page over the app's ceiling is one warning and is not read", () => {
    const dtStub = stub([notes], { notes: [row("big", { page: "<script>".repeat(CEILING / 8) + "x" })] })
    const got = readPages({ ws, dt: dtStub })
    assert.equal(got.pages, 1)
    assert.equal(got.warnings.length, 1)
    assert.equal(got.warnings[0].ref, "notes/big")
    assert.equal(got.warnings[0].file, "data/notes/big.note.md")
    assert.match(got.warnings[0].message, /^page: page too large to read \(2000001 characters, over 2000000\)$/)
  })

  test("a page with more constructs than a screen holds: the first fifty, then one line counting the rest", () => {
    const dtStub = stub([notes], { notes: [row("many", { page: "<script></script>".repeat(LINES_PER_PAGE + 151) })] })
    const { warnings } = readPages({ ws, dt: dtStub })
    assert.equal(warnings.length, LINES_PER_PAGE + 1)
    assert.equal(warnings.at(-1).message, "page: 151 more not listed (the first 50 are above)")
  })

  test("a collection that cannot be read is one warning; the others are still read; system and file collections are skipped", () => {
    const dtStub = stub(
      [
        { name: "broken", fields: { page } },
        notes,
        { name: "skills", runtime: true, fields: { page } },
        { name: "assets", binary: true, fields: { page } },
        { name: "plain", fields: { name: { type: "string" } } },
      ],
      {
        broken: new Error("unreadable folder"),
        notes: [row("a", { page: "<script>x()</script>" })],
        skills: [row("s", { page: "<script>" })],
      }
    )
    const { pages, warnings } = readPages({ ws, dt: dtStub })
    assert.equal(pages, 1)
    assert.deepEqual(
      warnings.map(w => w.message),
      ["collection broken could not be read (unreadable folder)", "page: script element will not run (<script>)"]
    )
  })

  test("an html field that declares no maxLength is one line about the field, before the collection's pages, in every scope", () => {
    const bare = { type: "string", display: { viewer: "html" } }
    const typed = { type: "html", maxLength: 100 }
    const dtStub = stub([{ name: "notes", fields: { page, sheet: bare, leaf: typed } }], {
      notes: [row("a", { sheet: "<form></form>", leaf: "<iframe></iframe>" })],
    })
    const got = readPages({ ws, dt: dtStub })
    assert.equal(got.pages, 2)
    assert.deepEqual(
      got.warnings.map(w => [w.file, w.ref, w.field, w.message]),
      [
        [
          ".dreamteamer/collections/notes.collection.yaml",
          "notes",
          "sheet",
          "sheet: field declares no maxLength: only the app's own ceiling holds (collection notes)",
        ],
        ["data/notes/a.note.md", "notes/a", "sheet", "sheet: form element does nothing (<form>)"],
        ["data/notes/a.note.md", "notes/a", "leaf", "leaf: iframe element will not load (<iframe>)"],
      ]
    )
    assert.equal(readPages({ ws, dt: dtStub }, { collection: "notes", id: "a" }).warnings.length, 3)
    assert.equal(readPages({ ws, dt: dtStub }, { collection: "notes", id: "none" }).warnings.length, 1)
  })

  test("records are read in the order of their ids, fields in the order the collection declares them", () => {
    const two = { name: "notes", fields: { second: page, first: page } }
    const dtStub = stub([two], {
      notes: [
        row("b", { first: "<form></form>", second: "<script></script>" }),
        row("a", { first: "<iframe></iframe>" }),
      ],
    })
    assert.deepEqual(
      pageWarnings({ ws, dt: dtStub }).map(w => `${w.ref} ${w.field} ${w.construct}`),
      ["notes/a first iframe element", "notes/b second script element", "notes/b first form element"]
    )
  })

  test("a scope narrows what is read: one collection, or one record", () => {
    const other = { name: "memos", fields: { page } }
    const dtStub = stub([notes, other], {
      notes: [row("a", { page: "<script></script>" }), row("b", { page: "<form></form>" })],
      memos: [row("m", { page: "<iframe></iframe>" })],
    })
    assert.equal(readPages({ ws, dt: dtStub }).pages, 3)
    assert.deepEqual(
      readPages({ ws, dt: dtStub }, { collection: "notes" }).warnings.map(w => w.ref),
      ["notes/a", "notes/b"]
    )
    assert.deepEqual(
      readPages({ ws, dt: dtStub }, { collection: "notes", id: "b" }).warnings.map(w => w.ref),
      ["notes/b"]
    )
    assert.equal(readPages({ ws, dt: dtStub }, { collection: "notes", id: "b" }).pages, 1)
  })
})
