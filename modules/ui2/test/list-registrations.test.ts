// Which Lists ui2 registers, read off registry/register-defaults.ts as TEXT: the registry imports .tsx, which Node
// cannot load, so the declaration is pinned the way the stylesheet is — every layout ui has, under ui's id, the
// counts layout a summary with the row-band options only, and the two canvases filling the browse's height.
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

const text = fs.readFileSync(new URL("../src/registry/register-defaults.ts", import.meta.url), "utf8")
/** Each `lists.register({ … })` call's body, by id. */
const blocks = new Map(
  [...text.matchAll(/lists\.register\(\{\s*id: "([^"]+)"([\s\S]*?)\n\}\)/g)].map(m => [m[1]!, m[2]!])
)

test("every layout @dreamteamer/ui draws is registered under its id", () => {
  assert.deepEqual([...blocks.keys()].sort(), [
    "calendar",
    "cards",
    "carousel",
    "counts",
    "diagram",
    "gantt",
    "kanban",
    "map",
    "table",
  ])
})

test("counts summarizes (no pager) and declares the row-band options only", () => {
  const counts = blocks.get("counts")!
  assert.match(counts, /summarizes: true/)
  assert.match(counts, /options: groupRowsOptions\(\),?\s*$/)
})

test("the gantt and the diagram fill the browse's height; the calendar, carousel and map grow with the page", () => {
  for (const id of ["gantt", "diagram", "table", "kanban"]) assert.match(blocks.get(id)!, /fillsHeight: true/, id)
  for (const id of ["calendar", "carousel", "map", "counts", "cards"])
    assert.doesNotMatch(blocks.get(id)!, /fillsHeight/, id)
})

test("the diagram declares its bigger page, which the browse reads as the default page size", () => {
  assert.match(blocks.get("diagram")!, /field: "page_size",[\s\S]*?default: 500/)
})
