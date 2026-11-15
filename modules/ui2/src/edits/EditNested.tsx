/**
 * `nested` — ONE object with declared sub-fields (`editor_options.fields`), edited as a real sub-form through
 * OptionsForm instead of a JSON blob. Reached by SHAPE (an `object` with sub-fields). Recursion is free: a
 * sub-field may itself be `nested` or `list`.
 */
import { OptionsForm } from "../render/OptionsForm.tsx"
import type { EditProps } from "../registry/props.ts"

export function EditNested({ value, onChange, options, id }: EditProps) {
  const model =
    value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const fields = Array.isArray(options?.fields) ? options.fields : []
  return (
    <div className="ui2-nested-edit" id={id}>
      <OptionsForm fields={fields} value={model} onChange={onChange} />
    </div>
  )
}
