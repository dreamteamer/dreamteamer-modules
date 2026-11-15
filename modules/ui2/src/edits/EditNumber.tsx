/**
 * `input-number` — an integer or a number. Empty clears to null; the field's unit sits beside the control
 * (`lib/field-unit.ts#unitSuffix`: a literal suffix, `%`, a currency's code once its sibling field holds one).
 */
import { unitSuffix } from "../lib/field-unit.ts"
import { inputText, numberFromInput } from "../lib/edit-values.ts"
import type { EditProps } from "../registry/props.ts"

export function EditNumber({ field, value, onChange, id }: EditProps) {
  const suffix = unitSuffix(field, null)
  return (
    <span className="ui2-with-unit">
      <input
        id={id}
        type="number"
        className="ui2-input"
        step={field.type === "integer" ? 1 : "any"}
        value={inputText(value)}
        placeholder={field.placeholder}
        onChange={e => onChange(numberFromInput(e.target.value))}
      />
      {suffix && <span className="ui2-subtle">{suffix}</span>}
    </span>
  )
}
