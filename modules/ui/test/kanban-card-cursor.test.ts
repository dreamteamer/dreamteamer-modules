// A LOCKED KANBAN CARD KEEPS THE POINTER (ported from the Vue ui's kanban-card-cursor test, cr-vscode-009). A
// card on a board whose column field is locked cannot change column, but a click still opens its record — so it
// keeps the shared record card's pointer. A `cursor-*` utility the board adds to a card would draw the arrow over
// a clickable card.
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { recordCard } from "../src/lists/looks.ts"

const KANBAN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "lists", "ListKanban.tsx")

test("the shared record card draws the pointer, tinted or not", () => {
  for (const tinted of [false, true]) assert.match(recordCard(tinted), /(^|\s)cursor-pointer(\s|$)/)
})

test("the board sets no cursor of its own — a locked card stays clickable-looking", () => {
  const source = fs.readFileSync(KANBAN, "utf8")
  assert.deepEqual(source.match(/(^|[\s"'`])cursor-[a-z-]+/g) ?? [], [])
})
