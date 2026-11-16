// A LOCKED KANBAN CARD KEEPS THE POINTER (ported from the Vue ui's kanban-card-cursor test, cr-vscode-009). A
// card on a board whose column field is locked cannot change column, but a click still opens its record — so it
// keeps the shared record card's pointer. A `cursor` on a kanban card rule would draw the arrow over a clickable card.
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const CSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "styles", "ui.css")

function rules(): Array<{ selector: string; body: string }> {
  const css = fs.readFileSync(CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1]!.trim(), body: m[2]! }))
}

test("the shared record card draws the pointer", () => {
  const card = rules().find(r => r.selector === ".dt-record-card")
  assert.ok(card, "ui.css styles .dt-record-card")
  assert.match(card!.body, /cursor\s*:\s*pointer/)
})

test("no kanban card rule overrides the cursor — a locked card stays clickable-looking", () => {
  const offenders = rules().filter(r => /\.dt-kanban-(card|item)\b/.test(r.selector) && /cursor\s*:/.test(r.body))
  assert.deepEqual(
    offenders.map(r => `${r.selector} { ${r.body.trim()} }`),
    []
  )
})
