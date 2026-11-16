// The place a page reports (lib/pane-place.ts) — ported from the Vue ui's test/unit/pane-place.test.ts, over
// ui's `pageOf` instead of a vue-router route. Four shapes only, and a namespaced collection keeps its slash.
import { test } from "node:test"
import assert from "node:assert/strict"
import { placeOf, pushedIds, splitPaneRef } from "../src/lib/pane-place.ts"
import { pageOf } from "../src/lib/route.ts"

const COLLECTIONS = ["tasks", "rnd/change-requests", "rnd", "meetings"]
const VIEWS = [
  { id: "tasks-board", route: "/tasks-board", scope: "collection" },
  { id: "inbox", route: "/inbox", scope: "record", collection: "collections/tasks" },
]
const at = (route: string) => placeOf(pageOf(route, COLLECTIONS, VIEWS))

test("a collection list is { collection }", () => {
  assert.deepEqual(at("/content/tasks"), { collection: "tasks" })
  assert.deepEqual(at("/content/tasks?filter=x"), { collection: "tasks" })
})

test("a record is { collection, id }, the id keeping its own slashes", () => {
  assert.deepEqual(at("/content/tasks/call-the-bank"), { collection: "tasks", id: "call-the-bank" })
  assert.deepEqual(at("/content/meetings/2026/11/standup"), { collection: "meetings", id: "2026/11/standup" })
})

test("a namespaced collection keeps its slash: the longest registered prefix wins", () => {
  assert.deepEqual(at("/content/rnd/change-requests"), { collection: "rnd/change-requests" })
  assert.deepEqual(at("/content/rnd/change-requests/cr-x"), { collection: "rnd/change-requests", id: "cr-x" })
})

test("the create page is the collection; an unknown collection is other", () => {
  assert.deepEqual(at("/content/tasks/+"), { collection: "tasks" })
  assert.deepEqual(at("/content/nope/x"), { other: true })
})

test("a ui-view route is { uiView } — a collection-scope view, and a record-scope view's record", () => {
  assert.deepEqual(at("/tasks-board"), { uiView: "tasks-board" })
  assert.deepEqual(at("/inbox/x"), { uiView: "inbox" })
})

test("home, settings and anything else is { other: true }", () => {
  assert.deepEqual(at("/"), { other: true })
  assert.deepEqual(at("/settings/schema/activity"), { other: true })
  assert.deepEqual(at("/module/x"), { other: true })
})

test("splitPaneRef splits a reference at the end of the longest registered collection", () => {
  assert.deepEqual(splitPaneRef("rnd/change-requests/cr-x", COLLECTIONS), {
    collection: "rnd/change-requests",
    id: "cr-x",
  })
  assert.deepEqual(splitPaneRef("tasks/a/b", COLLECTIONS), { collection: "tasks", id: "a/b" })
  assert.equal(splitPaneRef("nope/a", COLLECTIONS), null)
  assert.equal(splitPaneRef("tasks", COLLECTIONS), null)
})

test("pushedIds: this collection's ids; [] clears; a push for another collection stays held (null)", () => {
  assert.deepEqual(pushedIds({ refs: ["tasks/a", "tasks/b/c"] }, "tasks"), ["a", "b/c"])
  assert.deepEqual(pushedIds({ refs: [] }, "tasks"), [])
  assert.equal(pushedIds({ refs: ["meetings/x"] }, "tasks"), null)
})
