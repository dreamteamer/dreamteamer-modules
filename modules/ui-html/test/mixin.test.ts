// THE FIELD AND ITS LIMIT. A collection that lists `html-page` gets one field, `page`, and the limit on it is the
// engine's `maxLength`: counted in characters, refused before disk by a write, reported by `dt check` for a value
// somebody edited in by hand. Measured in a scratch workspace on the engine the suite runs, through the real CLI.
import { test, describe, after, before } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import yaml from "js-yaml"
import { cleanup, pkgOf, MODULES, installPacked, virginWorkspace } from "../../../tests/helpers/workspace.ts"
import {
  LIMIT,
  BIG_ARGUMENT,
  briefsYaml,
  handWritten,
  workspace,
  writeCollection,
  compiledFields,
  recordFile,
  handEdit,
  dt,
  out,
  ok,
} from "./helpers.ts"
import { isHtmlField, htmlFieldsOf } from "../lib/htmlFields.ts"

after(cleanup)

describe("the mixin html-page", () => {
  let root: string
  before(() => {
    root = workspace()
  })

  test("a collection that lists it compiles and has the field: a string, 204,800 characters at most, drawn and edited as html", () => {
    const page = compiledFields(root, "briefs").page
    assert.equal(page.type, "string")
    assert.equal(page.title, "Page")
    assert.equal(page.maxLength, LIMIT)
    assert.deepEqual(page.display, { viewer: "html", editor: "html" })
    assert.match(page.description, /static HTML/i)
    assert.ok(isHtmlField(page))
    assert.deepEqual(htmlFieldsOf(compiledFields(root, "briefs")), ["page"])
  })

  test("the mixin is the documented shape: one field, with a description and a use_when", () => {
    const mixin: any = yaml.load(
      fs.readFileSync(path.join(MODULES, "ui-html", "mixins", "html-page.mixin.yaml"), "utf8")
    )
    assert.equal(mixin.name, "html-page")
    assert.ok(mixin.description && mixin.use_when)
    assert.deepEqual(Object.keys(mixin.fields), ["page"])
    assert.deepEqual(
      { ...mixin.fields.page, description: undefined },
      {
        type: "string",
        title: "Page",
        maxLength: LIMIT,
        description: undefined,
        display: { viewer: "html", editor: "html" },
      }
    )
  })

  test("the page is written with dt set and stored as it was given", () => {
    ok(dt(root, "add", "briefs", "--name", "Stored"))
    const page = '<h1>Northwind</h1>\n<p class="lead">Owner: Dana Oren</p>\n'
    ok(dt(root, "set", "briefs/stored", `page=${page}`))
    const got = ok(dt(root, "get", "briefs/stored", "--json"))
    assert.equal(JSON.parse(got.stdout).page ?? JSON.parse(got.stdout).fields?.page, page)
  })

  test("listing the mixin and declaring page as well is refused: one source per field", () => {
    const other = workspace(
      { briefs: briefsYaml({ fields: handWritten("page", "    sensitive: true\n") }) },
      { compile: false }
    )
    const r = dt(other, "compile")
    assert.notEqual(r.status, 0)
    assert.match(out(r), /field "page" is declared by the descriptor and by mixin "html-page"/)
  })

  test("without this module the mixin does not exist: the workspace does not compile", () => {
    const other = workspace()
    fs.rmSync(path.join(other, "node_modules", "@dreamteamer", "ui-html"), { recursive: true })
    const pkgFile = path.join(other, "package.json")
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"))
    delete pkg.dependencies["@dreamteamer/ui-html"]
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, "\t") + "\n")
    const r = dt(other, "compile")
    assert.notEqual(r.status, 0)
    assert.match(out(r), /@dreamteamer\/ui-html/)
  })
})

describe("the limit is the field's maxLength, in characters", () => {
  // The same rule on a field written by hand with a small limit, so every platform can pass the value as an argument.
  let root: string
  before(() => {
    root = workspace({ briefs: briefsYaml({ mixin: false, fields: handWritten("page", "    maxLength: 100\n") }) })
    ok(dt(root, "add", "briefs", "--name", "Small"))
  })
  const file = () => recordFile(root, "briefs", "small")

  test("at the limit a value is written; one character over is refused, exits non-zero and leaves the file byte-identical", () => {
    ok(dt(root, "set", "briefs/small", `page=${"a".repeat(100)}`))
    const before = fs.readFileSync(file())
    const r = dt(root, "set", "briefs/small", `page=${"a".repeat(101)}`)
    assert.notEqual(r.status, 0)
    assert.match(out(r), /page.*must NOT have more than 100 characters/s)
    assert.match(out(r), /nothing was written/)
    assert.ok(fs.readFileSync(file()).equals(before), "the refused write changed the file")
  })

  test("characters, not bytes: 100 letters of two bytes each are written, and 100 of four bytes each; 101 are refused", () => {
    const two = "\u05d0".repeat(100)
    const four = "\u{1F600}".repeat(100)
    assert.equal(Buffer.byteLength(two), 200)
    assert.equal(four.length, 200, "two UTF-16 units each")
    ok(dt(root, "set", "briefs/small", `page=${two}`))
    ok(dt(root, "set", "briefs/small", `page=${four}`))
    const before = fs.readFileSync(file())
    assert.notEqual(dt(root, "set", "briefs/small", `page=${"\u05d0".repeat(101)}`).status, 0)
    assert.notEqual(dt(root, "set", "briefs/small", `page=${"\u{1F600}".repeat(101)}`).status, 0)
    assert.ok(fs.readFileSync(file()).equals(before))
  })

  test("dt add refuses a value over the limit too, and writes no record", () => {
    const r = dt(root, "add", "briefs", "--name", "Over", "--page", "a".repeat(101))
    assert.notEqual(r.status, 0)
    assert.ok(!fs.existsSync(recordFile(root, "briefs", "over")))
  })

  test("a value edited in by hand over the limit is one violation in dt check", () => {
    ok(dt(root, "check"))
    handEdit(root, "briefs", "by-hand", { name: "By hand", page: "a".repeat(101) })
    const r = dt(root, "check")
    assert.equal(r.status, 1)
    assert.match(out(r), /by-hand/)
    assert.match(out(r), /\b1 violation\b/)
    handEdit(root, "briefs", "by-hand", { name: "By hand", page: "a".repeat(100) })
    assert.match(out(ok(dt(root, "check"))), /0 violations/)
  })
})

// The engine repeats a refused value whole before its reason, and through a pipe only the first 64 KiB of that
// arrive: for a value this long the reason and dt check's last line are cut off. So these read the exit code, the
// head of the output and the file, never the tail; the test above reads the sentence and the count on a short value.
describe("the mixin's own limit, 204,800 characters", () => {
  let root: string
  before(() => {
    root = workspace()
    ok(dt(root, "add", "briefs", "--name", "Full"))
  })
  const file = () => recordFile(root, "briefs", "full")
  const head = r => out(r).slice(0, 200)

  test(
    "dt set writes 204,800 characters and refuses 204,801, leaving the file byte-identical",
    { skip: BIG_ARGUMENT },
    () => {
      assert.equal(dt(root, "set", "briefs/full", `page=${"a".repeat(LIMIT)}`).status, 0)
      const before = fs.readFileSync(file())
      assert.ok(before.length > LIMIT)
      const r = dt(root, "set", "briefs/full", `page=${"a".repeat(LIMIT + 1)}`)
      assert.equal(r.status, 1)
      assert.ok(head(r).includes("validation failed") && head(r).includes("field page"), head(r))
      assert.ok(fs.readFileSync(file()).equals(before), "the refused write changed the file")
    }
  )

  test(
    "dt set writes 204,800 letters of two bytes each (409,600 bytes) and refuses 204,801",
    { skip: BIG_ARGUMENT },
    () => {
      assert.equal(dt(root, "set", "briefs/full", `page=${"\u05d0".repeat(LIMIT)}`).status, 0)
      const before = fs.readFileSync(file())
      assert.ok(before.length > 2 * LIMIT)
      assert.equal(dt(root, "set", "briefs/full", `page=${"\u05d0".repeat(LIMIT + 1)}`).status, 1)
      assert.ok(fs.readFileSync(file()).equals(before), "the refused write changed the file")
    }
  )

  test("by hand: 204,800 characters pass dt check, in one-byte and in two-byte letters; 204,801 fail it, naming the record", () => {
    handEdit(root, "briefs", "at-limit", { name: "At limit", page: "a".repeat(LIMIT) })
    handEdit(root, "briefs", "at-limit-wide", { name: "At limit wide", page: "\u05d0".repeat(LIMIT) })
    const clean = dt(root, "check")
    assert.equal(clean.status, 0, head(clean))
    assert.ok(/0 violations/.test(out(clean)), head(clean))
    handEdit(root, "briefs", "over-limit", { name: "Over limit", page: "a".repeat(LIMIT + 1) })
    const r = dt(root, "check")
    assert.equal(r.status, 1)
    assert.ok(head(r).includes("data/briefs/over-limit.brief.md"), head(r))
    assert.ok(head(r).includes("field page"), head(r))
  })
})

describe("what an html field is", () => {
  test("a field whose display.viewer is html, or whose type is html; nothing else", () => {
    assert.equal(isHtmlField({ type: "string", display: { viewer: "html" } }), true)
    assert.equal(isHtmlField({ type: "html" }), true)
    assert.equal(isHtmlField({ type: "string", display: { editor: "html" } }), false)
    assert.equal(isHtmlField({ type: "markdown", body: true }), false)
    assert.equal(isHtmlField({ type: "string", display: { viewer: "markdown" } }), false)
    for (const odd of [null, undefined, "html", 7, [], { display: null }, { display: "html" }])
      assert.equal(isHtmlField(odd), false)
    assert.deepEqual(
      htmlFieldsOf({ a: { type: "string" }, b: { type: "html" }, c: { display: { viewer: "html" } }, d: null }),
      ["b", "c"]
    )
    assert.deepEqual(htmlFieldsOf(null), [])
  })
})

describe("the package", () => {
  const pkg = pkgOf("ui-html")
  test("has no npm dependency, and floors NotebookLM at the release that exports a page as text, optionally", () => {
    assert.equal(pkg.dependencies, undefined)
    assert.deepEqual(pkg.peerDependencies, { "@dreamteamer/notebooklm": ">=0.4.0" })
    assert.deepEqual(pkg.peerDependenciesMeta, { "@dreamteamer/notebooklm": { optional: true } })
    assert.equal(pkg.dreamteamer.dependencies, undefined)
  })
  test("beside a NotebookLM module older than that release dt compile refuses, naming both; beside 0.4.0 it compiles", () => {
    const root = virginWorkspace()
    installPacked(root, ["ui-html", "notebooklm"])
    const nlm = path.join(root, "node_modules", "@dreamteamer", "notebooklm", "package.json")
    const setVersion = (version: string) => {
      const p = JSON.parse(fs.readFileSync(nlm, "utf8"))
      p.version = version
      fs.writeFileSync(nlm, JSON.stringify(p, null, "\t") + "\n")
    }
    setVersion("0.3.1")
    const old = dt(root, "compile")
    const said = out(old).slice(0, 4000)
    assert.ok(/@dreamteamer\/ui-html/.test(said) && /@dreamteamer\/notebooklm/.test(said), said.slice(0, 600))
    assert.ok(/>=0\.4\.0/.test(said) && /0\.3\.1/.test(said) && /peerDependencies/.test(said), said.slice(0, 600))
    assert.ok(
      !fs.existsSync(path.join(root, ".dreamteamer", "mixins", "html-page.mixin.yaml")),
      "the mixin compiled beside a NotebookLM module that would send a page's markup"
    )
    setVersion(pkgOf("notebooklm").version)
    ok(dt(root, "compile"))
    assert.ok(fs.existsSync(path.join(root, ".dreamteamer", "mixins", "html-page.mixin.yaml")))
  })
  test("exports htmlToText from its build", async () => {
    const entry = pkg.exports["./htmlToText"]
    const file = path.join(MODULES, "ui-html", entry.import ?? entry.default ?? entry)
    const { htmlToText } = await import(file)
    assert.equal(htmlToText("<p>a</p><ul><li>b</li></ul>"), "a\n\n- b")
  })
})
