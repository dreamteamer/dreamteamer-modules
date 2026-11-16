/**
 * Which record layout a page draws (`lib/record-display.ts`): a record-scope view's display wins over its
 * collection's, `page` is the built-in, and a layout no registry holds for the mode falls back to `properties`.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { BUILTIN_RECORD_LAYOUT, recordDisplayOf, recordRendererId } from "../src/lib/record-display.ts"
import type { UiViewRecord } from "../src/lib/uiViews.ts"

const view = (over: Partial<UiViewRecord>): UiViewRecord => ({ id: "v", route: "/v", scope: "record", ...over })

test("the collection's display.record, with `page` naming no renderer", () => {
  assert.deepEqual(recordDisplayOf(undefined, { layout: "page" }), {})
  assert.deepEqual(recordDisplayOf(undefined, { layout: "form", options: { relation_views: { tasks: false } } }), {
    layout: "form",
    options: { relation_views: { tasks: false } },
  })
  assert.deepEqual(recordDisplayOf(undefined, undefined), {})
})

test("a record-scope view's compiled display wins; a collection-scope view's does not", () => {
  const record = view({ compiled: { display: { record: { layout: "doc" } } } })
  assert.deepEqual(recordDisplayOf(record, { layout: "form" }), { layout: "doc" })
  const list = view({ scope: "collection", compiled: { display: { record: { layout: "doc" } } } })
  assert.deepEqual(recordDisplayOf(list, { layout: "form" }), { layout: "form" })
})

test("the renderer: the named one when registered for the mode, else the built-in", () => {
  const registered = new Set(["edit:form", "view:doc", "edit:properties", "view:properties"])
  const has = (id: string, mode: "view" | "edit") => registered.has(`${mode}:${id}`)
  const warn = console.warn
  console.warn = () => {}
  try {
    assert.equal(recordRendererId(undefined, "view", has), BUILTIN_RECORD_LAYOUT)
    assert.equal(recordRendererId("form", "edit", has), "form")
    assert.equal(recordRendererId("doc", "view", has), "doc")
    // `form` is an Edit only, as in ui: its read is the built-in
    assert.equal(recordRendererId("form", "view", has), BUILTIN_RECORD_LAYOUT)
    assert.equal(recordRendererId("gallery", "edit", has), BUILTIN_RECORD_LAYOUT)
  } finally {
    console.warn = warn
  }
})
