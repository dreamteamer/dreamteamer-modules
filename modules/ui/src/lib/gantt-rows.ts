/**
 * The gantt's record-side decisions (ported out of the Vue ui's ListGantt.vue so they can be pinned; the axis
 * itself — scale, ticks, folds, the day → column map — is lib/gantt-axis.ts):
 *
 *   · a record's SPAN: its start and end as day numbers. No start → not placed (the layout lists it in the undated
 *     tail, never drops it). An end before its start is drawn as a point at the start, marked `inverted` — the
 *     picture is how the typo gets found. No end field → every record is a point; an end is never invented.
 *   · the COLOUR map: a value's own enum colour when the field declares one, otherwise a stable slot from a small
 *     palette of theme colour ids — and past the palette, NO colour (neutral) rather than a repeat: two unrelated
 *     lanes drawn identically is a lie that looks like a colour axis. `uncoloured` counts what went neutral.
 *   · a BAND's shape: one segment per RUN of what the lane held (`bandRuns`), never one bar across idle time, and
 *     the line a collapsed lane is read by, counting ACTIVE days.
 *   · a bar's LABEL: the view's `template` as plain one-line text, else the `bar_label` field, else the title. A
 *     template that renders to nothing is a miss, not a label.
 */
import type { FieldRow } from "../api/types.ts"
import { bandRuns, dayKeyOf, dayNumber, rangeLabel, type AxisSpan } from "./gantt-axis.ts"
import { declaredChoicesOf } from "./grouping.ts"
import { tryRenderDisplay } from "./template.ts"

export interface Span<R = Record<string, unknown>> {
  record: R
  title: string
  startKey: string
  endKey: string | null
  start: number
  /** Inclusive last day. Equals `start` for a point AND for an inverted pair. */
  end: number
  inverted: boolean
}

/** The placeable records, in the order given; `titleOf` names each. */
export function spansOf<R extends Record<string, unknown>>(
  records: readonly R[],
  startField: string,
  endField: string | null,
  titleOf: (r: R) => string
): Span<R>[] {
  const out: Span<R>[] = []
  for (const record of records) {
    const startKey = dayKeyOf(record[startField])
    if (!startKey) continue
    const endKey = endField ? dayKeyOf(record[endField]) : null
    const start = dayNumber(startKey)
    const end = endKey ? dayNumber(endKey) : start
    const inverted = end < start
    out.push({
      record,
      title: titleOf(record) || String(record["id"] ?? ""),
      startKey,
      endKey,
      start,
      end: inverted ? start : end,
      inverted,
    })
  }
  return out
}

export const PALETTE = ["charts.blue", "charts.green", "charts.orange", "charts.purple", "charts.red", "charts.yellow"]

const present = (v: unknown) => v !== null && v !== undefined && v !== ""
const valuesIn = (raw: unknown): string[] => (Array.isArray(raw) ? raw : [raw]).filter(present).map(String)

/** value → theme colour id, for the colour axis; and how many distinct values the palette could not colour. */
export function colorMapOf(
  field: FieldRow | null,
  records: readonly Record<string, unknown>[]
): { map: Map<string, string>; uncoloured: number } {
  const map = new Map<string, string>()
  if (!field) return { map, uncoloured: 0 }
  const claimed = new Set<string>()
  const choices = declaredChoicesOf(field)
  for (const choice of choices) {
    const declared = choice.color ?? choice.background
    if (declared) {
      map.set(choice.value, declared)
      claimed.add(declared)
    }
  }
  const free = PALETTE.filter(c => !claimed.has(c))
  const pool = free.length ? free : PALETTE
  const pending: string[] = []
  const seen = new Set<string>()
  const consider = (value: string) => {
    if (!value) return
    seen.add(value)
    if (!map.has(value) && !pending.includes(value)) pending.push(value)
  }
  for (const choice of choices) consider(choice.value)
  for (const record of records) for (const v of valuesIn(record[field.field])) consider(v)
  pending.slice(0, pool.length).forEach((value, i) => map.set(value, pool[i]!))
  return { map, uncoloured: Math.max(0, seen.size - map.size) }
}

/** A bar's colour id — the first present value of the colour field — or null for the neutral. */
export function barColor(record: Record<string, unknown>, field: FieldRow | null, map: Map<string, string>) {
  if (!field) return null
  const first = valuesIn(record[field.field])[0]
  return first === undefined ? null : (map.get(first) ?? null)
}

/** What the bar says: the view's template (plain text, one line), else the named field, else the title. */
export function barLabel(span: Span, template: string | null, labelField: string | null): string {
  if (template) {
    const rendered = (tryRenderDisplay(template, span.record) ?? "").replace(/\s+/g, " ").trim()
    if (rendered) return rendered
  }
  if (!labelField) return span.title
  const raw = span.record[labelField]
  const value = Array.isArray(raw) ? raw.filter(present).join(" · ") : raw
  return present(value) ? String(value) : ""
}

/** A bar's hover sentence — and, for an inverted pair, why it is a point. */
export function barTitle(span: Span): string {
  if (span.inverted)
    return `${span.title} — ${span.endKey} is before ${span.startKey}, so it is drawn as a point at the start`
  return span.endKey && span.endKey !== span.startKey
    ? `${span.title} — ${span.startKey} → ${span.endKey}`
    : `${span.title} — ${span.startKey}`
}

export interface BandShape {
  /** What the lane actually held, as the segments to draw. */
  runs: AxisSpan[]
  startKey: string
  endKey: string
  /** Days the lane HELD — not the envelope, unless it ran once. */
  activeDays: number
}

/** A lane's shape from its placed spans; null when none of its records is placed. */
export function bandShapeOf(spans: readonly Span<unknown>[]): BandShape | null {
  if (!spans.length) return null
  let start = Infinity
  let end = -Infinity
  let startKey = ""
  let endKey = ""
  for (const s of spans) {
    if (s.start < start) {
      start = s.start
      startKey = s.startKey
    }
    if (s.end > end) {
      end = s.end
      endKey = s.endKey ?? s.startKey
    }
  }
  const runs = bandRuns(spans.map(s => ({ start: s.start, end: s.end })))
  return { runs, startKey, endKey, activeDays: runs.reduce((n, r) => n + (r.end - r.start + 1), 0) }
}

/** `Mar 9 – May 10 · 63 days`, or for a lane that stopped and started again `… · 2 runs · 41 days active`. */
export function bandRange(shape: BandShape): string {
  const range = rangeLabel(shape.startKey, shape.endKey)
  const days = `${shape.activeDays} ${shape.activeDays === 1 ? "day" : "days"}`
  return shape.runs.length > 1 ? `${range} · ${shape.runs.length} runs · ${days} active` : `${range} · ${days}`
}
