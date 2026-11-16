/**
 * `display-template` — a display template (`{{ field }}` tokens in markdown, `lib/template.ts`'s grammar) in a
 * monospace textarea. Not a rich editor: the output is a few lines, and the live preview is the surface it
 * configures. What was missing was the vocabulary, so the collection's fields (from the ambient field context)
 * are one-click tokens, inserted at the caret — folded behind a disclosure, because a wide collection's chips
 * would otherwise be the biggest thing on the panel. Fields already used are marked. Blank clears to null.
 */
import { useRef } from "react"
import { selectableFields } from "../lib/field-context.ts"
import { inputText, textOrNull } from "../lib/edit-values.ts"
import { templateFields } from "../lib/template.ts"
import { useFieldContext } from "../render/FieldContext.tsx"
import type { EditProps } from "../registry/props.ts"

export function EditDisplayTemplate({ field, value, onChange, id }: EditProps) {
  const context = useFieldContext()
  const area = useRef<HTMLTextAreaElement>(null)
  const text = inputText(value)
  const used = new Set(templateFields(text))
  const candidates = context ? selectableFields(context.fields, field.editor_options) : []
  const declared = field.editor_options?.["placeholder"]

  const insert = (name: string) => {
    const token = `{{ ${name} }}`
    const el = area.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? start
    onChange(text.slice(0, start) + token + text.slice(end))
    const caret = start + token.length
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(caret, caret)
    })
  }

  return (
    <div className="dt-stack">
      <textarea
        ref={area}
        id={id}
        rows={3}
        spellCheck={false}
        className="dt-textarea dt-code"
        value={text}
        placeholder={typeof declared === "string" && declared ? declared : "**{{ name }}**\n{{ status }} · {{ due }}"}
        onChange={e => onChange(textOrNull(e.target.value))}
      />
      <p className="dt-hint">
        Markdown — <code>**bold**</code>, <code>- lists</code>, <code># heading</code>.
      </p>
      {candidates.length > 0 && (
        <details className="dt-tpl-fields">
          <summary className="dt-hint">
            Insert a field <span className="dt-subtle">{candidates.length}</span>
          </summary>
          <div className="dt-chips">
            {candidates.map(f => (
              <button
                key={f.field}
                type="button"
                className={`dt-tpl-token${used.has(f.field) ? " is-used" : ""}`}
                title={`Insert {{ ${f.field} }}`}
                onClick={() => insert(f.field)}
              >
                {f.field}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
