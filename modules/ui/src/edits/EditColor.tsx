/**
 * `color` — a swatch and the hex beside it. The native picker takes `#rrggbb` only; the text accepts anything,
 * so a value mid-edit or seeded as `#abc` is never clobbered, and only the swatch falls back to grey. Opt-in.
 */
import { swatchValue, textOrNull } from "../lib/edit-values.ts"
import type { EditProps } from "../registry/props.ts"

export function EditColor({ value, onChange, id }: EditProps) {
  const text = typeof value === "string" ? value : ""
  return (
    <span className="dt-color-edit">
      <input
        type="color"
        className="dt-color-swatch"
        aria-label="Pick a colour"
        value={swatchValue(value)}
        onChange={e => onChange(e.target.value)}
      />
      <input
        id={id}
        type="text"
        className="dt-input"
        value={text}
        placeholder="#rrggbb"
        onChange={e => onChange(textOrNull(e.target.value))}
      />
    </span>
  )
}
