/**
 * WHICH RECORD DISPLAY A RECORD PAGE DRAWS — pure, so the precedence is a test rather than a page.
 *
 * Descriptor v2 (§3.5): a collection's `display.record` is its default record page, and a
 * `scope: record` ui-view is a named variant whose `compiled.display.record` is that block merged
 * over the collection's. There is no `target: item, default: true` view any more.
 *
 * The engine's default record layout is `page` — "the built-in record page" — so it selects no
 * renderer of its own: `layout` is answered only for another name, and the caller's built-in
 * default (`properties`) stands otherwise.
 *
 * Copied from @dreamteamer/ui's lib/record-display.ts; `recordRendererId` is ui's `lib/presets.ts` item-target
 * resolution, without the `.schema/presets` path ui's adapter answers with nothing.
 */
import type { UiViewRecord } from "./ui-views.ts"
import { drawnDisplay } from "./ui-views.ts"

export interface RecordDisplay {
  /** A registered record renderer id, or undefined for the built-in record page. */
  layout?: string
  /** The renderer's options — where `relation_views` is authored. */
  options?: Record<string, unknown>
}

/** The engine's name for the built-in record page. */
export const DEFAULT_RECORD_LAYOUT = "page"

export function recordDisplayOf(
  view: UiViewRecord | undefined,
  collectionRecord: { layout?: string; options?: Record<string, unknown> } | undefined
): RecordDisplay {
  const block = (view?.scope === "record" ? drawnDisplay(view).record : undefined) ?? collectionRecord ?? {}
  const layout =
    typeof block.layout === "string" && block.layout && block.layout !== DEFAULT_RECORD_LAYOUT
      ? block.layout
      : undefined
  const options =
    block.options && typeof block.options === "object" && !Array.isArray(block.options)
      ? (block.options as Record<string, unknown>)
      : undefined
  return { ...(layout ? { layout } : {}), ...(options ? { options } : {}) }
}

/**
 * The built-in record layout when the display names none (or `page`): `properties`, the read-first page of
 * one-line `icon · label · value` rows. `form` (a record-scoped Edit) and `doc` (its read-only View) stay
 * registered, so a display naming either still gets the two-column form. (@dreamteamer/ui's
 * `lib/presets.ts#builtinRenderer` for an item target; ui2 reads no `.schema/presets`, which ui's adapter
 * answers with `[]` anyway.)
 */
export const BUILTIN_RECORD_LAYOUT = "properties"

/**
 * The record renderer to draw, given the display's layout, the page's mode and what the registries hold
 * (`has(id, mode)` — a record-scoped View for `view`, a record-scoped Edit for `edit`). A layout no registry
 * holds for that mode falls back to the built-in rather than blanking the page (ui's `resolveRendererEntry`),
 * and says so once in the console.
 */
export function recordRendererId(
  layout: string | undefined,
  mode: "view" | "edit",
  has: (id: string, mode: "view" | "edit") => boolean
): string {
  if (layout && has(layout, mode)) return layout
  if (layout && layout !== BUILTIN_RECORD_LAYOUT)
    console.warn(
      `[record-display] '${layout}' is not a registered record ${mode === "view" ? "View" : "Edit"} — falling back to ${BUILTIN_RECORD_LAYOUT}`
    )
  return BUILTIN_RECORD_LAYOUT
}
