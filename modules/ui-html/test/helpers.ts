// A scratch workspace with this module installed from its packed tarball, the way npm delivers it, and one
// collection of the workspace's own module that holds a page. The engine is the suite's (tests/helpers).
import fs from "node:fs"
import path from "node:path"
import assert from "node:assert/strict"
import yaml from "js-yaml"
import { installPacked, run, virginWorkspace } from "../../../tests/helpers/workspace.ts"

export const LIMIT = 204800

/** The workspace module's collection, `briefs`. With `mixin`, it lists `html-page`; `fields` is extra YAML under `fields:`. */
export function briefsYaml({ mixin = true, fields = "" } = {}) {
  return [
    "name: briefs",
    "description: A brief, with a page.",
    ...(mixin ? ["mixins: [html-page]"] : []),
    "ids:",
    "  from: '{{ name | slug }}'",
    "fields:",
    "  name:",
    "    type: string",
    "    required: true",
    ...(fields ? [fields.replace(/\n$/, "")] : []),
    "  body:",
    "    type: markdown",
    "    body: true",
    "",
  ].join("\n")
}

/** The shape a workspace writes by hand for an html field, as YAML under `fields:`. */
export const handWritten = (name: string, extra = "") =>
  `  ${name}:\n    type: string\n${extra}    display:\n      viewer: html\n      editor: html\n`

export const dt = (root: string, ...args: string[]) => run(root, args)
export const out = r => `${r.stdout}\n${r.stderr}`
export const ok = r => {
  assert.equal(r.status, 0, `exit ${r.status}\n${out(r).slice(-2000)}`)
  return r
}

/** A compiled workspace: this module installed, the workspace module depending on it, and `collections` written. */
export function workspace(collections: Record<string, string> = { briefs: briefsYaml() }, { compile = true } = {}) {
  const root = virginWorkspace()
  installPacked(root, ["ui-html"])
  const manifest = path.join(root, "modules", "default", "package.json")
  const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"))
  pkg.dreamteamer = { ...(pkg.dreamteamer ?? {}), dependencies: ["@dreamteamer/ui-html"] }
  fs.writeFileSync(manifest, JSON.stringify(pkg, null, "\t") + "\n")
  for (const [name, text] of Object.entries(collections)) writeCollection(root, name, text)
  if (compile) ok(dt(root, "compile"))
  return root
}

export function writeCollection(root: string, name: string, text: string) {
  const file = path.join(root, "modules", "default", "collections", `${name.replace(/\//g, "--")}.collection.yaml`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

/** A compiled collection's fields, as the runtime holds them. */
export function compiledFields(root: string, collection: string): Record<string, any> {
  const file = path.join(root, ".dreamteamer", "collections", `${collection}.collection.yaml`)
  const doc: any = yaml.load(fs.readFileSync(file, "utf8"))
  return doc.compiled.fields
}

/** A record's file under data/<collection>/. */
export const recordFile = (root: string, collection: string, id: string) =>
  path.join(root, "data", collection, `${id}.${collection.replace(/s$/, "")}.md`)

/** Write a record by hand, as a person editing the file would: front matter with the given fields, then the body. */
export function handEdit(root: string, collection: string, id: string, fields: Record<string, unknown>, body = "") {
  const file = recordFile(root, collection, id)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const front = Object.entries(fields)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n")
  fs.writeFileSync(file, `---\n${front}\n---\n${body}`)
  return file
}

/** A single argument this long reaches the engine only where the platform passes it: Linux stops at 128 KiB an argument. */
export const BIG_ARGUMENT =
  process.platform === "darwin" ? false : `a 200 KB argument cannot be passed to a command on ${process.platform}`
