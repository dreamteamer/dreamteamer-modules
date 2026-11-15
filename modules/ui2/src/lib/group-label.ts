/**
 * WHAT A BAND IS CALLED WHEN ITS VALUE IS A REFERENCE — the pure half of @dreamteamer/ui's lib/group-label.ts; the
 * fetching half is the hook `lists/use-group-labels.ts`.
 *
 * A grouped layout's band value is whatever the field holds. For an enum that is a declared choice with an
 * authored label, and `bucketize` uses it. For a REFERENCE it is a workspace path, and the band would print the
 * whole path or `referenceLabel`'s de-slugged last segment — both guesses at a name the referenced record already
 * carries. So a band names its record the way a relation cell does: the target collection's `record_title`.
 *
 * Three sources for a band's label, in order, first non-empty wins:
 *   1. the VIEW's own `group_title` option — this view, this axis, an author's explicit choice;
 *   2. the TARGET collection's `record_title` — what a relation cell for that reference shows;
 *   3. `referenceLabel(value)` — the de-slugged last segment, still right for a value that references nothing.
 *
 * Resolution never blocks a paint: labels start at (3) and are replaced as fetches land.
 */
import type { CollectionRow } from "../api/types.ts"
import { referenceLabel } from "./grouping.ts"

/**
 * `/perspective/topics/2026-09-07--northwind/decision-log` + target `perspective/topics`
 * → `2026-09-07--northwind/decision-log`.
 *
 * ⚠ THE TARGET IS REQUIRED, and cannot be inferred from the string: a collection name may contain slashes (a
 * namespace) and so may an id, so no position in the path says where the collection ends.
 */
export function idFor(value: string, target: string): string {
  const norm = value.startsWith("/") ? value.slice(1) : value
  return norm.startsWith(`${target}/`) ? norm.slice(target.length + 1) : norm
}

/** The template a band's NAME renders through: the view's own `group_title`, else the target collection's
 *  `record_title` — what a relation cell for the same reference shows — else null. */
export function bandTitleTemplate(
  viewTemplate: string | null,
  target: CollectionRow | null | undefined
): string | null {
  if (viewTemplate) return viewTemplate
  const t = target?.record_title
  return typeof t === "string" && t.length > 0 ? t : null
}

/** The fields probed for a band's picture when the view names none, in order of specificity. */
export const ICON_FIELDS = ["avatar", "icon", "image"] as const

/** The picture a resolved record offers, or null. Taken verbatim: the band header tells a codicon name from a
 *  file reference itself. */
export function iconOf(record: Record<string, unknown>, named: string | null): string | null {
  for (const key of named ? [named] : ICON_FIELDS) {
    const v = record[key]
    if (typeof v === "string" && v) return v
  }
  return null
}

/**
 * The label to DRAW: the resolved one when it has landed, else what `bucketize` already computed, else the
 * de-slugged path. ⚠ EMPTY is a miss, not a value — `??` would accept `''` and print a nameless band.
 */
export function labelFor(value: string, fallback: string, resolved: Record<string, string>): string {
  return resolved[value] || fallback || referenceLabel(value)
}
