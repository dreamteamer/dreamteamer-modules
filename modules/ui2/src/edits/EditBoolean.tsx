/**
 * `boolean` — a switch. Sized from two custom properties (`--ui2-switch-h`, `--ui2-switch-w`) so a dense surface
 * can shrink it without a variant; the OFF track is a real neutral, never the accent's blue, so on and off can be
 * told apart in every theme.
 */
import type { EditProps } from "../registry/props.ts"

export function EditBoolean({ field, value, onChange, id }: EditProps) {
  const on = value === true
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={field.title}
      className={`ui2-switch${on ? " is-on" : ""}`}
      onClick={() => onChange(!on)}
    >
      <span className="ui2-switch-thumb" />
    </button>
  )
}
