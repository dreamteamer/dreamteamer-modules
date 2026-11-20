// Which fields a browse offers and which it shows first: the heuristic columns (title-ish, status-ish, short
// scalars; never a body, an object or a computed `$` field), the Source column on a mixed-source list, a seed's
// columns as written, and the two small moves the browse makes (a column dragged, a header clicked).
import { test } from "node:test"
import assert from "node:assert/strict"
import type { SourceEntry } from "../src/api/types.ts"
import { browseFields, defaultColumns, moveItem, seedColumns, toggledSort } from "../src/lib/browseFields.ts"
import { enumRow, fieldRow } from "./field-rows.ts"

const rows = [
  fieldRow("run", { type: "object" }),
  fieldRow("notes", { type: "markdown", role: "body" }),
  fieldRow("due", { type: "date" }),
  fieldRow("name"),
  enumRow("status", ["open", "done"]),
  fieldRow("blob", { type: "map" }),
  fieldRow("hidden", { hidden: ["list", "form", "record"] }),
]
const own: SourceEntry = {
  name: "lab",
  kind: "own",
  installed: true,
  count: 2,
  via: "own",
  access: "write",
} as SourceEntry
const pkg: SourceEntry = { name: "archive", kind: "module", installed: true, count: 1, via: "package" } as SourceEntry

test("the default columns lead with the title, then the status, then short scalars", () => {
  assert.deepEqual(
    defaultColumns(rows).map(f => f.field),
    ["name", "status", "due", "hidden"]
  )
  assert.deepEqual(
    defaultColumns(rows, 2).map(f => f.field),
    ["name", "status"]
  )
})

test("a browse offers what some surface draws, plus the computed fields", () => {
  const offered = browseFields(rows, "tasks", [own]).map(f => f.field)
  assert.ok(!offered.includes("hidden"))
  assert.ok(offered.includes("name") && offered.includes("$last-modified-by"))
  assert.ok(!offered.includes("$source"))
  assert.ok(browseFields(rows, "tasks", [own, pkg]).some(f => f.field === "$source"))
  assert.deepEqual(browseFields([], "tasks", [own, pkg]), [])
})

test("the Source column joins the heuristic on a mixed list; a seed's columns stay as written", () => {
  const offered = browseFields(rows, "tasks", [own, pkg])
  assert.ok(seedColumns(null, offered, [own, pkg]).includes("$source"))
  assert.ok(!seedColumns(null, offered, [own]).includes("$source"))
  assert.deepEqual(seedColumns(["due", "name"], offered, [own, pkg]), ["due", "name"])
})

test("a drag moves one column; a header click goes ascending, then descending", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], 0, 2), ["b", "c", "a"])
  assert.deepEqual(moveItem(["a", "b"], 0, 5), ["a", "b"])
  assert.equal(toggledSort("-last_modified", "name"), "name")
  assert.equal(toggledSort("name", "name"), "-name")
  assert.equal(toggledSort("-name", "name"), "name")
})
