/**
 * `label` — an enum value as its CHOICE: the label, not the stored value, with a dot in the choice's own colour,
 * or its icon when it declares one. A value with no declared colour falls back to a convention on the word
 * itself (open/running/parked an accent, done/success/resolved green, failed/rejected red) — best-effort, no
 * schema says "this is a status". A value outside the enum shows as itself. A list draws one per value.
 */
import { Icon } from "../components/Icon.tsx"
import { choiceOf, themeColor } from "../lib/collection-display.ts"
import type { ViewProps } from "../registry/props.ts"
import { Empty, isEmpty } from "./empty.tsx"

const ACCENT = new Set(["open", "running", "parked"])
const SUCCESS = new Set(["done", "success", "resolved"])
const DANGER = new Set(["failed", "rejected"])

export function conventionTone(value: string): "accent" | "success" | "danger" | "neutral" {
  const key = value.toLowerCase()
  return ACCENT.has(key) ? "accent" : SUCCESS.has(key) ? "success" : DANGER.has(key) ? "danger" : "neutral"
}

export function ViewLabel({ field, value }: ViewProps) {
  if (isEmpty(value)) return <Empty />
  const values = Array.isArray(value) ? value : [value]
  return (
    <span className="ui2-labels">
      {values.map((v, i) => {
        const c = choiceOf(field, v)
        const raw = String(v)
        const color = c?.color ? themeColor(c.color) : undefined
        return (
          <span key={`${raw}-${i}`} className="ui2-label" title={c?.description}>
            {c?.icon ? (
              <span className="ui2-label-icon" style={color ? { color } : undefined}>
                <Icon name={c.icon} />
              </span>
            ) : (
              <span
                className={`ui2-dot${color ? "" : ` is-${conventionTone(raw)}`}`}
                style={color ? { background: color } : undefined}
              />
            )}
            <span dir="auto">{c?.label ?? raw}</span>
          </span>
        )
      })}
    </span>
  )
}
