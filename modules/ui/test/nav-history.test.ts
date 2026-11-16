// Back and forward (lib/nav-history.ts): a browser's rule — a new place truncates what was ahead — except that a
// move changing only the query (the browse writing `?filter=` back) replaces the entry rather than adding one.
import { test } from "node:test"
import assert from "node:assert/strict"
import { canBack, canForward, peek, step, visit, type HistoryState } from "../src/lib/nav-history.ts"

const empty: HistoryState = { entries: [], at: -1 }
const walk = (...routes: string[]) => routes.reduce(visit, empty)

test("the first place has nothing behind it", () => {
  const h = walk("/content/tasks")
  assert.deepEqual(h, { entries: ["/content/tasks"], at: 0 })
  assert.equal(canBack(h), false)
  assert.equal(canForward(h), false)
})

test("back and forward move along the entries; peek names where they go", () => {
  let h = walk("/content/tasks", "/content/notes", "/content/projects")
  assert.equal(peek(h, -1), "/content/notes")
  h = step(h, -1)
  h = step(h, -1)
  assert.equal(h.at, 0)
  assert.equal(canBack(h), false)
  assert.equal(canForward(h), true)
  assert.equal(peek(h, 1), "/content/notes")
  assert.equal(peek(h, -1), null)
  assert.deepEqual(step(h, -1), h, "no step past the start")
})

test("a new place after going back truncates what was ahead", () => {
  let h = walk("/a", "/b", "/c")
  h = step(h, -1)
  h = visit(h, "/d")
  assert.deepEqual(h, { entries: ["/a", "/b", "/d"], at: 2 })
  assert.equal(canForward(h), false)
})

test("the same path with another query replaces the entry — Back leaves the list, not the last keystroke", () => {
  const h = walk("/content/tasks", "/content/tasks?search=c", "/content/tasks?search=ca", "/content/notes")
  assert.deepEqual(h.entries, ["/content/tasks?search=ca", "/content/notes"])
  assert.equal(peek(h, -1), "/content/tasks?search=ca")
})

test("visiting the place already shown changes nothing", () => {
  const h = walk("/a")
  assert.equal(visit(h, "/a"), h)
})
