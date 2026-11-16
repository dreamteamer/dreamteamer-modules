/**
 * `list` — a repeatable list of objects, each a row of the declared sub-fields (`editor_options.fields`), drawn
 * by OptionsForm. Opt-in, or reached by SHAPE (a `many` object). Rows collapse to a summary line — the
 * `item_title` template, else the first sub-field's value, else "Item n" — and are added, removed, and reordered
 * by native drag on the grip. Emptied, the field clears to null.
 *
 * Expansion is keyed by a uid on each row OBJECT, not its index, so it survives a reorder or a removal above it;
 * an edit makes a fresh object, so the uid is carried across.
 */
import { useRef, useState } from "react"
import type { FieldRow } from "../api/types.ts"
import { Icon } from "../components/Icon.tsx"
import { listOrNull, moveItem, rowsOf } from "../lib/edit-values.ts"
import { tryRenderDisplay } from "../lib/template.ts"
import { OptionsForm } from "../render/OptionsForm.tsx"
import type { EditProps } from "../registry/props.ts"
import { button, cx, iconButton } from "../styles/classes.ts"

export function rowSummary(
  row: Record<string, unknown>,
  i: number,
  fields: readonly FieldRow[],
  template: string | null
): string {
  if (template) {
    const rendered = (tryRenderDisplay(template, row) ?? "").trim()
    if (rendered) return rendered
  }
  const first = fields[0]?.field ?? Object.keys(row)[0]
  if (first !== undefined) {
    const v = row[first]
    if (v !== null && v !== undefined && v !== "") return typeof v === "object" ? JSON.stringify(v) : String(v)
  }
  return `Item ${i + 1}`
}

export function EditList({ value, onChange, options, id }: EditProps) {
  const rows = rowsOf(value)
  const fields = Array.isArray(options?.fields) ? options.fields : []
  const template = typeof options?.item_title === "string" && options.item_title ? options.item_title : null

  const uids = useRef(new WeakMap<object, number>())
  const seq = useRef(0)
  const uidOf = (row: object) => {
    let u = uids.current.get(row)
    if (u === undefined) {
      u = ++seq.current
      uids.current.set(row, u)
    }
    return u
  }
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [dragging, setDragging] = useState<number | null>(null)

  const toggle = (row: object) =>
    setExpanded(s => {
      const n = new Set(s)
      const u = uidOf(row)
      if (n.has(u)) n.delete(u)
      else n.add(u)
      return n
    })

  const add = () => {
    const row: Record<string, unknown> = {}
    setExpanded(s => new Set(s).add(uidOf(row)))
    onChange([...rows, row])
  }
  const update = (i: number, next: Record<string, unknown>) => {
    const prev = rows[i]
    if (prev) {
      const u = uids.current.get(prev)
      if (u !== undefined) uids.current.set(next, u)
    }
    const out = rows.slice()
    out[i] = next
    onChange(out)
  }
  const remove = (i: number) => onChange(listOrNull(rows.filter((_, j) => j !== i)))
  const drop = (i: number) => {
    const from = dragging
    setDragging(null)
    if (from === null || from === i) return
    onChange(moveItem(rows, from, i))
  }

  return (
    <div className="flex flex-col gap-1.5 min-w-0" id={id}>
      {rows.map((row, i) => {
        const open = expanded.has(uidOf(row))
        return (
          <div
            key={uidOf(row)}
            className={cx("border border-border rounded-dt bg-bg", dragging === i && "opacity-50")}
            onDragOver={e => e.preventDefault()}
            onDrop={() => drop(i)}
          >
            <div className="flex items-center gap-1 py-0.5 pr-1.5 pl-0.5">
              <span
                className="inline-flex p-1 text-fg-subtle cursor-grab"
                title="Drag to reorder"
                draggable
                onDragStart={e => {
                  setDragging(i)
                  e.dataTransfer.effectAllowed = "move"
                }}
                onDragEnd={() => setDragging(null)}
              >
                <Icon name="gripper" />
              </span>
              <button
                type="button"
                className="flex items-center gap-1.5 flex-auto min-w-0 w-full py-1.5 pr-2 pl-0 border-0 bg-transparent text-fg text-left cursor-pointer"
                aria-expanded={open}
                onClick={() => toggle(row)}
              >
                <Icon name={open ? "chevron-down" : "chevron-right"} />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                  {rowSummary(row, i, fields, template)}
                </span>
              </button>
              <button type="button" className={iconButton} title="Remove" aria-label="Remove" onClick={() => remove(i)}>
                <Icon name="close" />
              </button>
            </div>
            {open && (
              <div className="pt-2 pr-3 pb-3 pl-[30px] border-t border-border">
                <OptionsForm fields={fields} value={row} onChange={next => update(i, next)} />
              </div>
            )}
          </div>
        )
      })}
      <button type="button" className={cx(button, "self-start")} onClick={add}>
        <Icon name="add" /> Add item
      </button>
    </div>
  )
}
