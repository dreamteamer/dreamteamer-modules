/**
 * `field-select` — one of the collection's fields, for an option that NAMES a field (a board's group-by, a
 * calendar's start). The candidates come from the ambient field context (`render/FieldContext.tsx`), narrowed by
 * the option's own `editor_options` (`types`, `roles`, `prefer: choices` floating enum-ish fields first —
 * `lib/field-context.ts`). With no context, a plain text input: the name can still be typed.
 *
 * What blank MEANS is declared by the option (`editor_options.placeholder`) — "Auto" on an axis that really is
 * automatic, "None" on one that is not. A value the schema no longer has keeps a row of its own, so the control
 * shows what is stored instead of letting Save quietly rewrite it.
 */
import { Select } from "../components/Select.tsx"
import { hasChoices, selectableFields } from "../lib/field-context.ts"
import { inputText, textOrNull } from "../lib/edit-values.ts"
import { useFieldContext } from "../render/FieldContext.tsx"
import type { EditProps } from "../registry/props.ts"
import { input } from "../styles/classes.ts"

export function EditFieldSelect({ field, value, onChange, id }: EditProps) {
  const context = useFieldContext()
  const current = inputText(value)
  if (!context)
    return (
      <input
        id={id}
        type="text"
        className={input}
        data-control="text"
        value={current}
        placeholder="field name"
        onChange={e => onChange(textOrNull(e.target.value))}
      />
    )
  const declared = field.editor_options?.["placeholder"]
  const placeholder = typeof declared === "string" && declared ? declared : field.description ? "Auto" : "—"
  const candidates = selectableFields(context.fields, field.editor_options)
  const orphaned = current !== "" && !candidates.some(f => f.field === current)
  const choices = [
    { text: placeholder, value: "" },
    ...(orphaned ? [{ text: `${current} (not in schema)`, value: current }] : []),
    ...candidates.map(f => ({ text: hasChoices(f) ? `${f.field} — choices` : f.field, value: f.field, hint: f.title })),
  ]
  return (
    <Select
      id={id}
      value={current}
      choices={choices}
      placeholder={placeholder}
      ariaLabel={field.title || field.field}
      onChange={v => onChange(textOrNull(String(v ?? "")))}
    />
  )
}
