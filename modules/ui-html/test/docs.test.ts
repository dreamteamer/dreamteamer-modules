// THE README AND THE SKILL ARE TRUE. What they print as a shape is the shape: the field the README says the
// mixin declares is the field it declares, and the descriptor and the hand-written field they show compile
// into an html field when copied as they stand.
import { test, describe, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import yaml from "js-yaml"
import { cleanup } from "../../../tests/helpers/workspace.ts"
import { workspace, compiledFields, dt, ok, out } from "./helpers.ts"
import { isHtmlField } from "../lib/htmlFields.ts"
import { USAGE } from "../lib/htmlCommand.ts"
import { CEILING, LINES_PER_PAGE } from "../lib/pageWarnings.ts"

after(cleanup)
const here = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const readme = fs.readFileSync(path.join(here, "README.md"), "utf8")
const skill = fs.readFileSync(path.join(here, "skills", "writing-html-pages", "SKILL.md"), "utf8")
const mixin: any = yaml.load(fs.readFileSync(path.join(here, "mixins", "html-page.mixin.yaml"), "utf8"))
const pkg = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"))

/** The fenced blocks of a markdown text in one language, in order. */
const blocks = (text: string, lang: string) =>
  [...text.matchAll(new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "g"))].map(m => m[1])

describe("the README", () => {
  test("the field it says the mixin declares is the field the mixin declares", () => {
    const shown = blocks(readme, "yaml")
      .map(b => yaml.load(b) as any)
      .find(doc => doc?.fields?.page && !doc.name)
    assert.ok(shown, "no block with fields.page")
    assert.deepEqual(shown.fields.page, mixin.fields.page)
  })

  test("the descriptor and the dependency line it shows compile into a collection with a page", () => {
    const descriptor = blocks(readme, "yaml").find(b => /^name: briefs$/m.test(b))
    assert.ok(descriptor, "no descriptor block")
    const line = blocks(readme, "json").find(b => b.includes("dependencies"))
    assert.deepEqual(JSON.parse(`{${line}}`), { dreamteamer: { dependencies: [pkg.name] } })
    const root = workspace({ briefs: descriptor })
    const page = compiledFields(root, "briefs").page
    assert.equal(page.maxLength, 204800)
    assert.ok(isHtmlField(page))
  })

  test("without the module, the descriptor with the dependency line does not compile", () => {
    const descriptor = blocks(readme, "yaml").find(b => /^name: briefs$/m.test(b))
    const root = workspace({ briefs: descriptor }, { module: false, compile: false })
    const manifest = path.join(root, "modules", "default", "package.json")
    const own = JSON.parse(fs.readFileSync(manifest, "utf8"))
    own.dreamteamer = { ...(own.dreamteamer ?? {}), dependencies: [pkg.name] }
    fs.writeFileSync(manifest, JSON.stringify(own, null, "\t") + "\n")
    const r = dt(root, "compile")
    assert.notEqual(r.status, 0, out(r).slice(-400))
    assert.ok(out(r).includes(pkg.name), out(r).slice(-400))
  })

  test("it names both forms of the verb as dt help prints them, the install line and the numbers the code holds", () => {
    assert.ok(readme.includes("dt html check [<collection>[/<id>]] [--json]"))
    assert.ok(USAGE.includes("html check [<collection>[/<id>]] [--json]"))
    assert.ok(USAGE.includes("html text <collection>/<id> [<field>]"))
    assert.ok(readme.includes(`npm install ${pkg.name}`))
    assert.ok(readme.includes(`${CEILING.toLocaleString("en-US")} characters`))
    assert.ok(readme.includes(`more than ${LINES_PER_PAGE} constructs`))
    assert.ok(readme.includes(`${pkg.peerDependencies["@dreamteamer/notebooklm"].replace(">=", "")} or later`))
  })

  // What npm does beside an older NotebookLM depends on where the module comes from: measured, npm 11.7.0.
  // From a registry, the install line at the top, it REFUSES and changes nothing; only from a local tarball
  // does it warn and take the older NotebookLM out. The README says each, in npm's own words, and the fix.
  test("its NotebookLM section says what npm does on each route, and the one fix", () => {
    const section = readme.slice(readme.indexOf("\n## NotebookLM\n"))
    assert.ok(section.startsWith("\n## NotebookLM\n"), "no NotebookLM section")
    const oldest = pkg.peerDependencies["@dreamteamer/notebooklm"].replace(">=", "")
    const sentence = (about: RegExp) =>
      section
        .replace(/\s+/g, " ")
        .split(/(?<=[.:]) /)
        .find(s => about.test(s)) ?? ""
    // the registry: refused, nothing installed, nothing removed
    const registry = sentence(/registry/)
    assert.ok(registry.includes("`npm error code ERESOLVE`"), registry)
    assert.match(registry, /refuses/)
    assert.match(registry, /changes nothing/)
    assert.doesNotMatch(registry, /warns/)
    // a tarball: a warning, exit 0, and the older NotebookLM gone
    const tarball = sentence(/tarball/)
    assert.ok(tarball.includes("`npm warn ERESOLVE overriding peer dependency`"), tarball)
    assert.match(tarball, /removes/)
    assert.doesNotMatch(tarball, /refuses/)
    // no sentence says npm only warns without saying on which route
    assert.doesNotMatch(section, /npm warns \(`ERESOLVE overriding peer dependency`\) and leaves/)
    assert.match(section, /`dt compile`\s+refuses/)
    assert.match(section.replace(/\s+/g, " "), /no page's source is exported/i)
    assert.ok(section.replace(/\s+/g, " ").includes(`to ${oldest} or later first`), "the fix names the version")
    assert.ok(section.includes("`dt update @dreamteamer/notebooklm`"))
    // and the skill does not carry the old sentence either
    assert.doesNotMatch(skill, /npm warns/)
  })
})

describe("the skill", () => {
  test("it ships, and its name is its folder", () => {
    assert.ok(pkg.files.includes("skills"))
    assert.match(skill, /^---\nname: writing-html-pages\ndescription: "Use when /)
  })

  test("the field it writes by hand compiles into an html field with the limit", () => {
    const shown = blocks(skill, "yaml").find(b => b.includes("sheet:"))
    assert.ok(shown, "no hand-written block")
    const descriptor = `name: memos\ndescription: A memo, with a sheet.\nids:\n  from: '{{ name | slug }}'\n${shown}  name:\n    type: string\n    required: true\n`
    const root = workspace({ memos: descriptor })
    const sheet = compiledFields(root, "memos").sheet
    assert.ok(isHtmlField(sheet))
    assert.equal(sheet.maxLength, 204800)
    assert.equal(sheet.title, "Sheet")
    ok(dt(root, "add", "memos", "--name", "Q3"))
    ok(dt(root, "set", "memos/q3", "sheet=<h1>Q3</h1>"))
    assert.equal(ok(dt(root, "html", "text", "memos/q3")).stdout, "Q3\n")
    assert.deepEqual(ok(dt(root, "html", "check", "memos/q3")).stdout, "1 page read, 0 warnings\n")
  })

  test("the commands it shows are the verb's own", () => {
    assert.ok(skill.includes("dt html check briefs/northwind-weekly"))
    assert.ok(skill.includes("dt html text briefs/northwind-weekly"))
    assert.ok(skill.includes('dt set briefs/northwind-weekly page="$(cat page.html)"'))
    const mixinLine = blocks(skill, "yaml").find(b => b.includes("mixins: [html-page]"))
    assert.ok(mixinLine, "no mixin line")
    assert.ok(blocks(skill, "json").some(b => b.includes(`"dependencies": ["${pkg.name}"]`)))
  })
})
