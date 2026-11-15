/**
 * The band header a grouped layout draws: a glyph, the label, the count and an optional description — the
 * visible payoff of a field's enum map, whose decoration the engine projects onto the choice rows (ported from
 * @dreamteamer/ui's browse/GroupHeader.vue). One component for every layout that bands its records: what a band
 * IS differs per layout, what it SAYS does not.
 *
 * Colours are theme colour ids (`charts.green`), reaching the DOM only as `var(--vscode-…)` through
 * `themeColor`, so a band survives both themes. An `icon` holding a `/` is a PICTURE — a URL or a reference into
 * a file-codec collection (a person's face on a gantt lane, `lib/group-label.ts`) — drawn through the one picture
 * resolver, `useImageSrc`; anything else is a codicon name.
 */
import type { CSSProperties } from "react"
import { useImageSrc } from "../components/FileThumb.tsx"
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
      {icon && (icon.includes("/") ? <GroupPicture value={icon} /> : <Icon name={icon} />)}
      <span className="ui2-group-label">{label}</span>
      <span className="ui2-group-count">{count}</span>
      {description && <span className="ui2-group-desc">{description}</span>}
    </div>
  )
}

/** A band's picture; nothing at all until (or unless) the reference resolves to an image. */
function GroupPicture({ value }: { value: string }) {
  const src = useImageSrc(value)
  return src ? <img className="ui2-group-picture" src={src} alt="" /> : null
}
