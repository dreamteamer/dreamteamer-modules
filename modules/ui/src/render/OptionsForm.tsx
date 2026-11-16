/**
 * A set of fields drawn as a small form, each by its resolved Edit (ported from the Vue ui's
 * OptionsForm.vue + the slice of FormField it uses). Two inputs, one form:
 *   - `options`: an extension's declared `OptionFieldDef[]`, each turned into a field row by `optionRow` — its
 *     `note` printed under the control, its `when` and `group` honoured;
 *   - `fields`: field rows of the display contract as they are — an object's sub-field rows, drawn by EditList
 *     and EditNested over one item.
 * No bespoke settings UI anywhere: an option IS a field.
 */
import { useId } from "react"
import type { FieldRow } from "../api/types.ts"
import { OPTION_GROUPS, optionRow, type OptionFieldDef } from "../registry/index.ts"
import { RenderEdit } from "./Render.tsx"
import { cx, hint, required } from "../styles/classes.ts"

interface Entry {
  row: FieldRow
  def?: OptionFieldDef
}

export function OptionsForm({
  options,
  fields,
  value,
  onChange,
}: {
  options?: OptionFieldDef[]
  fields?: FieldRow[]
  value: Record<string, unknown>
  onChange(value: Record<string, unknown>): void
}) {
  const base = useId()
  const entries: Entry[] = [
    ...(options ?? []).map(def => ({ row: optionRow(def), def })),
    ...(fields ?? []).map(row => ({ row })),
  ]
  // `when` sees the values WITH defaults applied, so a predicate can rely on a declared default
  const values: Record<string, unknown> = { ...value }
  for (const { row } of entries)
    if (values[row.field] === undefined && row.default !== undefined) values[row.field] = row.default
  const visible = entries.filter(({ def }) => !def?.when || def.when(values))

  // consecutive entries sharing a `group` become one block under the group's heading — runs, not buckets, so the
  // declaration order stays the drawing order
  const blocks: Array<{ key: string; group?: string; heading?: string; entries: Entry[] }> = []
  visible.forEach((entry, i) => {
    const last = blocks[blocks.length - 1]
    const group = entry.def?.group
    if (last && group && last.group === group) last.entries.push(entry)
    else
      blocks.push({
        key: `${i}:${entry.row.field}`,
        group,
        heading: group ? OPTION_GROUPS[group] : undefined,
        entries: [entry],
      })
  })

  return (
    <div className="grid gap-3">
      {blocks.map(block => (
        <div key={block.key} className="grid gap-2">
          {block.heading && (
            <h4 className="m-0 text-small font-semibold uppercase tracking-[0.04em] text-fg-subtle">{block.heading}</h4>
          )}
          {block.entries.map(({ row, def }, i) => {
            const id = `${base}-${i}-${row.field}`
            const note = (row.description ?? "").trim()
            return (
              <div
                key={`${i}:${row.field}`}
                className="grid gap-1 [&>label]:text-fg-subtle [&_[data-hint]]:m-0"
                data-field={row.field}
              >
                <label htmlFor={id} title={def ? undefined : note || undefined}>
                  {row.title}
                  {row.required && <span className={required}> *</span>}
                </label>
                <RenderEdit
                  id={id}
                  field={row}
                  value={value[row.field] ?? row.default ?? null}
                  onChange={v => onChange({ ...value, [row.field]: v })}
                />
                {def && note && <p className={cx(hint, "m-0")}>{note}</p>}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
