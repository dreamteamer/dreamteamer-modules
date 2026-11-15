// Ported from @dreamteamer/ui's test/unit/menu-place.test.ts (imports rewritten to ui2's lib).
// Where a toolbar menu opens (lib/menu-place.ts, the nav toolbar of cr-dt-008's 2026-11-14 revision): under its
// button, by its start or end edge, and always inside the window — a 320 px desktop pane has a ~102 px nav.
import { test } from "node:test"
import assert from "node:assert/strict"
import { menuUnder, rectOf, viewportWidth } from "../src/lib/menu-place.ts"

test("start: the menu's left edge on the button's, 2 px under it", () => {
  assert.deepEqual(menuUnder({ left: 40, right: 64, bottom: 28 }, "start", 220, 1200), { x: 40, y: 30 })
})

test("end: the menu's right edge on the button's", () => {
  assert.deepEqual(menuUnder({ left: 232, right: 256, bottom: 28 }, "end", 220, 1200), { x: 36, y: 30 })
})

test("never off the left edge: an end menu from the right of a 102 px nav opens at the 4 px inset", () => {
  assert.deepEqual(menuUnder({ left: 76, right: 100, bottom: 28 }, "end", 220, 320), { x: 4, y: 30 })
})

test("never off the right edge: a start menu near the window's end is pulled back inside", () => {
  assert.deepEqual(menuUnder({ left: 250, right: 274, bottom: 28 }, "start", 220, 320), { x: 96, y: 30 })
})

test("a window narrower than the menu keeps the left inset", () => {
  assert.deepEqual(menuUnder({ left: 10, right: 30, bottom: 20 }, "start", 220, 200), { x: 4, y: 22 })
})

test("no window width (a test tier) clamps only at the left; no rect opens at the top left", () => {
  assert.deepEqual(menuUnder({ left: 900, right: 924, bottom: 28 }, "start", 220), { x: 900, y: 30 })
  assert.deepEqual(menuUnder(null, "end", 220, 1200), { x: 4, y: 2 })
})

test("rectOf reads an element's rect, or null; viewportWidth reads the window, or undefined", () => {
  assert.equal(rectOf(null), null)
  assert.equal(rectOf({}), null)
  assert.deepEqual(rectOf({ getBoundingClientRect: () => ({ left: 1, right: 2, bottom: 3 }) }), {
    left: 1,
    right: 2,
    bottom: 3,
  })
  const g = globalThis as { window?: unknown }
  const had = g.window
  g.window = { innerWidth: 320 }
  assert.equal(viewportWidth(), 320)
  g.window = {}
  assert.equal(viewportWidth(), undefined)
  g.window = had
})
