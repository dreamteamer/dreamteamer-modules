/**
 * `color` — a swatch and its hex. Opt-in only: a string field defaulting to a swatch would be wrong for most.
 */
import { hexOf } from "../lib/edit-values.ts"
import type { ViewProps } from "../registry/props.ts"
import { Empty } from "./empty.tsx"

export function ViewColor({ value }: ViewProps) {
  const hex = hexOf(value)
  if (!hex) return <Empty />
  return (
    <span className="ui2-color">
      <span className="ui2-color-chip" style={{ background: hex }} />
      <span className="ui2-mono">{hex}</span>
    </span>
  )
}
