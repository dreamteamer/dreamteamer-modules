// Which registered Edit and View a field gets — the same chain as the Vue ui: the field's own id when
// registered, else its shape (body, reference, enum, list), else its type's default, else the fallback. The
// registry is filled with stand-ins here; the real components are React and need a bundler.
import { test } from "node:test"
import assert from "node:assert/strict"
import type { FieldRow } from "../src/api/types.ts"
import { edits, views } from "../src/registry/index.ts"
import { resolveEdit, resolveView } from "../src/registry/resolve.ts"

const stub = () => null
for (const id of [
  "input",
  "input-number",
  "textarea",
  "markdown-body",
  "boolean",
  "datetime",
  "select-dropdown",
  "relation-picker",
  "tags",
  "json",
])
  edits.register({ id, name: id, component: stub, types: [] })
for (const id of ["text", "label", "boolean", "date", "relation", "markdown", "tags", "json"])
  views.register({ id, name: id, component: stub, types: [] })

const field = (extra: Partial<FieldRow>): FieldRow =>
  ({ field: "f", type: "string", title: "F", required: false, editable: true, nullable: true, ...extra }) as FieldRow

test("by type", () => {
  assert.equal(resolveEdit(field({})).entry.id, "input")
  assert.equal(resolveEdit(field({ type: "integer" })).entry.id, "input-number")
  assert.equal(resolveEdit(field({ type: "boolean" })).entry.id, "boolean")
  assert.equal(resolveEdit(field({ type: "date" })).entry.id, "datetime")
  assert.equal(resolveView(field({ type: "datetime" })).entry.id, "date")
  assert.equal(resolveView(field({})).entry.id, "text")
})

test("by shape, before type: a body, a reference, an enum, a list", () => {
  assert.equal(resolveEdit(field({ type: "markdown", role: "body" })).entry.id, "markdown-body")
  assert.equal(resolveEdit(field({ role: "reference" })).entry.id, "relation-picker")
  assert.equal(resolveView(field({ role: "reference" })).entry.id, "relation")
  const choices = { choices: [{ label: "A", value: "a" }] }
  assert.equal(resolveEdit(field({ editor_options: choices })).entry.id, "select-dropdown")
  assert.equal(resolveView(field({ editor_options: choices })).entry.id, "label")
  assert.equal(resolveEdit(field({ many: true })).entry.id, "tags")
})

test("a field's own editor wins when registered; an unknown one degrades to the default and says so", () => {
  assert.equal(resolveEdit(field({ editor: "textarea" })).entry.id, "textarea")
  const warn = console.warn
  console.warn = () => {}
  try {
    const r = resolveEdit(field({ editor: "no-such-editor" }))
    assert.equal(r.entry.id, "input")
    assert.equal(r.degraded, "missing-edit-no-such-editor")
  } finally {
    console.warn = warn
  }
})

test("a markdown body is a document on the record and nothing special in a cell", () => {
  assert.equal(resolveView(field({ type: "markdown", role: "body" }), "record").entry.id, "markdown")
  assert.equal(resolveView(field({ type: "markdown", role: "body" }), "cell").entry.id, "markdown")
})
