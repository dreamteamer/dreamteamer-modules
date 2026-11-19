/**
 * `select-dropdown` — an enum's choices in the searchable dropdown (`components/Select.tsx`), each with its
 * label, icon and colour; a value outside the enum still shows as itself, so Save never silently rewrites it.
 * Choosing the placeholder row clears to null (a required field offers no such row).
 */
import { Select } from "../components/Select.tsx"
import { normalizeChoices } from "../lib/normalizeChoices.ts"
import { choicesOf } from "../lib/fieldRow.ts"
import type { Choice } from "../lib/listbox.ts"
import type { EditProps } from "../registry/props.ts"

const CLEAR = "\u0000clear"

export function EditSelect({ field, value, onChange, id }: EditProps) {
  const choices: Choice[] = normalizeChoices(choicesOf(field))
  const all = field.required ? choices : [{ text: "—", value: CLEAR }, ...choices]
  return (
    <Select
      id={id}
      value={value}
      choices={all}
      ariaLabel={field.title || field.field}
      onChange={v => onChange(v === CLEAR ? null : v)}
    />
  )
}
