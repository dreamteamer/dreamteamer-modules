/**
 * `list` — an array of structured rows, the read-side twin of EditList (same `fields` / `item_title` options):
 * collapsible summary rows, each opening to its key/value detail. A cell is "N items" and the first summaries —
 * a stack of rows would break the row height.
 */
import { useState } from "react"
import { Icon } from "../components/Icon.tsx"
import { rowSummary } from "../edits/EditList.tsx"
import { entriesOf, showValue } from "../lib/edit-values.ts"
import type { ViewProps } from "../registry/props.ts"
import { Empty } from "./empty.tsx"
import { cx, kv, mono, subtle } from "../styles/classes.ts"

export function ViewList({ value, options, context }: ViewProps) {
  const [open, setOpen] = useState<Set<number>>(new Set())
  const rows = Array.isArray(value)
    ? value.map(r =>
        r !== null && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, unknown>) : { value: r }
      )
    : []
  if (!rows.length) return <Empty />
  const fields = Array.isArray(options?.fields) ? options.fields : []
  const template = typeof options?.item_title === "string" && options.item_title ? options.item_title : null
  const summaries = rows.map((r, i) => rowSummary(r, i, fields, template))

  if (context === "cell") {
    const text = summaries.join(", ")
    return <span title={text}>{text.length > 80 ? `${text.slice(0, 80)}…` : text}</span>
  }
  const toggle = (i: number) =>
    setOpen(s => {
      const n = new Set(s)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      {rows.map((row, i) => (
        <div key={i} className="border border-border rounded-dt bg-bg">
          <button
            type="button"
            className="flex items-center gap-1.5 flex-auto min-w-0 w-full py-1.5 px-2 border-0 bg-transparent text-fg text-left cursor-pointer"
            aria-expanded={open.has(i)}
            onClick={() => toggle(i)}
          >
            <Icon name={open.has(i) ? "chevron-down" : "chevron-right"} />
            <span className={cx(subtle, mono)}>{i + 1}</span>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{summaries[i]}</span>
          </button>
          {open.has(i) && (
            <dl className={cx(kv, "pt-2 pr-3 pb-3 pl-[30px] border-t border-border")}>
              {entriesOf(row, fields).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{showValue(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))}
    </div>
  )
}
