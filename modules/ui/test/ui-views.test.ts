// Tier 1 — how a ui-view record's `display.list` reaches the browse page (descriptor v2, §3.5). What
// a view draws is `compiled.display` — compile's merge of the view's display over its collection's
// — so that is what these records carry; the authored `display` is what a write sends back.
//
// ⚠ THE BUG THIS FILE EXISTS FOR is a silence, not a crash. `columns` written as a comma STRING —
// which is what `dt set ui-views/<id> display.list.columns=a,b` once produced — used to read
// back as `undefined`, and `undefined` is what an UNCONFIGURED view answers too. So the page drew
// the heuristic column set, the record's own answer was thrown away, and nothing anywhere said so:
// the operator's only signal was "my columns did nothing". Hence both halves are asserted here —
// the VALUE that comes out, and the fact that a warning was emitted at all.
import { test, describe, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"

// (Ported from the Vue ui's collection-views.test.ts; ui's `viewToConfig` lives in lib/uiViews.ts.)
import {
  collectionOf,
  uiViewFingerprint,
  viewAt,
  viewLabel,
  viewToConfig,
  type UiViewRecord,
} from "../src/lib/uiViews.ts"
import { pageOf, pathOf, queryOf, withQuery } from "../src/lib/createRoute.ts"

/** A collection-scope view whose drawn `display.list` is `table` plus the given keys. */
const view = (list: Record<string, unknown>): UiViewRecord => ({
  id: "views/tasks-open",
  route: "/views/tasks-open",
  scope: "collection",
  collection: "collections/tasks",
  compiled: { display: { list: { layout: "table", ...list } } },
})

let warnings: string[] = []
const realWarn = console.warn
beforeEach(() => {
  warnings = []
  console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "))
})
afterEach(() => {
  console.warn = realWarn
})

describe("columns — a LIST is the shape, and it passes through untouched", () => {
  test("an array of strings is the columns, in order, silently", () => {
    assert.deepEqual(viewToConfig(view({ columns: ["title", "status"] })).columns, ["title", "status"])
    assert.deepEqual(warnings, [])
  })

  test("a non-string entry is dropped — and SAYS so", () => {
    assert.deepEqual(viewToConfig(view({ columns: ["title", 7, null] })).columns, ["title"])
    assert.equal(warnings.length, 1)
    assert.match(warnings[0]!, /views\/tasks-open.*display\.list\.columns/)
  })
})

describe("⚠ columns as a comma STRING — tolerated AND complained about", () => {
  test("it is split, trimmed, and used", () => {
    assert.deepEqual(viewToConfig(view({ columns: "title, status ,due" })).columns, ["title", "status", "due"])
  })

  test("empty segments are dropped rather than becoming blank columns", () => {
    assert.deepEqual(viewToConfig(view({ columns: "title,,status," })).columns, ["title", "status"])
  })

  test("a single name with no comma at all is one column, not a wasted string", () => {
    assert.deepEqual(viewToConfig(view({ columns: "title" })).columns, ["title"])
  })

  test("the warning names the VIEW and the OPTION, so the record can be fixed", () => {
    viewToConfig(view({ columns: "title,status" }))
    assert.equal(warnings.length, 1)
    assert.match(warnings[0]!, /views\/tasks-open/)
    assert.match(warnings[0]!, /display\.list\.columns/)
  })

  test("a string of nothing but separators falls back — there is no column in it", () => {
    assert.equal(viewToConfig(view({ columns: " , " })).columns, undefined)
    assert.equal(warnings.length, 1, "still complains — the record asked for something unusable")
  })
})

describe("every other shape still falls back — loudly if a value is actually there", () => {
  test("a number is ignored, with a warning", () => {
    assert.equal(viewToConfig(view({ columns: 7 })).columns, undefined)
    assert.equal(warnings.length, 1)
  })

  test('null is silent — "unset" is not a defect', () => {
    assert.equal(viewToConfig(view({ columns: null })).columns, undefined)
    assert.deepEqual(warnings, [])
  })

  test("no columns key at all is silent", () => {
    assert.equal(viewToConfig(view({})).columns, undefined)
    assert.deepEqual(warnings, [])
  })
})

describe("sort — the same silent case one type over", () => {
  test("'' survives: a view that says UNSORTED must beat the fallback", () => {
    assert.equal(viewToConfig(view({ sort: "" })).sort, "")
    assert.deepEqual(warnings, [])
  })

  test("a non-string sort is ignored, and says so", () => {
    assert.equal(viewToConfig(view({ sort: ["-due"] })).sort, undefined)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0]!, /display\.list\.sort/)
  })
})

describe("the layout's options ride through under the layout id", () => {
  test("columns and sort are keys of the block; `options` is the pinned layout's", () => {
    const config = viewToConfig(view({ columns: "title", sort: "-due", options: { group_by: "status" } }))
    assert.deepEqual(config.listOptions, { table: { group_by: "status" } })
    assert.equal(config.viewId, "views/tasks-open")
    assert.equal(config.layout, "table")
  })

  test("a key left in `options` is not read as a column or a sort — it belongs one level up", () => {
    const config = viewToConfig(view({ options: { columns: ["title"], sort: "due" } }))
    assert.equal(config.columns, undefined)
    assert.equal(config.sort, undefined)
  })

  test("the drawn display is compile's merge, not the authored block", () => {
    const v: UiViewRecord = {
      id: "board",
      route: "/tasks/board",
      scope: "collection",
      collection: "collections/tasks",
      display: { list: { layout: "kanban" } },
      compiled: { display: { list: { layout: "kanban", columns: ["name", "status"], sort: "-due" } } },
    }
    const config = viewToConfig(v)
    assert.equal(config.layout, "kanban")
    assert.deepEqual(config.columns, ["name", "status"], "the collection's columns, carried by the merge")
    assert.equal(config.sort, "-due")
  })
})

describe("ui: a view's route, label and fingerprint", () => {
  const board: UiViewRecord = {
    id: "projects-board",
    route: "/projects-board",
    scope: "collection",
    collection: "collections/projects",
    display: { nav: { title: "Projects board" }, list: { layout: "kanban" } },
  }
  const recordView: UiViewRecord = { id: "task-page", route: "/task", scope: "record", collection: "collections/tasks" }

  test("a collection view's route is a page; a record view's is not", () => {
    assert.equal(viewAt([board, recordView], "/projects-board")?.id, "projects-board")
    assert.equal(viewAt([board, recordView], "/projects-board/"), board)
    assert.equal(viewAt([board, recordView], "/task"), undefined)
    assert.deepEqual(pageOf("/projects-board?filter=x", ["projects"], [board]), { kind: "view", id: "projects-board" })
    assert.equal(pageOf("/task", ["tasks"], [recordView]).kind, "unsupported")
    assert.equal(pageOf("/content/projects?layout=table", ["projects"], [board]).kind, "list")
  })

  test("its label is the nav title, its collection unqualified", () => {
    assert.equal(viewLabel(board), "Projects board")
    assert.equal(viewLabel({ ...board, display: {} }), "projects-board")
    assert.equal(collectionOf(board), "projects")
  })

  test("the fingerprint moves with what the browse consumed, and only with that", () => {
    assert.equal(uiViewFingerprint(board), uiViewFingerprint({ ...board, $module: "default" }))
    assert.notEqual(uiViewFingerprint(board), uiViewFingerprint({ ...board, filter: { status: { _eq: "active" } } }))
    assert.equal(uiViewFingerprint(undefined), "none")
  })

  test("a route's query: read, rewritten, and never part of the path", () => {
    assert.equal(pathOf("/content/tasks?filter=a"), "/content/tasks")
    assert.deepEqual(queryOf("/content/tasks?filter=%7B%7D&layout=table"), { filter: "{}", layout: "table" })
    assert.equal(
      withQuery("/content/tasks", { search: "dana", filter: null, layout: undefined }),
      "/content/tasks?search=dana"
    )
    assert.equal(withQuery("/content/tasks", {}), "/content/tasks")
  })
})
