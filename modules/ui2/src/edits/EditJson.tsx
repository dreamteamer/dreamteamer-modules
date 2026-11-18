/**
 * `json` — the safe default for an object or a map: a monospace textarea of pretty-printed JSON that writes ONLY
 * when the text parses, so a half-typed edit can never corrupt the record. Invalid text stays local and flags the
 * border. A value changed from outside (a re-read, Revert) resets the text — never while the draft is invalid,
 * which would eat the keystrokes being typed.
 */
import { useEffect, useRef, useState } from "react"
import { jsonText, parseJsonDraft } from "../lib/editValues.ts"
import type { EditProps } from "../registry/props.ts"
import { code, cx, hintError, stack, textarea } from "../styles/classes.ts"

export function EditJson({ value, onChange, id }: EditProps) {
  const [text, setText] = useState(() => jsonText(value))
  const [invalid, setInvalid] = useState(false)
  // the last value this editor wrote — its echo coming back must not reformat what is being typed
  const wrote = useRef<string | null>(null)

  useEffect(() => {
    const incoming = JSON.stringify(value ?? null)
    if (incoming === wrote.current || invalid) return
    if (jsonText(value) !== text) setText(jsonText(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only an outside change of the value resets the text
  }, [value])

  return (
    <span className={stack}>
      <textarea
        id={id}
        rows={8}
        spellCheck={false}
        className={cx(textarea, code, invalid && "text-danger border-danger")}
        data-control="text"
        value={text}
        onChange={e => {
          setText(e.target.value)
          const parsed = parseJsonDraft(e.target.value)
          setInvalid(!parsed.ok)
          if (!parsed.ok) return
          wrote.current = JSON.stringify(parsed.value ?? null)
          onChange(parsed.value)
        }}
      />
      {invalid && <span className={hintError}>Not valid JSON — the last valid value is kept.</span>}
    </span>
  )
}
