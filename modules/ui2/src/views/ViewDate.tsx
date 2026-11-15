/**
 * `date` — a date or a datetime, in the viewer's locale. A DATE is a calendar day read as written, never shifted
 * across a timezone; a datetime is compact in a cell and long on the record page. `viewer_options.relative`
 * draws "3 days ago". The stored value is the hover.
 */
import { relativeTime } from "../lib/relative-time.ts"
import type { ViewProps } from "../registry/props.ts"
import { Empty, isEmpty } from "./empty.tsx"

export function formatDate(value: string, type: string, context: "cell" | "record", relative = false): string {
  const dateOnly = type === "date" || /^\d{4}-\d{2}-\d{2}$/.test(value)
  if (dateOnly) {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number)
    const day = new Date(y!, (m ?? 1) - 1, d ?? 1)
    if (isNaN(day.getTime())) return value
    if (relative) return relativeTime(day)
    return day.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
  }
  const at = new Date(value)
  if (isNaN(at.getTime())) return value
  if (relative) return relativeTime(at)
  return at.toLocaleString(
    undefined,
    context === "record"
      ? { dateStyle: "long", timeStyle: "short" }
      : { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
  )
}

export function ViewDate({ field, value, context, options }: ViewProps) {
  if (isEmpty(value) || typeof value !== "string") return isEmpty(value) ? <Empty /> : <span>{String(value)}</span>
  return (
    <span className="ui2-nowrap" title={value}>
      {formatDate(value, field.type, context, Boolean(options?.["relative"]))}
    </span>
  )
}
