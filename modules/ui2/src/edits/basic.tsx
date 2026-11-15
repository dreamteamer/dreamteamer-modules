/**
 * The built-in Edits a record form needs for every wire type — the ids @dreamteamer/ui registers (`input`,
 * `input-number`, `textarea`, `boolean`, `datetime`, `select-dropdown`, `relation-picker`, `markdown-body`,
 * `tags`, `json`), so a descriptor that names one gets the same kind of control in either app.
 */
import { useState, type ChangeEvent } from "react"
import { listRecords } from "../api/client.ts"
import { useApp, useAsync } from "../app-context.tsx"
import { choicesOf } from "../lib/field-row.ts"
import { recordLabel } from "../lib/schema.ts"
import type { EditProps } from "../registry/props.ts"

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v))
const orNull = (s: string) => (s === "" ? null : s)

export function EditInput({ field, value, onChange, id }: EditProps) {
  const type = field.type === "url" ? "url" : field.type === "email" ? "email" : "text"
  return (
    <input
      id={id}
      type={type}
      value={text(value)}
      placeholder={field.placeholder}
      dir={field.direction}
      onChange={e => onChange(orNull(e.target.value))}
    />
  )
}

export function EditNumber({ field, value, onChange, id }: EditProps) {
  return (
    <span className="ui2-with-unit">
      <input
        id={id}
        type="number"
        step={field.type === "integer" ? 1 : "any"}
        value={text(value)}
        placeholder={field.placeholder}
        onChange={e => {
          const s = e.target.value
          if (s === "") return onChange(null)
          const n = Number(s)
          onChange(Number.isFinite(n) ? n : s)
        }}
      />
      {field.unit && !["currency", "percent", "bytes"].includes(field.unit) && (
        <span className="ui2-subtle">{field.unit}</span>
      )}
    </span>
  )
}

export function EditTextarea({ field, value, onChange, id }: EditProps) {
  return (
    <textarea
      id={id}
      rows={4}
      value={text(value)}
      placeholder={field.placeholder}
      dir={field.direction}
      onChange={e => onChange(orNull(e.target.value))}
    />
  )
}

/** The body: a tall editor for the record's prose. (Step 2 brings the CodeMirror editor @dreamteamer/ui has.) */
export function EditMarkdownBody({ value, onChange, id }: EditProps) {
  return (
    <textarea
      id={id}
      rows={16}
      className="ui2-body-input"
      value={text(value)}
      onChange={e => onChange(orNull(e.target.value))}
    />
  )
}

export function EditBoolean({ value, onChange, id }: EditProps) {
  return <input id={id} type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} />
}

/** A date stays a date; a datetime is the wall clock (`2026-07-28T12:00`), never an instant — the engine
 *  stores what was typed, in the record's own terms. */
export function EditDatetime({ field, value, onChange, id }: EditProps) {
  const date = field.type === "date"
  const v = text(value)
  return (
    <input
      id={id}
      type={date ? "date" : "datetime-local"}
      value={date ? v.slice(0, 10) : v.slice(0, 16)}
      onChange={e => onChange(orNull(e.target.value))}
    />
  )
}

export function EditSelect({ field, value, onChange, id }: EditProps) {
  const choices = choicesOf(field) ?? []
  return (
    <select id={id} value={text(value)} onChange={e => onChange(orNull(e.target.value))}>
      <option value="">—</option>
      {choices.map(c => (
        <option key={String(c.value)} value={String(c.value)} title={c.description}>
          {c.label}
        </option>
      ))}
    </select>
  )
}

/** A `many` scalar: one value per comma. */
export function EditTags({ value, onChange, id }: EditProps) {
  const [draft, setDraft] = useState(Array.isArray(value) ? value.join(", ") : text(value))
  const commit = (e: ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value)
    const parts = e.target.value
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
    onChange(parts.length ? parts : null)
  }
  return <input id={id} value={draft} onChange={commit} placeholder="a, b, c" />
}

/** An object or map as JSON, written only while it parses. */
export function EditJson({ value, onChange, id }: EditProps) {
  const [draft, setDraft] = useState(value === null || value === undefined ? "" : JSON.stringify(value, null, 2))
  const [bad, setBad] = useState(false)
  return (
    <span className="ui2-stack">
      <textarea
        id={id}
        rows={6}
        className={bad ? "is-invalid" : ""}
        value={draft}
        onChange={e => {
          setDraft(e.target.value)
          if (e.target.value.trim() === "") {
            setBad(false)
            return onChange(null)
          }
          try {
            onChange(JSON.parse(e.target.value))
            setBad(false)
          } catch {
            setBad(true)
          }
        }}
      />
      {bad && <span className="ui2-hint is-error">Not valid JSON — the last valid value is kept.</span>}
    </span>
  )
}

/** A reference: the target collection's records by their titles; a list reference picks several. */
export function EditRelation({ field, value, onChange, id }: EditProps) {
  const { schema, version } = useApp()
  const target = schema.target(field)
  const rows = useAsync(
    () => (target ? listRecords(target.collection, { limit: 500 }) : Promise.resolve(null)),
    [target?.collection, version]
  )
  if (!target) return <EditInput field={field} value={value} onChange={onChange} id={id} />
  const row = schema.collection(target.collection)
  const options = (rows.data?.records ?? []).map(r => ({
    ref: `${target.collection}/${r.id}`,
    label: recordLabel(row, r, r.id),
  }))
  const strip = (v: unknown) => String(v).replace(/^\//, "")
  if (field.many || target.list) {
    const selected = Array.isArray(value) ? value.map(strip) : []
    return (
      <select
        id={id}
        multiple
        value={selected}
        onChange={e => {
          const picked = [...e.target.selectedOptions].map(o => o.value)
          onChange(picked.length ? picked : null)
        }}
      >
        {options.map(o => (
          <option key={o.ref} value={o.ref}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }
  const current = value ? strip(value) : ""
  return (
    <select id={id} value={current} onChange={e => onChange(orNull(e.target.value))}>
      <option value="">—</option>
      {current && !options.some(o => o.ref === current) && <option value={current}>{current}</option>}
      {options.map(o => (
        <option key={o.ref} value={o.ref}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
