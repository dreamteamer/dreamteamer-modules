/**
 * The band header a grouped layout draws: a glyph, the label, the count and an optional description — the
 * visible payoff of a field's enum map, whose decoration the engine projects onto the choice rows (ported from
 * @dreamteamer/ui's browse/GroupHeader.vue). One component for every layout that bands its records: what a band
 * IS differs per layout, what it SAYS does not.
 *
 * Colours are theme colour ids (`charts.green`), reaching the DOM only as `var(--vscode-…)` through
 * `themeColor`, so a band survives both themes. An `icon` that is a reference into a binary collection (a
 * picture) is drawn by ViewImage's resolver later; today a codicon name draws and a reference does not.
 */
import type { CSSProperties } from "react"
import { Icon } from "../components/Icon.tsx"
import { themeColor } from "../lib/collection-display.ts"

export function GroupHeader({
  label,
  count,
  description,
  icon,
  color,
  background,
}: {
  label: string
  count: number
  description?: string
  icon?: string
  color?: string
  background?: string
}) {
  const style: Record<string, string> = {}
  if (color) style["--ui2-group-color"] = themeColor(color)
  if (background) style["--ui2-group-bg"] = themeColor(background)
  return (
    <div
      className={`ui2-group-header${color ? " has-color" : ""}${background ? " has-bg" : ""}`}
      style={style as CSSProperties}
    >
      {icon && !icon.includes("/") && <Icon name={icon} />}
      <span className="ui2-group-label">{label}</span>
      <span className="ui2-group-count">{count}</span>
      {description && <span className="ui2-group-desc">{description}</span>}
    </div>
  )
}
