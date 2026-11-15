/**
 * Where a menu that hangs from a toolbar button opens (the nav's toolbar, cr-dt-008's 2026-11-14 revision): under
 * the button, its start edge on the button's (`start`) or its end edge on the button's (`end`), and always inside the
 * window — a desktop side pane can be 320 px wide and the nav a third of that, so a menu hung from the nav's right
 * end would otherwise open off the left of the screen. The menus are `position: fixed`, so the numbers are viewport
 * coordinates. With no rect (a test tier, a button not laid out) the menu opens at the window's top left.
 */
export interface MenuRect {
  left: number
  right: number
  bottom: number
}

/** The inset a menu keeps from the window's edges. */
const EDGE = 4

export function menuUnder(
  rect: MenuRect | null | undefined,
  align: "start" | "end",
  width: number,
  viewportWidth?: number
): { x: number; y: number } {
  const r = rect ?? { left: 0, right: 0, bottom: 0 }
  const vw = typeof viewportWidth === "number" && viewportWidth > 0 ? viewportWidth : Number.POSITIVE_INFINITY
  const want = align === "end" ? r.right - width : r.left
  const x = Math.max(EDGE, Math.min(want, vw - width - EDGE))
  return { x, y: r.bottom + 2 }
}

/** The rect of the element an event came from, or of `el` — null when it has none (a test tier). */
export function rectOf(el: unknown): MenuRect | null {
  const r = (el as { getBoundingClientRect?: () => MenuRect } | null | undefined)?.getBoundingClientRect?.()
  return r && typeof r.left === "number" ? r : null
}

/** The window's width, when there is a window that has one. */
export function viewportWidth(): number | undefined {
  const w = (globalThis as { window?: { innerWidth?: unknown } }).window
  return typeof w?.innerWidth === "number" ? w.innerWidth : undefined
}
