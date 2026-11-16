/**
 * `textarea` — several lines of plain text (a `markdown` field that is not the body). `dir` as EditInput's.
 */
import { inputText, textOrNull } from "../lib/editValues.ts"
import type { EditProps } from "../registry/props.ts"
import { textarea } from "../styles/classes.ts"

export function EditTextarea({ field, value, onChange, id }: EditProps) {
  return (
    <textarea
      id={id}
      rows={4}
      className={textarea}
      data-control="text"
      value={inputText(value)}
      placeholder={field.placeholder}
      dir={field.direction ?? "auto"}
      onChange={e => onChange(textOrNull(e.target.value))}
    />
  )
}
