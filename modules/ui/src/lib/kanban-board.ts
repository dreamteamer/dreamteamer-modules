/**
 * THE BOARD'S DECISIONS, pure — which field makes the columns and which the lanes, and what a drop WRITES. The
 * kanban (`lists/ListKanban.tsx`, ported from the Vue ui's ListKanban.vue) only draws and calls these, so
 * every rule a drag obeys is pinned in a test without a renderer.
 *
 * Two axes, named for the axis: `lanes_by` makes the COLUMNS (defaulting to the first field with `choices`),
 * `group_by` the horizontal bands every list has (never inferred — blank or a field the collection lacks means no
 * bands, so a typo never erases the board).
 *
 * A drop is one or two independent writes to one record, each validated by the engine:
 *  - onto a COLUMN: the column field, set to the column's value (`null` on the ungrouped column) — nothing when
 *    the card is already there, the column field is locked (`lib/kanban-lock.ts`; a text selection dragged out
 *    of a card still fires `dragstart`, so the guard is here, not only on `draggable`), or the field may not be
 *    empty;
 *  - into a GAP between cards, while the list is sorted by the collection's `position_field`: the column field
 *    when it changes (never on a locked board, whose gaps are live only in the card's own column), then the
 *    position — `{ before: <the card below> }`, or `{ bottom: true }` past the last card. The key itself is the
 *    engine's to compute; nothing here spells the alphabet.
 */
import type { FieldRow } from "../api/types.ts"
import { choicesOf } from "./field-row.ts"

/** The COLUMN field: the `lanes_by` option when it names a field, else the first field declaring choices. */
export function columnFieldOf(fields: readonly FieldRow[], options: Record<string, unknown>): FieldRow | null {
  const named = options["lanes_by"]
  if (typeof named === "string" && named.length) return fields.find(f => f.field === named) ?? null
  return fields.find(f => choicesOf(f) !== null) ?? null
}

/** The LANE field: only ever the `group_by` option, never inferred. */
export function laneFieldOf(fields: readonly FieldRow[], options: Record<string, unknown>): FieldRow | null {
  const named = options["group_by"]
  if (typeof named !== "string" || !named.length) return null
  return fields.find(f => f.field === named) ?? null
}

/** Where a gap sits: before a card, or after the last one (`above: null`). */
export interface Gap {
  above: string | null
}

export interface DropInput {
  /** The dragged record's id. */
  id: string
  /** Its column value now (`""` when empty). */
  current: string
  /** The column field's name. */
  field: string
  /** The column dropped into. */
  target: { value: string; ungrouped?: boolean }
  /** The column field may not be written here (`kanbanLock(...).columns`). */
  locked: boolean
  /** The column field may be emptied (`ungroupedAllowed`). */
  ungroupedAllowed: boolean
  /** Dropped into a gap rather than onto the column. */
  gap?: Gap
  /** Manual order is on (the list is sorted by the position field). */
  reorder?: boolean
  /** The gap is in the column the drag started from. */
  sameColumn?: boolean
}

export type PositionWrite = { before: string } | { bottom: true }

export interface DropPlan {
  /** The PATCH to the record, or null when its column does not change. */
  fields: Record<string, unknown> | null
  /** The position move, or null when the drop was onto the column itself. */
  position: PositionWrite | null
}

/** What a drop writes — or null when it writes nothing. */
export function planDrop(input: DropInput): DropPlan | null {
  const { id, current, field, target, locked, ungroupedAllowed, gap } = input
  if (target.ungrouped && !ungroupedAllowed) return null
  const next = target.ungrouped ? null : target.value
  const changes = current !== (next ?? "")
  if (!gap) {
    if (locked || !changes) return null
    return { fields: { [field]: next }, position: null }
  }
  if (!input.reorder) return null
  if (locked && !input.sameColumn) return null
  if (gap.above === id) return null // its own gap
  return {
    fields: !locked && changes ? { [field]: next } : null,
    position: gap.above ? { before: gap.above } : { bottom: true },
  }
}

/** The column `+`'s prefill: the column's value, and the lane's too when the board is laned, the lane is a real
 *  value and the create form would draw that field. */
export function addPrefill(
  column: { field: string; value: string },
  lane: { field: string; value: string; ungrouped?: boolean; prefill: boolean } | null
): Record<string, unknown> {
  const prefill: Record<string, unknown> = { [column.field]: column.value }
  if (lane && lane.prefill && !lane.ungrouped) prefill[lane.field] = lane.value
  return prefill
}
