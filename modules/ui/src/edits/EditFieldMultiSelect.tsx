/**
 * `field-multi-select` — several of the collection's fields as checkboxes, the plural of `field-select`.
 * Checkboxes, not a multi-select: the choices are few and seeing them all at once IS the affordance. EMPTY MEANS
 * ALL, and is stored as null rather than `[]`, so a saved view says "not narrowed" instead of a deliberate
 * nothing. With no field context, a comma-separated text input.
 */
import { selectableFields } from "../lib/fieldContext.ts"
import { listOrNull } from "../lib/editValues.ts"
import { useFieldContext } from "../render/FieldContext.tsx"
import type { EditProps } from "../registry/props.ts"
import { hint, input, mono } from "../styles/classes.ts"

export function EditFieldMultiSelect({ field, value, onChange, id }: EditProps) {
  const context = useFieldContext()
  const selected = Array.isArray(value) ? value.map(String) : []
  if (!context)
    return (
      <input
        id={id}
        type="text"
        className={input}
        data-control="text"
        defaultValue={selected.join(", ")}
        placeholder="field names, comma separated"
        onBlur={e =>
          onChange(
            listOrNull(
              e.target.value
                .split(",")
                .map(s => s.trim())
                .filter(Boolean)
            )
          )
        }
      />
    )
  const candidates = selectableFields(context.fields, field.editor_options)
  if (!candidates.length) return <span className={hint}>no matching fields on this collection</span>
  const toggle = (name: string) =>
    onChange(listOrNull(selected.includes(name) ? selected.filter(f => f !== name) : [...selected, name]))
  return (
    <div
      className="grid gap-0.5 [&_label]:flex [&_label]:items-center [&_label]:gap-1.5 [&_label]:cursor-pointer"
      id={id}
    >
      {candidates.map(f => (
        <label key={f.field}>
          <input type="checkbox" checked={selected.includes(f.field)} onChange={() => toggle(f.field)} />
          <span className={mono}>{f.field}</span>
        </label>
      ))}
    </div>
  )
}
