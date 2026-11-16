/**
 * `progress` — a number as a bar against `viewer_options.max` (default 100), clamped to the track, the value and
 * the scale beside it. Opt-in only: most numbers are not a progress.
 */
import { progressOf } from "../lib/edit-values.ts"
import type { ViewProps } from "../registry/props.ts"
import { Empty } from "./empty.tsx"
import { subtle } from "../styles/classes.ts"

export function ViewProgress({ value, options }: ViewProps) {
  const p = progressOf(value, options)
  if (!p) return <Empty />
  return (
    <span
      className="inline-flex items-center gap-2"
      role="meter"
      aria-valuenow={p.value}
      aria-valuemin={0}
      aria-valuemax={p.max}
    >
      <span className="relative w-[72px] h-1.5 rounded-full bg-border overflow-hidden">
        <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${p.pct}%` }} />
      </span>
      <span className={subtle}>
        {p.value}/{p.max}
      </span>
    </span>
  )
}
