/**
 * The built-in Views every list and record page needs — the ids @dreamteamer/ui registers (`text`, `label`,
 * `boolean`, `date`, `relation`, `markdown`, `tags`, `json`). A cell is one tight line; a record shows the
 * whole value.
 */
import type { CSSProperties } from "react"
import { useApp } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { Link } from "../components/Link.tsx"
import { choiceOf, themeColor } from "../lib/collection-display.ts"
import { splitRef } from "../lib/schema.ts"
import { recordRoute } from "../lib/route.ts"
import type { ViewProps } from "../registry/props.ts"

const empty = <span className="ui2-empty">—</span>
const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)
const CELL_MAX = 80

export function ViewText({ value, context }: ViewProps) {
  if (isEmpty(value)) return empty
  const s = typeof value === "object" ? JSON.stringify(value) : String(value)
  if (context === "record") {
    // a whole-value URL or address is a link on the record page; never inside a cell's clickable row
    if (/^https?:\/\/\S+$/.test(s))
      return (
        <a href={s} target="_blank" rel="noopener noreferrer">
          {s}
        </a>
      )
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return <a href={`mailto:${s}`}>{s}</a>
    return <span className="ui2-wrap">{s}</span>
  }
  return <span title={s.length > CELL_MAX ? s : undefined}>{s.length > CELL_MAX ? `${s.slice(0, CELL_MAX)}…` : s}</span>
}

export function chipStyle(color?: string, background?: string): CSSProperties | undefined {
  if (!color && !background) return undefined
  const style: Record<string, string> = {}
  if (color) style["--chip"] = themeColor(color)
  if (background) style["--chip-bg"] = themeColor(background)
  return style as CSSProperties
}

/** An enum value as its choice: the label, its icon, its colour. A value outside the enum shows as itself. */
export function ViewLabel({ field, value }: ViewProps) {
  if (isEmpty(value)) return empty
  const values = Array.isArray(value) ? value : [value]
  return (
    <span className="ui2-chips">
      {values.map(v => {
        const c = choiceOf(field, v)
        return (
          <span key={String(v)} className="ui2-chip" style={chipStyle(c?.color, c?.background)} title={c?.description}>
            {c?.icon && <Icon name={c.icon} />}
            {c?.label ?? String(v)}
          </span>
        )
      })}
    </span>
  )
}

export function ViewBoolean({ value }: ViewProps) {
  if (value === null || value === undefined) return empty
  return <Icon name={value ? "check" : "dash"} className={value ? "ui2-yes" : "ui2-subtle"} />
}

/** A date never shifts a day (read as written, not as UTC); a datetime reads in the viewer's locale. */
export function ViewDate({ field, value, context }: ViewProps) {
  if (isEmpty(value)) return empty
  const s = String(value)
  if (field.type === "date" || /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-").map(Number)
    const date = new Date(y!, (m ?? 1) - 1, d ?? 1)
    return (
      <span title={s}>{isNaN(date.getTime()) ? s : date.toLocaleDateString(undefined, { dateStyle: "medium" })}</span>
    )
  }
  const date = new Date(s)
  if (isNaN(date.getTime())) return <span>{s}</span>
  return (
    <span title={s}>
      {date.toLocaleString(
        undefined,
        context === "record" ? { dateStyle: "long", timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" }
      )}
    </span>
  )
}

/** References as links to their records. In a cell, a click on a link opens the record, not the row. */
export function ViewRelation({ value }: ViewProps) {
  const { schema } = useApp()
  if (isEmpty(value)) return empty
  const refs = (Array.isArray(value) ? value : [value]).map(String)
  return (
    <span className="ui2-refs">
      {refs.map(ref => {
        const at = splitRef(ref, schema.names)
        if (!at) return <span key={ref}>{ref}</span>
        return (
          <span key={ref} onClick={e => e.stopPropagation()}>
            <Link to={recordRoute(at.collection, at.id)} className="ui2-ref">
              {at.id}
            </Link>
          </span>
        )
      })}
    </span>
  )
}

/** Markdown as text for now: one stripped line in a cell, the source with its line breaks on a record.
 *  (Step 2 renders it.) */
export function ViewMarkdown({ value, context }: ViewProps) {
  if (isEmpty(value)) return empty
  const s = String(value)
  if (context === "cell") {
    const line = s
      .replace(/[#>*_`]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
    return <span>{line.length > CELL_MAX ? `${line.slice(0, CELL_MAX)}…` : line}</span>
  }
  return <div className="ui2-body">{s}</div>
}

export function ViewTags({ value }: ViewProps) {
  if (isEmpty(value)) return empty
  const values = Array.isArray(value) ? value : [value]
  return (
    <span className="ui2-chips">
      {values.map((v, i) => (
        <span key={i} className="ui2-chip">
          {typeof v === "object" ? JSON.stringify(v) : String(v)}
        </span>
      ))}
    </span>
  )
}

export function ViewJson({ value, context }: ViewProps) {
  if (isEmpty(value)) return empty
  if (context === "cell") return <span className="ui2-mono">{JSON.stringify(value)}</span>
  return <pre className="ui2-pre">{JSON.stringify(value, null, 2)}</pre>
}
