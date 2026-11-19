/**
 * THE NAV'S WIDTH (browser shell): a person drags the nav's edge, or focuses it and uses the arrow keys, between a
 * minimum and a maximum; double-click puts it back. The width is kept per browser (localStorage) so a reload keeps it,
 * and everything here works without storage — a private window simply starts at the default each time.
 *
 * The three numbers are tokens (`--dt-nav-width`, `--dt-nav-width-min`, `--dt-nav-width-max`, styles/app.css) so the
 * stylesheet and this file agree; `navWidthBounds` reads them off the root, and the constants below are what a page
 * with no computed style uses. Pure functions plus two storage calls. Ported from the Vue ui's lib/nav-width.ts.
 */

export interface NavWidthBounds {
  min: number
  max: number
  def: number
}

/** What the tokens say when nothing can be read (keep in step with app.css). */
export const NAV_WIDTH_FALLBACK: NavWidthBounds = { min: 180, max: 480, def: 260 }
/** One arrow press; Shift moves four steps. */
export const NAV_WIDTH_STEP = 16
const KEY = "dt.nav.width.v1"

/** A width inside the bounds, rounded to a whole pixel. */
export function clampWidth(w: number, b: NavWidthBounds): number {
  if (!Number.isFinite(w)) return b.def
  return Math.round(Math.min(b.max, Math.max(b.min, w)))
}

/** A `px` token value as a number, or the fallback. */
function px(raw: string | null | undefined, fallback: number): number {
  const n = Number.parseFloat(String(raw ?? "").trim())
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** The bounds as the stylesheet declares them, read off `el` (the document root by default). */
export function navWidthBounds(el?: Element | null): NavWidthBounds {
  try {
    const target = el ?? (typeof document !== "undefined" ? document.documentElement : null)
    const style = target && typeof getComputedStyle === "function" ? getComputedStyle(target) : null
    if (!style) return { ...NAV_WIDTH_FALLBACK }
    const min = px(style.getPropertyValue("--dt-nav-width-min"), NAV_WIDTH_FALLBACK.min)
    const max = Math.max(min, px(style.getPropertyValue("--dt-nav-width-max"), NAV_WIDTH_FALLBACK.max))
    const def = Math.min(max, Math.max(min, px(style.getPropertyValue("--dt-nav-width"), NAV_WIDTH_FALLBACK.def)))
    return { min, max, def }
  } catch {
    return { ...NAV_WIDTH_FALLBACK }
  }
}

/**
 * The width after a key on the separator, or null when the key is not one of its own. `dir` is the nav's text
 * direction: in a right-to-left page the nav's moving edge is its left one, so Left widens it.
 */
export function keyWidth(
  current: number,
  key: string,
  b: NavWidthBounds,
  opts: { shift?: boolean; dir?: "ltr" | "rtl" } = {}
): number | null {
  const step = NAV_WIDTH_STEP * (opts.shift ? 4 : 1)
  const grow = opts.dir === "rtl" ? "ArrowLeft" : "ArrowRight"
  const shrink = opts.dir === "rtl" ? "ArrowRight" : "ArrowLeft"
  if (key === grow) return clampWidth(current + step, b)
  if (key === shrink) return clampWidth(current - step, b)
  if (key === "Home") return b.min
  if (key === "End") return b.max
  return null
}

/** The width while dragging: where the drag started, plus how far the pointer moved toward the page. */
export function dragWidth(
  startWidth: number,
  startX: number,
  x: number,
  b: NavWidthBounds,
  dir: "ltr" | "rtl" = "ltr"
): number {
  return clampWidth(startWidth + (x - startX) * (dir === "rtl" ? -1 : 1), b)
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">

function safeStorage(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

/** The width this browser kept, inside the bounds — or null when it kept none (or storage is off). */
export function loadNavWidth(
  b: NavWidthBounds,
  storage: Pick<Storage, "getItem"> | null = safeStorage()
): number | null {
  try {
    const raw = storage?.getItem(KEY)
    if (raw == null) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? clampWidth(n, b) : null
  } catch {
    return null
  }
}

/** Keep `width`; null forgets it (the double-click reset), so the next load starts at the token's default. */
export function saveNavWidth(
  width: number | null,
  storage: Pick<Storage, "setItem" | "removeItem"> | null = safeStorage()
): void {
  try {
    if (width == null) storage?.removeItem(KEY)
    else storage?.setItem(KEY, String(Math.round(width)))
  } catch {
    // storage off: the width lives for this page only
  }
}
