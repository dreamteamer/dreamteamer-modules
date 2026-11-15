/**
 * What an extension says about a record (`lib/next-notes.ts`): the sentence verbatim, cut at the host's offsets
 * into text and references, a reference this workspace does not hold left as text.
 */
import assert from "node:assert/strict"
import test from "node:test"
import { markTitle, notesOfRow, textParts, type NextNote } from "../src/lib/next-notes.ts"

const note = (text: string, refs: NextNote["refs"] = []): NextNote => ({ id: "brief-dana", text, by: "core", refs })

test("a held reference becomes a link, a missing one stays text, the rest is joined", () => {
  const text = "in session by Dana Oren since 10:02 (sessions/s-1), see tasks/gone"
  const s = text.indexOf("sessions/s-1")
  const g = text.indexOf("tasks/gone")
  const parts = textParts(
    note(text, [
      { ref: "sessions/s-1", start: s, end: s + 12, exists: true },
      { ref: "tasks/gone", start: g, end: g + 10, exists: false },
    ])
  )
  assert.deepEqual(parts, [
    { text: "in session by Dana Oren since 10:02 (" },
    { text: "sessions/s-1", ref: "sessions/s-1" },
    { text: "), see tasks/gone" },
  ])
})

test("an offset that does not match the text is ignored rather than cutting a word in half", () => {
  assert.deepEqual(textParts(note("held by Sam Diaz", [{ ref: "users/sam", start: 0, end: 9, exists: true }])), [
    { text: "held by Sam Diaz" },
  ])
})

test("the row mark's title is every sentence, one per line; a row without notes has none", () => {
  assert.equal(markTitle([note("one"), note("two")]), "one\ntwo")
  assert.deepEqual(notesOfRow({ id: "x" }), [])
  assert.equal(notesOfRow({ $notes: [note("one")] }).length, 1)
})
