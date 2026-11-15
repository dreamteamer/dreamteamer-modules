/**
 * The record page's small answers (`lib/record-page.ts`): the path row, the commit line, which refusal offers a
 * forced delete, the save chord, what a rename may be, the duplicate-id badge, emptiness, and the one write path
 * a record layout's `setField` goes through.
 */
import assert from "node:assert/strict"
import test from "node:test"
import {
  commitInfo,
  duplicatesOf,
  isEmptyValue,
  isReferencedRefusal,
  isSaveShortcut,
  pathCrumbs,
  renameProblem,
  setEdit,
  withEdits,
} from "../src/lib/record-page.ts"
import { HostError } from "../src/transport/types.ts"

test("the path row: the collection links back to its browse, the id's folders are plain words, a new record ends in new", () => {
  assert.deepEqual(pathCrumbs("tasks", "2026/07/kickoff"), [
    { label: "tasks", to: "/content/tasks" },
    { label: "2026" },
    { label: "07" },
    { label: "kickoff" },
  ])
  assert.deepEqual(pathCrumbs("lab/samples", null), [
    { label: "lab/samples", to: "/content/lab/samples" },
    { label: "new" },
  ])
})

test("the commit line reads the computed keys, either spelling of last-modified, and nothing without an author", () => {
  const record = {
    "$last-modified-by": "Dana Oren",
    "last-modified": "2026-11-15T21:08:00+01:00",
    "$last-commit-message": "fixture: Northwind",
  }
  assert.deepEqual(commitInfo(record), {
    author: "Dana Oren",
    date: "2026-11-15T21:08:00+01:00",
    message: "fixture: Northwind",
  })
  assert.deepEqual(commitInfo({ "$last-modified-by": "Sam Diaz", last_modified: "2026-11-01" }), {
    author: "Sam Diaz",
    date: "2026-11-01",
    message: "",
  })
  assert.equal(commitInfo({ "last-modified": "2026-11-01" }), null)
  assert.equal(commitInfo(null), null)
})

test("only a 409 (or a status-less 'referenced' sentence) offers the forced delete", () => {
  assert.equal(isReferencedRefusal(new HostError("projects/northwind-launch is referenced by: …", 409)), true)
  assert.equal(isReferencedRefusal(new HostError("no such record", 404)), false)
  assert.equal(isReferencedRefusal(new HostError("referenced, but the route is above this pane", 403)), false)
  assert.equal(isReferencedRefusal(new Error("projects/x is referenced by: data/tasks/a.task.md")), true)
  assert.equal(isReferencedRefusal(new Error("disk full")), false)
})

test("Mod-S is Cmd-S or Ctrl-S, never with Alt or Shift", () => {
  const k = (key: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  })
  assert.equal(isSaveShortcut(k("s", { metaKey: true })), true)
  assert.equal(isSaveShortcut(k("S", { ctrlKey: true })), true)
  assert.equal(isSaveShortcut(k("s")), false)
  assert.equal(isSaveShortcut(k("s", { metaKey: true, shiftKey: true })), false)
  assert.equal(isSaveShortcut(k("s", { ctrlKey: true, altKey: true })), false)
  assert.equal(isSaveShortcut(k("d", { metaKey: true })), false)
})

test("a rename names what the page can know; the engine says the rest", () => {
  assert.equal(renameProblem("brief-dana", "brief-dana-oren"), null)
  assert.equal(renameProblem("2026/07/kickoff", "2026/08/kickoff"), null)
  assert.match(renameProblem("a", "  ")!, /Type/)
  assert.match(renameProblem("a", "a")!, /already/)
  assert.match(renameProblem("a", "/b")!, /starts nor ends/)
  assert.match(renameProblem("a", "b/")!, /starts nor ends/)
  assert.match(renameProblem("a", "b//c")!, /segments/)
  assert.match(renameProblem("a", "../b")!, /segments/)
  assert.match(renameProblem("a", "b c")!, /spaces/)
})

test("the duplicate-id badge: two or more roots, the first being the one read", () => {
  assert.deepEqual(duplicatesOf({ $duplicates: ["lab", "northwind-archive"] }), ["lab", "northwind-archive"])
  assert.equal(duplicatesOf({ $duplicates: ["lab"] }), null)
  assert.equal(duplicatesOf({}), null)
  assert.equal(duplicatesOf(null), null)
})

test("empty is null, undefined, '' and []; false and 0 are values", () => {
  for (const v of [null, undefined, "", []]) assert.equal(isEmptyValue(v), true)
  for (const v of [false, 0, "x", ["a"], {}]) assert.equal(isEmptyValue(v), false)
})

test("setEdit: a changed value is an edit, typing the read value back drops it, lists compare by value", () => {
  const read = { name: "Brief Dana", tags: ["a"], done: null }
  let edits: Record<string, unknown> = {}
  edits = setEdit(edits, read, "name", "Brief Dana Oren")
  assert.deepEqual(edits, { name: "Brief Dana Oren" })
  edits = setEdit(edits, read, "name", "Brief Dana")
  assert.deepEqual(edits, {})
  const same = setEdit(edits, read, "tags", ["a"])
  assert.equal(same, edits, "an unchanged value leaves the very same map")
  assert.deepEqual(setEdit({}, read, "done", undefined), {}, "undefined reads as the null it was")
  assert.deepEqual(
    setEdit({}, null, "name", "Call Sam Diaz"),
    { name: "Call Sam Diaz" },
    "a new record edits from nothing"
  )
  assert.deepEqual(withEdits(read, { name: "x" }), { name: "x", tags: ["a"], done: null })
  assert.deepEqual(withEdits(null, { name: "x" }), { name: "x" })
})
