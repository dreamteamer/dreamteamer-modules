/**
 * `slider` — a number as a range, `editor_options.min`/`max`/`step` (defaults 0/100/1), its value beside it.
 * Opt-in only: a year, a count or a price defaulting to a 0–100 slider would be wrong for most number fields.
 */
import { sliderScale } from "../lib/edit-values.ts"
import type { EditProps } from "../registry/props.ts"

export function EditSlider({ value, onChange, id, options }: EditProps) {
  const { min, max, step, at } = sliderScale(options, value)
  return (
    <span className="flex items-center gap-3">
      <input
        id={id}
        type="range"
        className="flex-auto min-h-0 p-0 border-0 bg-transparent accent-accent"
        min={min}
        max={max}
        step={step}
        value={at}
        onChange={e => onChange(Number(e.target.value))}
      />
      <span className="min-w-9 py-px px-2 rounded-full text-center font-semibold text-accent bg-[color-mix(in_srgb,var(--dt-accent)_14%,transparent)]">
        {at}
      </span>
    </span>
  )
}
