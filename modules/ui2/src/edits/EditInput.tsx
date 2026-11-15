/**
 * `input` — one line of text, the default for a string, url, email or position. `dir` is the field's declared
 * direction, else `auto`: a Hebrew value must not flip to LTR the moment it is edited. An object that lands
 * here (a mis-typed field) shows as JSON, never "[object Object]"; an emptied field clears to null.
 */
import { inputText, textOrNull } from "../lib/edit-values.ts"
import type { EditProps } from "../registry/props.ts"

export function EditInput({ field, value, onChange, id }: EditProps) {
  const type = field.type === "url" ? "url" : field.type === "email" ? "email" : "text"
  return (
    <input
      id={id}
      type={type}
      className="ui2-input"
      value={inputText(value)}
      placeholder={field.placeholder}
      dir={field.direction ?? "auto"}
      onChange={e => onChange(textOrNull(e.target.value))}
    />
  )
}
