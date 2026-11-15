/**
 * `nested` — one object with declared sub-fields, read as a compact key/value grid: the declared sub-fields
 * first, in order, then any extras. The read-side twin of EditNested. A cell gets the same grid's first line
 * of each, as `key: value` joined — a grid would break the row height.
 */
import { entriesOf, showValue } from "../lib/edit-values.ts"
import type { ViewProps } from "../registry/props.ts"
import { Empty } from "./empty.tsx"

export function ViewNested({ value, options, context }: ViewProps) {
  const model =
    value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  const fields = Array.isArray(options?.fields) ? options.fields : []
  const entries = model ? entriesOf(model, fields) : []
  if (!entries.length) return <Empty />
  if (context === "cell") {
    const line = entries.map(([k, v]) => `${k}: ${showValue(v).replace(/\s+/g, " ")}`).join(" · ")
    return <span title={line}>{line.length > 80 ? `${line.slice(0, 80)}…` : line}</span>
  }
  return (
    <dl className="ui2-kv">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{showValue(v)}</dd>
        </div>
      ))}
    </dl>
  )
}
