// What a descriptor says, read one way: the compiled fields first, the columns a list shows, the fields a form
// edits, relations, and values in and out of a form.
import { test } from "node:test"
import assert from "node:assert/strict"
import type { Descriptor } from "../src/api/client.ts"
import {
  changedFields,
  columnsOf,
  editableOf,
  enumValues,
  fieldsOf,
  formatValue,
  parseInput,
  recordTitle,
  relationTarget,
  splitRef,
  titleOf,
} from "../src/lib/fields.ts"

const projects: Descriptor = {
  name: "projects",
  fields: { name: { type: "string" } },
  compiled: {
    defaults: { title: "Projects", singular: "project" },
    fields: {
      id: { type: "string", virtual: true },
      created: { type: "datetime", derived: true },
      last_modified: { type: "datetime", virtual: true },
      name: { type: "string", required: true, title: "Name" },
      status: { type: "string", enum: { active: { color: "charts.green" }, paused: null } },
      rank: { type: "position" },
      notes: { type: "markdown", body: true },
      client: { type: "companies" },
    },
  },
}

test("the compiled fields are the authority; the authored ones the fallback", () => {
  assert.deepEqual(
    fieldsOf(projects).map(f => f.name),
    ["id", "created", "last_modified", "name", "status", "rank", "notes", "client"]
  )
  assert.deepEqual(
    fieldsOf({ name: "x", fields: { a: { type: "string" } } }).map(f => f.name),
    ["a"]
  )
  assert.equal(titleOf(projects), "Projects")
  assert.equal(titleOf({ name: "lab/field-notes" }), "Field notes")
})

test("a list shows no body, position, title field or engine field bar created (last); a form edits authored fields, body last", () => {
  const fields = fieldsOf(projects)
  assert.deepEqual(
    columnsOf(fields).map(f => f.name),
    ["status", "client", "created"]
  )
  assert.deepEqual(
    editableOf(fields).map(f => f.name),
    ["name", "status", "client", "notes"]
  )
})

test("enums as a list or a map; a relation only when its type is a collection", () => {
  const [status, client] = ["status", "client"].map(n => fieldsOf(projects).find(f => f.name === n)!)
  assert.deepEqual(enumValues(status), ["active", "paused"])
  assert.equal(relationTarget(client, ["projects", "companies"]), "companies")
  assert.equal(relationTarget(client, ["projects"]), null)
  assert.equal(relationTarget(status, ["string"]), null)
})

test("a ref splits on the longest collection name", () => {
  assert.deepEqual(splitRef("lab/samples/one", ["lab", "lab/samples"]), { collection: "lab/samples", id: "one" })
  assert.equal(splitRef("projects/", ["projects"]), null)
})

test("a record is called by its name, its title, else its id", () => {
  assert.equal(recordTitle({ name: "Northwind launch" }, "x"), "Northwind launch")
  assert.equal(recordTitle({ title: "Harbor Mutual" }, "x"), "Harbor Mutual")
  assert.equal(recordTitle({ name: " " }, "brief-dana"), "brief-dana")
})

test("values read as text and come back from a form", () => {
  assert.equal(formatValue(true), "Yes")
  assert.equal(formatValue(["a", "b"]), "a, b")
  assert.equal(formatValue(null), "")
  assert.equal(parseInput("", { type: "string" }), null)
  assert.equal(parseInput("42", { type: "number" }), 42)
  assert.deepEqual(parseInput("a, b,", { type: "string", many: true }), ["a", "b"])
})

test("a save sends only what changed, null for a cleared field", () => {
  assert.deepEqual(
    changedFields({ name: "A", status: "active", notes: null }, { name: "A", status: null, notes: "x" }),
    {
      status: null,
      notes: "x",
    }
  )
  assert.deepEqual(changedFields({ name: "A" }, { name: "A" }), {})
})
