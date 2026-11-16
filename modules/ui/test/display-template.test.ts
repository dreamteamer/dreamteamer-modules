// A CARD'S DISPLAY TEMPLATE, compiled (lib/display-template.ts): a bare token naming a field is a slot drawn by the
// field's View; a filtered token or one naming no field is the grammar's text; line breaks are kept.
import assert from "node:assert/strict"
import test from "node:test"
import { compileTemplate, templateOption } from "../src/lib/display-template.ts"
import { renderMd, slotToken } from "../src/lib/render-md.ts"
import { enumRow, fieldRow } from "./field-rows.ts"

const fields = [fieldRow("name"), enumRow("status", ["active", "paused"]), fieldRow("due", { type: "date" })]
const record = { id: "northwind-launch", name: "Northwind launch", status: "active", due: "2026-12-01" }

test("a bare token is a slot carrying its field, value and plain text", () => {
  const { source, slots } = compileTemplate("**{{ name }}** {{ status }}", record, fields)
  assert.equal(source, `**${slotToken(0)}** ${slotToken(1)}`)
  assert.deepEqual(
    slots.map(s => [s.field.field, s.value, s.text, s.file]),
    [
      ["name", "Northwind launch", "Northwind launch", false],
      ["status", "active", "active", false],
    ]
  )
})

test("the markdown around a slot still parses — bold wraps the View", () => {
  const { source, slots } = compileTemplate("**{{ name }}**", record, fields)
  assert.deepEqual(
    renderMd(
      source,
      slots.map(s => s.text)
    ),
    [{ tag: "p", attrs: { dir: "auto" }, children: [{ tag: "strong", children: [{ slot: 0 }] }] }]
  )
})

test("a filtered token is text, as is a token naming no field", () => {
  const { source, slots } = compileTemplate("{{ due | date:DD/MM }} {{ owner }}{{ id }}", record, fields)
  assert.equal(source, "01/12 northwind-launch")
  assert.equal(slots.length, 0)
})

test("an unknown filter renders nothing rather than no card", () => {
  assert.equal(compileTemplate("a{{ name | nope }}b", record, fields).source, "ab")
})

test("a line break between two plain lines is kept as a paragraph break", () => {
  assert.equal(compileTemplate("one\ntwo", record, fields).source, "one\n\ntwo")
  assert.equal(compileTemplate("- one\n- two", record, fields).source, "- one\n- two")
})

test("the template option: a string that says something, else the built-in card", () => {
  assert.equal(templateOption({ card_title: "{{ name }}" }), "{{ name }}")
  assert.equal(templateOption({ card_title: "  " }), null)
  assert.equal(templateOption({}), null)
})
