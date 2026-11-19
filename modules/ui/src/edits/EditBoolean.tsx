/**
 * `boolean` — a switch. Sized from two custom properties (`--dt-switch-h`, `--dt-switch-w`) so a dense surface
 * can shrink it without a variant; the OFF track is a real neutral, never the accent's blue, so on and off can be
 * told apart in every theme.
 */
import type { EditProps } from "../registry/props.ts"
import { cx } from "../styles/classes.ts"

export function EditBoolean({ field, value, onChange, id }: EditProps) {
  const on = value === true
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={field.title}
      className={cx(
        "[--_h:var(--dt-switch-h,22px)] [--_w:var(--dt-switch-w,calc(var(--_h)*1.8))] w-(--_w) h-(--_h) p-0.5 border-0 rounded-full cursor-pointer justify-self-start [transition:background-color_0.12s_ease] motion-reduce:transition-none",
        on ? "bg-accent" : "bg-input-border"
      )}
      onClick={() => onChange(!on)}
    >
      <span
        className={cx(
          "block w-[calc(var(--_h)-4px)] h-[calc(var(--_h)-4px)] rounded-full bg-accent-fg [transition:transform_0.15s] motion-reduce:transition-none",
          on && "[transform:translateX(calc(var(--_w)_-_var(--_h)))]"
        )}
      />
    </button>
  )
}
