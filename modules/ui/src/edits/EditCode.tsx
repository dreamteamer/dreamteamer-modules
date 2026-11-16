/**
 * `code` — a monospace textarea for yaml- or json-shaped strings, where Tab inserts a tab at the caret instead of
 * leaving the field (the normal textarea gesture, which makes structured text painful). Opt-in only.
 */
import { useRef, type KeyboardEvent } from "react"
import { inputText, textOrNull } from "../lib/edit-values.ts"
import type { EditProps } from "../registry/props.ts"
import { code, cx, textarea } from "../styles/classes.ts"

export function EditCode({ value, onChange, id }: EditProps) {
  const caret = useRef<number | null>(null)
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return
    e.preventDefault()
    const el = e.currentTarget
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    caret.current = start + 1
    onChange(`${el.value.slice(0, start)}\t${el.value.slice(end)}`)
    // the value round-trips through the parent: put the caret back after React has written it
    requestAnimationFrame(() => {
      if (caret.current !== null) el.selectionStart = el.selectionEnd = caret.current
      caret.current = null
    })
  }
  return (
    <textarea
      id={id}
      rows={10}
      className={cx(textarea, code)}
      data-control="text"
      spellCheck={false}
      value={inputText(value)}
      onChange={e => onChange(textOrNull(e.target.value))}
      onKeyDown={onKeyDown}
    />
  )
}
