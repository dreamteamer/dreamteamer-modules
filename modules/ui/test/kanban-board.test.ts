// THE BOARD'S DECISIONS (lib/kanban-board.ts): which field makes the columns and the lanes, and what a drop writes —
// pinned without a renderer, so a drag that would write the wrong thing fails here first.
import assert from "node:assert/strict"
import test from "node:test"
import { addPrefill, columnFieldOf, laneFieldOf, planDrop, type DropInput } from "../src/lib/kanban-board.ts"
import { enumRow, fieldRow } from "./field-rows.ts"

const fields = [fieldRow("name"), enumRow("status", ["active", "paused"]), enumRow("stage", ["a", "b"])]

test("the columns come from lanes_by, else the first field with choices", () => {
  assert.equal(columnFieldOf(fields, {})?.field, "status")
  assert.equal(columnFieldOf(fields, { lanes_by: "stage" })?.field, "stage")
  assert.equal(columnFieldOf(fields, { lanes_by: "name" })?.field, "name", "a non-enum field is a legal axis")
  assert.equal(columnFieldOf(fields, { lanes_by: "gone" }), null)
  assert.equal(columnFieldOf([fieldRow("name")], {}), null)
})

test("the lanes come only from group_by, never inferred, and a typo means no lanes", () => {
  assert.equal(laneFieldOf(fields, {}), null)
  assert.equal(laneFieldOf(fields, { group_by: "" }), null)
  assert.equal(laneFieldOf(fields, { group_by: "stage" })?.field, "stage")
  assert.equal(laneFieldOf(fields, { group_by: "gone" }), null)
})

const base: DropInput = {
  id: "northwind-launch",
  current: "active",
  field: "status",
  target: { value: "paused" },
  locked: false,
  ungroupedAllowed: true,
}

test("a drop onto another column writes the column field alone", () => {
  assert.deepEqual(planDrop(base), { fields: { status: "paused" }, position: null })
})

test("a drop onto its own column writes nothing", () => {
  assert.equal(planDrop({ ...base, target: { value: "active" } }), null)
})

test("the ungrouped column clears the field — unless the field may not be empty", () => {
  assert.deepEqual(planDrop({ ...base, target: { value: "__ungrouped__", ungrouped: true } }), {
    fields: { status: null },
    position: null,
  })
  assert.equal(
    planDrop({ ...base, target: { value: "__ungrouped__", ungrouped: true }, ungroupedAllowed: false }),
    null
  )
  assert.equal(planDrop({ ...base, current: "", target: { value: "__ungrouped__", ungrouped: true } }), null)
})

test("a locked column field moves nothing between columns", () => {
  assert.equal(planDrop({ ...base, locked: true }), null)
})

test("a gap needs manual order on", () => {
  assert.equal(planDrop({ ...base, gap: { above: "harbor" }, reorder: false, sameColumn: false }), null)
})

test("a gap in the same column writes the position only", () => {
  assert.deepEqual(
    planDrop({ ...base, target: { value: "active" }, gap: { above: "harbor" }, reorder: true, sameColumn: true }),
    { fields: null, position: { before: "harbor" } }
  )
  assert.deepEqual(
    planDrop({ ...base, target: { value: "active" }, gap: { above: null }, reorder: true, sameColumn: true }),
    { fields: null, position: { bottom: true } }
  )
})

test("a gap in another column writes the column field, then the position", () => {
  assert.deepEqual(planDrop({ ...base, gap: { above: "harbor" }, reorder: true, sameColumn: false }), {
    fields: { status: "paused" },
    position: { before: "harbor" },
  })
})

test("its own gap is no move", () => {
  assert.equal(
    planDrop({ ...base, target: { value: "active" }, gap: { above: base.id }, reorder: true, sameColumn: true }),
    null
  )
})

test("a locked board reorders within the card's own column only, never writing the column field", () => {
  assert.equal(planDrop({ ...base, locked: true, gap: { above: "harbor" }, reorder: true, sameColumn: false }), null)
  assert.deepEqual(
    planDrop({
      ...base,
      locked: true,
      target: { value: "active" },
      gap: { above: null },
      reorder: true,
      sameColumn: true,
    }),
    { fields: null, position: { bottom: true } }
  )
})

test("the column + prefills the column's value, and the lane's when the form draws it", () => {
  const column = { field: "status", value: "paused" }
  assert.deepEqual(addPrefill(column, null), { status: "paused" })
  assert.deepEqual(addPrefill(column, { field: "stage", value: "a", prefill: true }), { status: "paused", stage: "a" })
  assert.deepEqual(addPrefill(column, { field: "stage", value: "a", prefill: false }), { status: "paused" })
  assert.deepEqual(addPrefill(column, { field: "stage", value: "__ungrouped__", ungrouped: true, prefill: true }), {
    status: "paused",
  })
})
