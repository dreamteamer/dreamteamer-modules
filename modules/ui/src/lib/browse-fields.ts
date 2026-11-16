/**
 * WHICH FIELDS A BROWSE OFFERS, AND WHICH IT SHOWS FIRST — ported from the Vue ui's composables/fields.ts
 * (`visibleFields`) and composables/browse-state.ts (`defaultColumns`), pure so the choice is pinned by a test.
 *
 * The offer is every field some surface draws, plus the computed ones every record has (`$source` where a record
 * can come from elsewhere, module, modified by, created by) — so a column, a filter condition and a group-by axis
 * all see the same set. The default columns are what a collection shows when neither a view nor its own
 * `display.list.columns` names any: a title-ish field first, then status-ish ones, then short scalars, capped —
 * never whatever the descriptor happened to list first (on `tasks` that was a `run` path; on a people list, the
 * markdown body).
 */
import type { FieldRow, SourceEntry } from "../api/types.ts"
import { withComputedRows } from "./computed-fields.ts"
import { choicesOf, drawnOn, isBodyField } from "./field-row.ts"
import { SOURCE_FIELD, withSourceColumn } from "./sources.ts"

/** A field some surface draws — `$source` is the one synthetic key that is a column; every other `$` key is a
 *  wire implicit no surface draws as a field. */
function isVisible(field: FieldRow): boolean {
  if (field.field.startsWith("$") && field.field !== SOURCE_FIELD) return false
  return drawnOn(field, "list") || drawnOn(field, "form") || drawnOn(field, "record")
}

/** The fields a browse of `collection` offers: its visible rows, then the computed ones. */
export function browseFields(
  rows: readonly FieldRow[],
  collection: string,
  sources: readonly SourceEntry[] | undefined
): FieldRow[] {
  return withComputedRows(rows.filter(isVisible), collection, sources)
}

const TITLE_FIELD_NAMES = new Set(["title", "name"])
const STATUS_FIELD_PATTERN = /status|state|stage|priority|kind/i
const SHORT_SCALAR_TYPES = new Set(["string", "date", "datetime", "integer", "number", "boolean", "url", "email"])

/** An object or map (it would print as a blob), the body, and a computed `$` field never make the default cut;
 *  every one of them can still be added as a column. */
function excluded(field: FieldRow): boolean {
  return field.type === "object" || field.type === "map" || isBodyField(field) || field.field.startsWith("$")
}

/** Lower first: 0 title-ish, 1 enum/status-ish, 2 short scalar, 3 the rest. */
function priority(field: FieldRow): number {
  if (TITLE_FIELD_NAMES.has(field.field)) return 0
  if (choicesOf(field) !== null || STATUS_FIELD_PATTERN.test(field.field)) return 1
  if (SHORT_SCALAR_TYPES.has(field.type)) return 2
  return 3
}

/** The heuristic column set, capped at `max`; ties keep the declared order. */
export function defaultColumns(fields: readonly FieldRow[], max = 5): FieldRow[] {
  return fields
    .map((field, index) => ({ field, index }))
    .filter(e => !excluded(e.field))
    .sort((a, b) => priority(a.field) - priority(b.field) || a.index - b.index)
    .slice(0, max)
    .map(e => e.field)
}

/** The columns a browse starts with: the seed's (a view's, else the collection's `display.list.columns`), else the
 *  heuristic — with the Source column joining it when the rows span more than one source. An authored list is
 *  the author's answer and stays as written. */
export function seedColumns(
  named: readonly string[] | null,
  fields: readonly FieldRow[],
  sources: readonly SourceEntry[] | undefined
): string[] {
  if (named) return [...named]
  return withSourceColumn(
    defaultColumns(fields).map(f => f.field),
    sources
  )
}

/** Move the entry at `from` to sit at `to`; out-of-range moves change nothing. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list]
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}

/** A header click: ascending, then descending, on the same field. */
export function toggledSort(current: string, field: string): string {
  return current === field ? `-${field}` : field
}
