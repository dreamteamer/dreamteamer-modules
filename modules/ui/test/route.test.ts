// The routes ui shares with the Vue ui: a collection name may hold `/`, an id may hold `/`, `+` is new.
import { test } from "node:test"
import assert from "node:assert/strict"
import { pageOf, recordRoute, resolveContentPath } from "../src/lib/route.ts"

const COLLECTIONS = ["projects", "tasks", "lab/samples", "lab"]

test("a collection, a record and a new record", () => {
  assert.deepEqual(pageOf("/content/projects", COLLECTIONS), { kind: "list", collection: "projects" })
  assert.deepEqual(pageOf("/content/projects/northwind-launch", COLLECTIONS), {
    kind: "record",
    collection: "projects",
    id: "northwind-launch",
  })
  assert.deepEqual(pageOf("/content/tasks/+", COLLECTIONS), { kind: "create", collection: "tasks" })
})

test("the longest collection name wins, and an id keeps its slashes", () => {
  assert.deepEqual(resolveContentPath("lab/samples/2026/one", COLLECTIONS), {
    collection: "lab/samples",
    id: "2026/one",
    create: false,
  })
  assert.deepEqual(resolveContentPath("lab/other", COLLECTIONS), { collection: "lab", id: "other", create: false })
})

test("home, an unknown collection and a page ui does not draw", () => {
  assert.equal(pageOf("/", COLLECTIONS).kind, "home")
  assert.equal(pageOf("/content/", COLLECTIONS).kind, "home")
  assert.deepEqual(pageOf("/content/nope", COLLECTIONS), { kind: "unknown-collection", path: "nope" })
  assert.deepEqual(pageOf("/projects-board", COLLECTIONS), { kind: "unsupported", route: "/projects-board" })
})

test("an encoded route reads as its name, and a record route round-trips", () => {
  assert.deepEqual(pageOf("/content/lab%2Fsamples", COLLECTIONS), { kind: "list", collection: "lab/samples" })
  const r = recordRoute("lab/samples", "sample-one")
  assert.deepEqual(pageOf(r, COLLECTIONS), { kind: "record", collection: "lab/samples", id: "sample-one" })
})

test("a record-scope ui-view answers <route>/<id> with its collection's record and the view", () => {
  const views = [
    { id: "task-sheet", route: "/task-sheet", scope: "record", collection: "collections/tasks" },
    { id: "projects-board", route: "/projects-board", scope: "collection", collection: "collections/projects" },
  ]
  assert.deepEqual(pageOf("/task-sheet/2026/brief-dana", COLLECTIONS, views), {
    kind: "record",
    collection: "tasks",
    id: "2026/brief-dana",
    viewId: "task-sheet",
  })
  // the bare route names no record, and a record view of a collection this workspace lacks draws nothing
  assert.equal(pageOf("/task-sheet", COLLECTIONS, views).kind, "unsupported")
  assert.equal(
    pageOf("/x/one", COLLECTIONS, [{ id: "x", route: "/x", scope: "record", collection: "collections/nope" }]).kind,
    "unsupported"
  )
  assert.deepEqual(pageOf("/projects-board", COLLECTIONS, views), { kind: "view", id: "projects-board" })
})

test("a module app answers /a/<id> and below; a page view whose layout names an app draws that app", () => {
  assert.deepEqual(pageOf("/a/northwind-stats", COLLECTIONS), { kind: "app", id: "northwind-stats" })
  assert.deepEqual(pageOf("/a/northwind-stats/week/2?x=1", COLLECTIONS), { kind: "app", id: "northwind-stats" })
  assert.equal(pageOf("/a", COLLECTIONS).kind, "unsupported")
  const views = [
    { id: "stats-page", route: "/stats", scope: "page", display: { list: { layout: "northwind-stats" } } },
    { id: "hub", route: "/hub", scope: "page", compiled: { display: { list: { layout: "page" } } } },
  ]
  assert.deepEqual(pageOf("/stats", COLLECTIONS, views), {
    kind: "app-page",
    id: "stats-page",
    layout: "northwind-stats",
  })
  assert.deepEqual(pageOf("/hub", COLLECTIONS, views), { kind: "page-view", id: "hub" })
})
