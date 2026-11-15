/**
 * `progress` — a number as a bar against `viewer_options.max` (default 100), clamped to the track, the value and
 * the scale beside it. Opt-in only: most numbers are not a progress.
 */
import { progressOf } from "../lib/edit-values.ts"
import type { ViewProps } from "../registry/props.ts"
import { Empty } from "./empty.tsx"

export function ViewProgress({ value, options }: ViewProps) {
  const p = progressOf(value, options)
  if (!p) return <Empty />
  return (
    <span className="ui2-progress" role="meter" aria-valuenow={p.value} aria-valuemin={0} aria-valuemax={p.max}>
      <span className="ui2-progress-track">
        <span className="ui2-progress-fill" style={{ width: `${p.pct}%` }} />
      </span>
      <span className="ui2-subtle">
        {p.value}/{p.max}
      </span>
    </span>
  )
}
