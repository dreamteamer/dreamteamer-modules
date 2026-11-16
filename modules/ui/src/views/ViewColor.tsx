/**
 * `color` — a swatch and its hex. Opt-in only: a string field defaulting to a swatch would be wrong for most.
 */
import { hexOf } from "../lib/edit-values.ts"
import type { ViewProps } from "../registry/props.ts"
import { Empty } from "./empty.tsx"
import { mono } from "../styles/classes.ts"

export function ViewColor({ value }: ViewProps) {
  const hex = hexOf(value)
  if (!hex) return <Empty />
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-3.5 h-3.5 rounded border border-border" style={{ background: hex }} />
      <span className={mono}>{hex}</span>
    </span>
  )
}
