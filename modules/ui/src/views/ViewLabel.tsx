/**
 * `label` — an enum value as its CHOICE: the label, not the stored value, with a dot in the choice's own colour,
 * or its icon when it declares one. A value with no declared colour falls back to a convention on the word
 * itself (open/running/parked an accent, done/success/resolved green, failed/rejected red) — best-effort, no
 * schema says "this is a status". A value outside the enum shows as itself. A list draws one per value.
 */
import { Icon } from "../components/Icon.tsx"
import { choiceOf, themeColor } from "../lib/collectionDisplay.ts"
import type { ViewProps } from "../registry/props.ts"
import { Empty, isEmpty } from "./Empty.tsx"
import { cx } from "../styles/classes.ts"

/** A label's dot when its choice names no colour: the tone its value conventionally reads in. */
const DOT = { accent: "bg-accent", success: "bg-chart-green", danger: "bg-danger", neutral: "bg-fg-subtle" } as const

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
    <span className="inline-flex flex-wrap gap-x-2.5 gap-y-1" data-items>
      {values.map((v, i) => {
        const c = choiceOf(field, v)
        const raw = String(v)
        const color = c?.color ? themeColor(c.color) : undefined
        return (
          <span
            key={`${raw}-${i}`}
            className="inline-flex items-center gap-1.5 whitespace-nowrap"
            title={c?.description}
          >
            {c?.icon ? (
              <span className="inline-flex" style={color ? { color } : undefined}>
                <Icon name={c.icon} />
              </span>
            ) : (
              <span
                className={cx("flex-none w-2 h-2 rounded-full", !color && DOT[conventionTone(raw)])}
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
