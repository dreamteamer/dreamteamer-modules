/** Leaving a page with unsaved edits (`lib/leave-guard.ts`): a query-only move always passes; a path move asks. */
import assert from "node:assert/strict"
import test from "node:test"
import { mayLeave, setLeaveGuard } from "../src/lib/leave-guard.ts"

test("no guard: every move passes", () => {
  assert.equal(mayLeave("/content/tasks/a", "/content/projects"), true)
})

test("a guard decides a path move, never a query move, and uninstalls only itself", () => {
  let answer = false
  let asked = 0
  const off = setLeaveGuard(() => {
    asked++
    return answer
  })
  assert.equal(mayLeave("/content/tasks/a", "/content/tasks/a?tab=x"), true)
  assert.equal(asked, 0)
  assert.equal(mayLeave("/content/tasks/a", "/content/projects"), false)
  answer = true
  assert.equal(mayLeave("/content/tasks/a", "/content/projects"), true)
  assert.equal(asked, 2)
  const offOther = setLeaveGuard(() => false)
  off() // the first guard's uninstall leaves the newer one in place
  assert.equal(mayLeave("/a", "/b"), false)
  offOther()
  assert.equal(mayLeave("/a", "/b"), true)
})
