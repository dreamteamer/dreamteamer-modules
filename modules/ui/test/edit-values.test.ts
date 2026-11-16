// The value rules every Edit shares: a cleared field is null, never '' or []; references slashless; JSON written
// only when it parses; the field pickers offer what the option asks for.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  addTag,
  entriesOf,
  inputText,
  moveItem,
  numberFromInput,
  parseJsonDraft,
  progressOf,
  refsOf,
  sliderScale,
  swatchValue,
  tagsOf,
  textOrNull,
  toggleRef,
} from "../src/lib/edit-values.ts"
import { selectableFields } from "../src/lib/field-context.ts"
import type { FieldRow } from "../src/api/types.ts"

test("text: an object shows as JSON, an emptied field clears", () => {
  assert.equal(inputText(null), "")
  assert.equal(inputText({ a: 1 }), '{"a":1}')
  assert.equal(textOrNull(""), null)
  assert.equal(textOrNull("x"), "x")
})

test("numbers: empty and unreadable clear", () => {
  assert.equal(numberFromInput(""), null)
  assert.equal(numberFromInput("2.5"), 2.5)
  assert.equal(numberFromInput("abc"), null)
})

test("tags: a trailing comma stripped, duplicates and blanks ignored, objects as JSON", () => {
  assert.deepEqual(addTag(["a"], "b,"), ["a", "b"])
  assert.equal(addTag(["a"], "a"), null)
  assert.equal(addTag(["a"], "  "), null)
  assert.deepEqual(tagsOf([{ k: 1 }, 2]), ['{"k":1}', "2"])
  assert.deepEqual(tagsOf("solo"), ["solo"])
  assert.deepEqual(tagsOf(null), [])
})

test("JSON: blank clears, invalid is not written", () => {
  assert.deepEqual(parseJsonDraft(""), { ok: true, value: null })
  assert.deepEqual(parseJsonDraft('{"a":1}'), { ok: true, value: { a: 1 } })
  assert.deepEqual(parseJsonDraft("{a"), { ok: false })
})

test("references: slashless, a list toggles and empties to null", () => {
  assert.deepEqual(refsOf("/projects/northwind-launch"), ["projects/northwind-launch"])
  assert.deepEqual(refsOf(["projects/a", "", null]), ["projects/a"])
  assert.deepEqual(toggleRef(["projects/a"], "projects/b"), ["projects/a", "projects/b"])
  assert.equal(toggleRef(["projects/a"], "projects/a"), null)
})

test("colour, slider and progress read their options", () => {
  assert.equal(swatchValue("#ABC"), "#aabbcc")
  assert.equal(swatchValue("teal"), "#cccccc")
  assert.deepEqual(sliderScale({ max: 10 }, "7"), { min: 0, max: 10, step: 1, at: 7 })
  assert.deepEqual(sliderScale(undefined, null), { min: 0, max: 100, step: 1, at: 0 })
  assert.deepEqual(progressOf(15, { max: 10 }), { pct: 100, value: 15, max: 10 })
  assert.equal(progressOf("x", undefined), null)
})

test("rows: a drag moves one, a key/value read puts declared fields first", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], 0, 2), ["b", "c", "a"])
  assert.deepEqual(
    entriesOf({ z: 1, city: "Harbor", street: "1 Quay Road" }, [{ field: "street" }, { field: "city" }]),
    [
      ["street", "1 Quay Road"],
      ["city", "Harbor"],
      ["z", 1],
    ]
  )
})

test("a field picker narrows by type and role, and floats enum fields first when asked", () => {
  const f = (field: string, type: FieldRow["type"], extra: Partial<FieldRow> = {}): FieldRow =>
    ({ field, type, title: field, required: false, editable: true, nullable: true, ...extra }) as FieldRow
  const fields = [
    f("name", "string"),
    f("due", "date"),
    f("status", "string", { editor_options: { choices: [{ label: "Open", value: "open" }] } }),
    f("project", "string", { role: "reference" }),
  ]
  assert.deepEqual(
    selectableFields(fields, { types: ["date"] }).map(x => x.field),
    ["due"]
  )
  assert.deepEqual(
    selectableFields(fields, { roles: ["reference"] }).map(x => x.field),
    ["project"]
  )
  assert.deepEqual(
    selectableFields(fields, { prefer: "choices" }).map(x => x.field),
    ["status", "name", "due", "project"]
  )
})
