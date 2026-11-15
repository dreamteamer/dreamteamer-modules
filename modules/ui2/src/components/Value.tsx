/**
 * One field's value, read-only: an enum value as a coloured chip, a relation as a link to its record, a
 * boolean as a check, anything else as text.
 */
import type { Field } from "../lib/fields.ts"
import { formatValue, relationTarget, splitRef } from "../lib/fields.ts"
import { recordRoute } from "../lib/route.ts"
import { useApp } from "../app-context.tsx"
import { Icon } from "./Icon.tsx"
import { Link } from "./Link.tsx"

/** `charts.green` (the colour names descriptors use) → a CSS colour from the theme tokens. */
export function enumColor(f: Field, value: string): string | undefined {
  if (!f.enum || Array.isArray(f.enum)) return undefined
  const c = f.enum[value]?.color
  if (!c) return undefined
  return `var(--ui2-${c.replace(/\./g, "-")}, var(--ui2-chip-fallback))`
}

export function Value({ field, value }: { field: Field; value: unknown }) {
  const { collections } = useApp()
  if (value === null || value === undefined || value === "") return <span className="ui2-empty">—</span>
  if (field.type === "boolean") return <Icon name={value ? "check" : "dash"} />
  if (relationTarget(field, collections)) {
    const refs = Array.isArray(value) ? value : [value]
    return (
      <span className="ui2-refs">
        {refs.map(r => {
          const ref = String(r)
          const at = splitRef(ref, collections)
          return at ? (
            <Link key={ref} to={recordRoute(at.collection, at.id)} className="ui2-ref">
              {at.id}
            </Link>
          ) : (
            <span key={ref}>{ref}</span>
          )
        })}
      </span>
    )
  }
  if (field.enum && typeof value === "string") {
    const color = enumColor(field, value)
    return (
      <span className="ui2-chip" style={color ? { ["--chip" as string]: color } : undefined}>
        {value}
      </span>
    )
  }
  return <span>{formatValue(value, field)}</span>
}
