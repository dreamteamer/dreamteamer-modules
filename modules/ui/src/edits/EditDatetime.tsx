/**
 * `datetime` — a date stays a calendar day (`<input type=date>`, the day AS WRITTEN, never shifted through UTC);
 * a datetime is the WALL CLOCK (`2026-07-28T12:00`), never an ISO instant. The engine stamps the local offset on
 * at validation, so this write is byte-identical to `dt <c> set <id> starts=2026-07-28T12:00` and re-reads as
 * the time that was typed (`lib/datetimeInput.ts`).
 */
import { fromLocalInputValue, toLocalInputValue } from "../lib/datetimeInput.ts"
import type { EditProps } from "../registry/props.ts"
import { input } from "../styles/classes.ts"

export function EditDatetime({ field, value, onChange, id }: EditProps) {
  const dateOnly = field.type === "date"
  return (
    <input
      id={id}
      type={dateOnly ? "date" : "datetime-local"}
      className={input}
      data-control="text"
      value={toLocalInputValue(value, dateOnly)}
      onChange={e => onChange(fromLocalInputValue(e.target.value))}
    />
  )
}
