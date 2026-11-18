// The keyboard of a hanging menu (lib/menuKeys.ts, ported from the Vue ui): focus to the first item on open,
// Tab / arrows cycle and never leave, Escape and a pick that stays close it and give focus back to the button.
import { test } from "node:test"
import assert from "node:assert/strict"
import { menuKeys } from "../src/lib/menuKeys.ts"

function setup(n: number) {
  let focused = ""
  let closed = 0
  const el = (name: string) => ({ name, focus: () => (focused = name) })
  const items = Array.from({ length: n }, (_, i) => el(`item${i}`))
  const keys = menuKeys({
    items: () => items,
    menu: () => el("menu"),
    button: () => el("button"),
    close: () => closed++,
    defer: f => f(),
  })
  return { keys, items, focused: () => focused, closed: () => closed }
}
const key = (k: string, shiftKey = false) => ({ key: k, shiftKey, preventDefault() {}, stopPropagation() {} })

test("opened focuses the first item; with none, the menu itself", () => {
  const a = setup(3)
  a.keys.opened()
  assert.equal(a.focused(), "item0")
  const b = setup(0)
  b.keys.opened()
  assert.equal(b.focused(), "menu")
})

test("Tab, ArrowDown and ArrowUp cycle the items and wrap", () => {
  const a = setup(3)
  a.keys.opened()
  a.keys.keydown(key("ArrowDown"))
  assert.equal(a.focused(), "item1")
  a.keys.keydown(key("Tab"))
  a.keys.keydown(key("Tab"))
  assert.equal(a.focused(), "item0", "wrapped past the end")
  a.keys.keydown(key("ArrowUp"))
  assert.equal(a.focused(), "item2", "wrapped past the start")
  a.keys.keydown(key("Tab", true))
  assert.equal(a.focused(), "item1")
})

test("a click moves the cursor with it", () => {
  const a = setup(3)
  a.keys.opened()
  a.keys.focusin({ target: a.items[2] })
  a.keys.keydown(key("ArrowDown"))
  assert.equal(a.focused(), "item0")
})

test("Escape and a pick that stays close the menu and give focus back to the button", () => {
  const a = setup(2)
  a.keys.opened()
  a.keys.keydown(key("Escape"))
  assert.equal(a.closed(), 1)
  assert.equal(a.focused(), "button")
  a.keys.opened()
  a.keys.done()
  assert.equal(a.closed(), 2)
  assert.equal(a.focused(), "button")
})
