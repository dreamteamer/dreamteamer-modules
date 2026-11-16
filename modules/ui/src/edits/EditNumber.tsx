/**
 * `input-number` — an integer or a number. Empty clears to null; the field's unit sits beside the control
 * (`lib/field-unit.ts#unitSuffix`: a literal suffix, `%`, a currency's code once its sibling field holds one).
 */
import { unitSuffix } from "../lib/field-unit.ts"
import { inputText, numberFromInput } from "../lib/edit-values.ts"
import type { EditProps } from "../registry/props.ts"

export function EditNumber({ field, value, onChange, id, record }: EditProps) {
  const suffix = unitSuffix(field, record ?? null)
  return (
    <span className="dt-with-unit">
      <input
        id={id}
        type="number"
        className="dt-input"
        step={field.type === "integer" ? 1 : "any"}
        value={inputText(value)}
        placeholder={field.placeholder}
        onChange={e => onChange(numberFromInput(e.target.value))}
      />
      {suffix && <span className="dt-subtle">{suffix}</span>}
    </span>
  )
}
