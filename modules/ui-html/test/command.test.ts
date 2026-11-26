// THE VERB, dt html. `check` is dt check's page warnings for one scope, with a line that counts what was read;
// `text` is a page as the text a reader gets from it. Driven through the engine's own dispatch, in a scratch
// workspace, the way a person types it. A scope that matches nothing exits 2 and says which.
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
import { htmlCommand, USAGE } from "../lib/htmlCommand.ts"
import { htmlWarnings } from "../lib/htmlWarnings.ts"
import { htmlToText } from "../lib/htmlToText.ts"

after(cleanup)
const lines = (text: string) => text.split("\n").filter(Boolean)
const refused = (r: { status: number; stdout: string; stderr: string }, said: RegExp) => {
  assert.equal(r.status, 2, out(r).slice(-400))
  assert.equal(r.stdout, "", "a refusal printed on stdout")
  assert.equal(lines(r.stderr).length, 1, r.stderr)
  assert.match(r.stderr, said)
}

describe("dt html", () => {
  let root: string
  before(() => {
    // briefs: one page (the mixin). memos: two pages, written by hand. plain: no page. lab/sheets: a namespace.
    root = workspace(
      {
        briefs: briefsYaml(),
        memos: briefsYaml({
          mixin: false,
          fields: handWritten("sheet", "    maxLength: 1000\n") + handWritten("appendix", "    maxLength: 1000\n"),
        }).replace("name: briefs", "name: memos"),
        plain: briefsYaml({ mixin: false }).replace("name: briefs", "name: plain"),
      },
      { compile: false }
    )
    const manifest = path.join(root, "modules", "default", "package.json")
    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"))
    pkg.dreamteamer = { ...pkg.dreamteamer, namespaces: ["lab"] }
    fs.writeFileSync(manifest, JSON.stringify(pkg, null, "\t") + "\n")
    const sheets = path.join(root, "modules", "default", "collections", "lab", "sheets.collection.yaml")
    fs.mkdirSync(path.dirname(sheets), { recursive: true })
    fs.writeFileSync(sheets, briefsYaml().replace("name: briefs", "name: lab/sheets"))
    ok(dt(root, "compile"))

    ok(dt(root, "add", "briefs", "--name", "Hostile"))
    ok(dt(root, "set", "briefs/hostile", `page=${HOSTILE}`))
    ok(dt(root, "add", "briefs", "--name", "Clean"))
    ok(dt(root, "set", "briefs/clean", `page=${CLEAN}`))
    ok(dt(root, "add", "briefs", "--name", "Empty"))
    ok(dt(root, "add", "memos", "--name", "Two"))
    ok(dt(root, "set", "memos/two", "sheet=<h1>Sheet</h1><form></form>", "appendix=<p>Appendix &amp; notes</p>"))
    ok(dt(root, "add", "plain", "--name", "Plain"))
    ok(dt(root, "add", "lab/sheets", "--name", "Deep"))
    ok(dt(root, "set", "lab/sheets/deep", "page=<h2>Deep</h2><iframe></iframe>"))
  })

  describe("check", () => {
    test("with no scope: every page's lines, as dt check prints them, then the count; exit 0", () => {
      const r = dt(root, "html", "check")
      assert.equal(r.status, 0, out(r).slice(-400))
      const printed = lines(r.stdout)
      const n = htmlWarnings(HOSTILE).length
      assert.equal(printed.length, n + 2 + 1, r.stdout)
      assert.equal(printed.at(-1), `5 pages read, ${n + 2} warnings`)
      // the same lines dt check prints, less the module's name the engine adds to each
      const fromCheck = warningLines(ok(dt(root, "check"))).map(l => l.replace(/ \(@dreamteamer\/ui-html\)$/, ""))
      assert.deepEqual(printed.slice(0, -1), fromCheck)
      assert.ok(printed[0].includes("data/briefs/hostile.brief.md"), printed[0])
      assert.ok(printed[0].includes("page: onclick attribute will not run (<h1 onclick>)"), printed[0])
    })

    test("a collection: its pages only", () => {
      const r = dt(root, "html", "check", "memos")
      assert.equal(r.status, 0)
      assert.deepEqual(lines(r.stdout).slice(-1), ["2 pages read, 1 warning"])
      assert.match(lines(r.stdout)[0], /data\/memos\/two\.memo\.md.*sheet: form element does nothing \(<form>\)/)
    })

    test("a record: its pages only; a clean page is one page and no warning; a record with no page is none", () => {
      const hostile = dt(root, "html", "check", "briefs/hostile")
      assert.equal(hostile.status, 0)
      assert.equal(lines(hostile.stdout).at(-1), `1 page read, ${htmlWarnings(HOSTILE).length} warnings`)
      const clean = dt(root, "html", "check", "briefs/clean")
      assert.equal(clean.status, 0)
      assert.deepEqual(lines(clean.stdout), ["1 page read, 0 warnings"])
      const empty = dt(root, "html", "check", "briefs/empty")
      assert.equal(empty.status, 0)
      assert.deepEqual(lines(empty.stdout), ["0 pages read, 0 warnings"])
    })

    test("a collection whose name holds a slash, and a record of it", () => {
      const coll = dt(root, "html", "check", "lab/sheets")
      assert.equal(coll.status, 0, out(coll).slice(-400))
      assert.equal(lines(coll.stdout).at(-1), "1 page read, 1 warning")
      const rec = dt(root, "html", "check", "lab/sheets/deep")
      assert.equal(rec.status, 0, out(rec).slice(-400))
      assert.match(lines(rec.stdout)[0], /data\/lab\/sheets\/deep\..*page: iframe element will not load \(<iframe>\)/)
      assert.equal(lines(rec.stdout).at(-1), "1 page read, 1 warning")
    })

    test("--json: pages and the warnings, each with ref, field, construct, effect and detail; nothing else printed", () => {
      const r = dt(root, "html", "check", "memos/two", "--json")
      assert.equal(r.status, 0)
      assert.deepEqual(JSON.parse(r.stdout), {
        pages: 2,
        warnings: [
          { ref: "memos/two", field: "sheet", construct: "form element", effect: "does nothing", detail: "<form>" },
        ],
      })
      const all = JSON.parse(ok(dt(root, "html", "--json", "check")).stdout)
      assert.equal(all.pages, 5)
      assert.equal(all.warnings.length, htmlWarnings(HOSTILE).length + 2)
      for (const w of all.warnings) assert.deepEqual(Object.keys(w), ["ref", "field", "construct", "effect", "detail"])
      assert.deepEqual(JSON.parse(ok(dt(root, "html", "check", "briefs/clean", "--json")).stdout), {
        pages: 1,
        warnings: [],
      })
    })

    test("a field with no maxLength is a line in the collection's scope", () => {
      const other = workspace({
        memos: briefsYaml({ mixin: false, fields: handWritten("sheet") }).replace("name: briefs", "name: memos"),
      })
      const r = dt(other, "html", "check", "memos")
      assert.equal(r.status, 0)
      assert.equal(lines(r.stdout).length, 2, r.stdout)
      assert.match(lines(r.stdout)[0], /sheet: field declares no maxLength: only the app's own ceiling holds/)
      assert.equal(lines(r.stdout)[1], "0 pages read, 1 warning")
    })
  })

  describe("text", () => {
    test("a record's page as text", () => {
      const r = dt(root, "html", "text", "briefs/clean")
      assert.equal(r.status, 0, out(r).slice(-400))
      assert.equal(r.stdout, htmlToText(CLEAN) + "\n")
      assert.match(r.stdout, /^Northwind\n/)
      assert.match(r.stdout, /Week \| Hours/)
      assert.ok(!r.stdout.includes("<"), r.stdout)
    })

    test("the field named, on a collection with several", () => {
      assert.equal(ok(dt(root, "html", "text", "memos/two", "sheet")).stdout, "Sheet\n")
      assert.equal(ok(dt(root, "html", "text", "memos/two", "appendix")).stdout, "Appendix & notes\n")
    })

    test("a record of a collection whose name holds a slash", () => {
      assert.equal(ok(dt(root, "html", "text", "lab/sheets/deep")).stdout, "Deep\n")
    })

    test("a record with no page prints nothing and exits 0", () => {
      const r = dt(root, "html", "text", "briefs/empty")
      assert.equal(r.status, 0)
      assert.equal(r.stdout, "")
    })

    test("a long page is printed whole through a pipe", () => {
      const words = Array.from({ length: 30000 }, (_, i) => `<p>line ${i}</p>`).join("")
      handEdit(root, "briefs", "long", { name: "Long", created: "2026-01-05T10:00:00+00:00", page: words })
      const r = dt(root, "html", "text", "briefs/long")
      assert.equal(r.status, 0, out(r).slice(-400))
      const expected = htmlToText(words) + "\n"
      assert.ok(expected.length > 200_000, `${expected.length} characters`)
      assert.equal(r.stdout.length, expected.length)
      assert.ok(r.stdout.endsWith("line 29999\n"))
      fs.rmSync(path.join(root, "data", "briefs", "long.brief.md"))
    })
  })

  describe("exit 2, with one line saying which", () => {
    test("no subcommand, and an unknown one", () => {
      refused(dt(root, "html"), /say check or text/)
      refused(dt(root, "html", "render", "briefs/clean"), /no subcommand "render"/)
    })
    test("a collection that does not exist", () => {
      refused(dt(root, "html", "check", "nothing"), /no collection "nothing"/)
      refused(dt(root, "html", "check", "nothing/at-all"), /no collection matches "nothing\/at-all"/)
      refused(dt(root, "html", "text", "nothing/at-all"), /no collection matches "nothing\/at-all"/)
    })
    test("a record that does not exist", () => {
      refused(dt(root, "html", "check", "briefs/absent"), /no record "briefs\/absent"/)
      refused(dt(root, "html", "text", "briefs/absent"), /no record "briefs\/absent"/)
      refused(dt(root, "html", "check", "lab/sheets/absent"), /no record "lab\/sheets\/absent"/)
    })
    test("a collection with no html field", () => {
      refused(dt(root, "html", "check", "plain"), /collection "plain" has no html field/)
      refused(dt(root, "html", "check", "plain/plain"), /collection "plain" has no html field/)
      refused(dt(root, "html", "text", "plain/plain"), /collection "plain" has no html field/)
    })
    test("a field that is not an html field", () => {
      refused(dt(root, "html", "text", "briefs/clean", "name"), /"name" is not an html field of "briefs" \(page\)/)
      refused(
        dt(root, "html", "text", "memos/two", "page"),
        /"page" is not an html field of "memos" \(sheet, appendix\)/
      )
    })
    test("text on a collection with several html fields and none named", () => {
      refused(dt(root, "html", "text", "memos/two"), /"memos" has several html fields: name one \(sheet, appendix\)/)
    })
    test("text with no record, and with a collection alone", () => {
      refused(dt(root, "html", "text"), /text needs a record/)
      refused(dt(root, "html", "text", "briefs"), /text needs a record/)
    })
    test("a flag it does not know, and one argument too many", () => {
      refused(dt(root, "html", "check", "--fix"), /no flag "--fix"/)
      refused(dt(root, "html", "text", "briefs/clean", "--json"), /text takes no --json/)
      refused(dt(root, "html", "check", "briefs", "memos"), /too many arguments/)
      refused(dt(root, "html", "text", "memos/two", "sheet", "appendix"), /too many arguments/)
    })
  })

  test("dt help lists the verb and both forms", () => {
    const r = ok(dt(root, "help"))
    assert.ok(out(r).includes(USAGE), "dt help does not print the verb's usage")
    assert.match(USAGE, /html check \[<collection>\[\/<id>\]\] \[--json\]/)
    assert.match(USAGE, /html text <collection>\/<id> \[<field>\]/)
  })
})

describe("htmlCommand, called with an API of its own", () => {
  const page = { type: "string", maxLength: 204800, display: { viewer: "html" } }
  const engine = (rows: any[] | Error) => ({
    fieldsOf: (d: any) => d.fields,
    isRuntime: () => false,
    isBinary: () => false,
    Store: class {
      descriptors = new Map([
        ["notes", { name: "notes", fields: { page } }],
        ["notes/archive", { name: "notes/archive", fields: { page } }],
      ])
      readAll(name: string) {
        if (rows instanceof Error) throw rows
        return name === "notes"
          ? rows
          : [{ id: "old", file: "/w/data/notes/archive/old.note.md", fields: { page: "<p>Old</p>" } }]
      }
    },
  })
  const call = (argv: string[], rows: any[] | Error = []) => {
    const said = { out: "", err: "" }
    const code = htmlCommand({ root: "/w" }, argv, {
      dt: engine(rows),
      out: t => (said.out += t),
      err: t => (said.err += t),
    })
    return { code, ...said }
  }
  const row = (id: string, value: unknown) => ({ id, file: `/w/data/notes/${id}.note.md`, fields: { page: value } })

  test("it returns the exit code and writes through io", () => {
    const got = call(["check", "notes/a"], [row("a", "<script></script>")])
    assert.deepEqual(got, {
      code: 0,
      out: "\u26a0 data/notes/a.note.md \u2014 page: script element will not run (<script>)\n1 page read, 1 warning\n",
      err: "",
    })
  })

  test("a reference is split at the end of the longest collection name that matches", () => {
    // notes/archive is a collection, so notes/archive is that collection and never record archive of notes
    assert.equal(call(["check", "notes/archive"], [row("archive", "<form></form>")]).out, "1 page read, 0 warnings\n")
    assert.equal(call(["text", "notes/archive/old"]).out, "Old\n")
    assert.equal(call(["text", "notes/a/b"], [row("a/b", "<p>Deep id</p>")]).out, "Deep id\n")
  })

  test("a page that is not a string is no page: text prints nothing, check reads none", () => {
    for (const value of [42, ["<p>x</p>"], null, undefined, ""]) {
      assert.deepEqual(call(["text", "notes/a"], [row("a", value)]), { code: 0, out: "", err: "" })
      assert.equal(call(["check", "notes/a"], [row("a", value)]).out, "0 pages read, 0 warnings\n")
    }
  })

  test("what it cannot do is exit 1 and one line, never a throw", () => {
    const broken = call(["text", "notes/a"], new Error("unreadable folder"))
    assert.equal(broken.code, 1)
    assert.equal(broken.out, "")
    assert.match(broken.err, /^html: unreadable folder\n$/)
    const noApi = { out: "", err: "" }
    assert.equal(htmlCommand({ root: "/w" }, ["check"], { err: t => (noApi.err += t) }), 1)
    assert.match(noApi.err, /^html: /)
  })

  test("a real engine's API is enough", () => {
    assert.equal(typeof api.Store, "function")
    assert.equal(typeof api.fieldsOf, "function")
  })
})
