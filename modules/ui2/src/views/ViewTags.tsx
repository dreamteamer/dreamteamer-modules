/**
 * `tags` — a `many` field of scalars as chips. A cell shows the first three and `+n`; the record page all of
 * them. Objects as JSON, never "[object Object]". A value the field's enum names wears its choice's label and
 * colour.
 */
import type { CSSProperties } from "react"
import { choiceOf, themeColor } from "../lib/collection-display.ts"
import { tagsOf } from "../lib/edit-values.ts"
import type { ViewProps } from "../registry/props.ts"
import { Empty } from "./empty.tsx"

const MAX_VISIBLE = 3

export function ViewTags({ field, value, context }: ViewProps) {
  const tags = tagsOf(value)
  if (!tags.length) return <Empty />
  const visible = context === "record" ? tags : tags.slice(0, MAX_VISIBLE)
  const overflow = tags.length - visible.length
  return (
    <span className="ui2-chips" title={context === "record" ? undefined : tags.join(", ")}>
      {visible.map((tag, i) => {
        const c = choiceOf(field, tag)
        const style = c?.color ? ({ "--chip": themeColor(c.color) } as CSSProperties) : undefined
        return (
          <span key={`${tag}-${i}`} className="ui2-chip" style={style} dir="auto">
            {c?.label ?? tag}
          </span>
        )
      })}
      {overflow > 0 && <span className="ui2-subtle">+{overflow}</span>}
    </span>
  )
}
