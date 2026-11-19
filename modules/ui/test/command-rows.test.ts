/** One row of the Commands panel (`lib/commandRows.ts`): its state word or counts, and a codicon for its icon. */
import assert from "node:assert/strict"
import test from "node:test"
import { commandAllDone, commandIcon, commandStatus, type CommandRow } from "../src/lib/commandRows.ts"

const row = (over: Partial<CommandRow> = {}): CommandRow => ({
  binding: "command-bindings/review-project--projects",
  command: "commands/review-project",
  name: "review-project",
  description: "review an active project",
  "argument-hint": "<projects/id>",
  scope: "record",
  invocation: "/review-project projects/northwind-launch",
  ...over,
})

test("one record reads as a state word, a selection as counts, a collection command as itself", () => {
  assert.equal(commandStatus(row({ states: { a: "available" } }), ["a"]), "available")
  assert.equal(commandStatus(row({ states: { a: "done" } }), ["a"]), "done")
  assert.equal(commandStatus(row({ states: {} }), ["a"]), "not applicable")
  assert.equal(commandStatus(row(), []), "no record selected")
  assert.equal(commandStatus(row({ eligible: ["a"], done: ["b"] }), ["a", "b", "c"]), "1/3 eligible, 1 done")
  assert.equal(commandStatus(row({ scope: "collection" }), ["a"]), "collection")
})

test("done everywhere it applies, and icons the codicon font draws", () => {
  assert.equal(commandAllDone(row({ done: ["a"] }), ["a"]), true)
  assert.equal(commandAllDone(row({ done: [] }), ["a"]), false)
  assert.equal(commandIcon(row({ scope: "collection" })), "database")
  assert.equal(commandIcon(row({ done: ["a"], eligible: [] })), "pass")
  assert.equal(commandIcon(row({ eligible: ["a"] })), "terminal")
})
