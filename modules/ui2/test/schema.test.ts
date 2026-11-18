// The display contract read once: rows by name, fields in order with their collection, reference targets from
// the relations, record titles from the template, a list's columns and a form's controls.
import { test } from "node:test"
import assert from "node:assert/strict"
import type { Presentation } from "../src/api/client.ts"
import type { CollectionRow, FieldRow } from "../src/api/types.ts"
import {
  buildSchema,
  changedFields,
  formFields,
  listColumns,
  recordFacts,
  recordLabel,
  splitRef,
} from "../src/lib/schema.ts"

const row = (collection: string, extra: Partial<CollectionRow> = {}) =>
  ({
    collection,
    title: collection,
    nav: {},
    list: { layout: "table" },
    record: { layout: "page" },
    form: { sections: [] },
    record_title: "{{ name }}",
    record_type: collection.replace(/s$/, ""),
    runtime: false,
    internal: false,
    ...extra,
  }) as CollectionRow

const field = (name: string, extra: Partial<FieldRow> = {}): FieldRow =>
  ({ field: name, type: "string", title: name, required: false, editable: true, nullable: true, ...extra }) as FieldRow

const P: Presentation = {
  collections: [row("projects", { list: { layout: "table", sort: "-created" } }), row("tasks"), row("lab/samples")],
  fields: {
    projects: [
      field("id", { kind: "virtual", editable: false, hidden: ["list", "form", "record"] }),
      field("created", { type: "datetime", kind: "derived", editable: false, hidden: ["form"] }),
      field("name", { required: true }),
      field("status", { editor_options: { choices: [{ label: "Active", value: "active", color: "charts.green" }] } }),
      field("rank", { type: "position" }),
      field("notes", { type: "markdown", role: "body" }),
    ],
    tasks: [field("name"), field("project", { role: "reference" }), field("slug", { editable: "create" })],
  },
  relations: [{ collection: "tasks", field: "project", related_collection: "projects", list: false }],
}

test("rows by name, fields in order and stamped with their collection", () => {
  const s = buildSchema(P)
  assert.deepEqual(s.names, ["projects", "tasks", "lab/samples"])
  assert.equal(s.collection("projects")?.list.sort, "-created")
  assert.deepEqual(
    s.fields("projects").map(f => f.field),
    ["id", "created", "name", "status", "rank", "notes"]
  )
  assert.equal(s.field("tasks", "project")?.collection, "tasks")
  assert.deepEqual(s.fields("nope"), [])
})

test("a reference points where the relations say; any other field points nowhere", () => {
  const s = buildSchema(P)
  assert.deepEqual(s.target(s.field("tasks", "project")!), { collection: "projects", list: false })
  assert.equal(s.target(s.field("tasks", "name")!), null)
})

test("a record is called by its template, else its title or name, else its id", () => {
  const s = buildSchema(P)
  assert.equal(recordLabel(s.collection("projects"), { name: "Northwind launch" }, "x"), "Northwind launch")
  assert.equal(
    recordLabel(row("x", { record_title: "{{ code }} · {{ name }}" }), { code: "A1", name: "Harbor" }, "x"),
    "A1 · Harbor"
  )
  assert.equal(recordLabel(row("x", { record_title: "{{ name }}" }), {}, "brief-dana"), "brief-dana")
  assert.equal(recordLabel(undefined, { title: "Harbor Mutual" }, "x"), "Harbor Mutual")
})

test("a list's columns: the authored list.columns in order, else the list surface bar body and position, title fields first", () => {
  const s = buildSchema(P)
  assert.deepEqual(
    listColumns(s.collection("projects"), s.fields("projects")).map(f => f.field),
    ["name", "created", "status"]
  )
  const named = row("projects", { list: { layout: "table", columns: ["status", "name", "missing"] } })
  assert.deepEqual(
    listColumns(named, s.fields("projects")).map(f => f.field),
    ["status", "name"]
  )
})

test("a form draws the form surface; a control only where the field takes one", () => {
  const s = buildSchema(P)
  const edit = formFields(s.fields("tasks"), false).map(d => `${d.field.field}:${d.control}`)
  const create = formFields(s.fields("tasks"), true).map(d => `${d.field.field}:${d.control}`)
  assert.deepEqual(edit, ["name:true", "project:true", "slug:false"])
  assert.deepEqual(create, ["name:true", "project:true", "slug:true"])
  assert.deepEqual(
    formFields(s.fields("projects"), false).map(d => d.field.field),
    ["name", "status", "notes"]
  )
  assert.deepEqual(
    recordFacts(s.fields("projects")).map(f => f.field),
    ["created"]
  )
})

test("a ref splits on the longest collection name, with or without a leading slash", () => {
  const names = ["lab", "lab/samples", "projects"]
  assert.deepEqual(splitRef("lab/samples/one", names), { collection: "lab/samples", id: "one" })
  assert.deepEqual(splitRef("/projects/northwind-launch", names), { collection: "projects", id: "northwind-launch" })
  assert.equal(splitRef("projects/", names), null)
})

test("a save sends only what changed, null for a cleared field", () => {
  assert.deepEqual(
    changedFields({ name: "A", status: "active", notes: null }, { name: "A", status: null, notes: "x" }),
    { status: null, notes: "x" }
  )
  assert.deepEqual(changedFields({ name: "A" }, { name: "A" }), {})
})
