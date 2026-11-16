/**
 * `text` — a value as text. A cell is one tight line, clipped at CELL_MAX with the whole value on hover; the
 * record page shows all of it, wrapping. On the record page a WHOLE-VALUE URL or address is a link, and a
 * workspace-relative `.html` path opens through the host (`dt:open-file`) — whole-value only, because a false
 * positive inside a sentence is worse than a missed link; and never in a cell, where a link would hijack the
 * row's own click. `dir="auto"` per value: a Hebrew string must not take the page's LTR base.
 */
import { notify } from "../api/client.ts"
import { formatWithUnit } from "../lib/field-unit.ts"
import type { ViewProps } from "../registry/props.ts"
import { CELL_MAX, Empty, isEmpty } from "./Empty.tsx"
import { wrap } from "../styles/classes.ts"

const LOCAL_PAGE = /^(?!\/)(?!.*(?:^|[/\\])\.\.(?:[/\\]|$))[\w./-]+\.html?$/i

export function ViewText({ field, value, context, record }: ViewProps) {
  if (isEmpty(value)) return <Empty />
  // a number with a declared unit reads with it (`12` → `12%`, a currency from its sibling field)
  const s = formatWithUnit(field, value, record) ?? (typeof value === "object" ? JSON.stringify(value) : String(value))
  if (context === "record") {
    const v = s.trim()
    if (/^https?:\/\/\S+$/i.test(v))
      return (
        <a className={wrap} href={v} target="_blank" rel="noopener noreferrer" dir="auto">
          {s}
        </a>
      )
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
      return (
        <a className={wrap} href={`mailto:${v}`} dir="auto">
          {s}
        </a>
      )
    if (LOCAL_PAGE.test(v))
      return (
        <a
          className={wrap}
          href="#"
          dir="auto"
          title="Open in browser"
          onClick={e => {
            e.preventDefault()
            notify("dt:open-file", { path: v })
          }}
        >
          {s}
        </a>
      )
    return (
      <span className={wrap} dir={field.direction ?? "auto"}>
        {s}
      </span>
    )
  }
  return (
    <span title={s.length > CELL_MAX ? s : undefined} dir={field.direction ?? "auto"}>
      {s.length > CELL_MAX ? `${s.slice(0, CELL_MAX)}…` : s}
    </span>
  )
}
