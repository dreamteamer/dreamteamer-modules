/**
 * One field's editor, by type: a select for an enum or a relation (its options read from the target
 * collection), a checkbox for a boolean, a date or number input, a textarea for markdown and text, a text
 * input for the rest. A `many` field that is not a relation is edited as comma-separated text.
 */
import { listRecords } from "../api/client.ts"
import { useApp, useAsync } from "../app-context.tsx"
import { enumValues, formatValue, parseInput, recordTitle, relationTarget, type Field } from "../lib/fields.ts"

interface Props {
  field: Field
  value: unknown
  onChange(value: unknown): void
  id: string
}

export function FieldInput({ field, value, onChange, id }: Props) {
  const { collections } = useApp()
  const target = relationTarget(field, collections)
  if (target) return <RelationInput field={field} target={target} value={value} onChange={onChange} id={id} />

  const options = enumValues(field)
  if (options) {
    return (
      <select id={id} value={typeof value === "string" ? value : ""} onChange={e => onChange(e.target.value || null)}>
        <option value="">—</option>
        {options.map(o => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }
  if (field.type === "boolean") {
    return <input id={id} type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} />
  }
  const text = Array.isArray(value) ? value.join(", ") : value === null || value === undefined ? "" : String(value)
  const set = (t: string) => onChange(parseInput(t, field))
  if (field.type === "markdown" || field.type === "text") {
    return <textarea id={id} value={text} rows={field.body ? 14 : 4} onChange={e => set(e.target.value)} />
  }
  const type =
    field.type === "number" || field.type === "integer"
      ? "number"
      : field.type === "date"
        ? "date"
        : field.type === "url"
          ? "url"
          : field.type === "email"
            ? "email"
            : "text"
  return (
    <input
      id={id}
      type={type}
      value={text}
      onChange={e => set(e.target.value)}
      placeholder={field.many ? "a, b, c" : ""}
    />
  )
}

function RelationInput({ field, target, value, onChange, id }: Props & { target: string }) {
  const { version } = useApp()
  const rows = useAsync(() => listRecords(target, { limit: 500 }), [target, version])
  const options = (rows.data?.records ?? []).map(r => ({ ref: `${target}/${r.id}`, label: recordTitle(r, r.id) }))
  if (field.many) {
    const selected = new Set(Array.isArray(value) ? value.map(String) : [])
    return (
      <select
        id={id}
        multiple
        value={[...selected]}
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
  const current = typeof value === "string" ? value : ""
  return (
    <select id={id} value={current} onChange={e => onChange(e.target.value || null)}>
      <option value="">—</option>
      {current && !options.some(o => o.ref === current) && <option value={current}>{formatValue(current)}</option>}
      {options.map(o => (
        <option key={o.ref} value={o.ref}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
