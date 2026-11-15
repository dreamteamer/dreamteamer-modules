// The routes ui2 shares with @dreamteamer/ui: a collection name may hold `/`, an id may hold `/`, `+` is new.
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

test("home, an unknown collection and a page ui2 does not draw", () => {
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
