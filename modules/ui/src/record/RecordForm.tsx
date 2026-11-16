/**
 * `form` (a record-scoped Edit) and `doc` (its read-only View) — the two-column record form (ported from
 * the Vue ui's ItemForm.vue + FormField.vue). The built-in record page is `properties`; a display naming
 * `form` or `doc` (`display.record.layout`) gets this one. Same contract as `properties`: sections from
 * `form.sections` (a collapsed one shut and last), `hidden` per surface, a control only where `hasControl`
 * says so, a computed value drawn as its View, dimmed, with the computed rule's sentence on hover, and a
 * generated mirror saying where it is set. Wide fields (markdown, objects, maps, lists) span both columns.
 */
import type { FieldRow } from "../api/types.ts"
import { useApp } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { computedReason, hasControl, isMirrorField } from "../lib/field-row.ts"
import { labelOf } from "../lib/format-title.ts"
import { withEdits } from "../lib/record-page.ts"
import type { RecordLayoutProps } from "../registry/props.ts"
import { RenderEdit, RenderView } from "../render/Render.tsx"
import { useSections } from "./use-sections.ts"
import { cx, hint as hintCls, required } from "../styles/classes.ts"
import { computed, sectionHead, sectionToggle } from "./looks.ts"

/** Two columns of fields, one when narrow; a wide field spans both. (was dt-item-form-grid) */
const grid =
  "grid grid-cols-[repeat(2,minmax(0,1fr))] gap-x-6 gap-y-[18px] items-start max-[720px]:grid-cols-[minmax(0,1fr)]"

const isWide = (f: FieldRow) => f.type === "markdown" || f.type === "object" || f.type === "map" || f.many === true

export function RecordForm(props: RecordLayoutProps) {
  const { collection, fields, record, edits, setField, readonly, create } = props
  const { schema } = useApp()
  const { sections, bodyFields, isShut, toggle } = useSections(collection, fields, readonly)
  const current = withEdits(record, edits)

  const field = (f: FieldRow, body = false) => {
    const ro = readonly || !hasControl(f, { create })
    const why = computedReason(f, { create, target: schema.target(f)?.collection })
    const value = f.field in edits ? edits[f.field] : (record?.[f.field] ?? null)
    const note = (f.description ?? "").trim()
    const hint = ro && isMirrorField(f) && f.mirror_of ? (why ?? "") : ""
    return (
      <div key={f.field} className={isWide(f) || body ? "col-span-full" : undefined} data-field={f.field}>
        <label
          className={cx(
            "block font-semibold mb-1.5",
            note &&
              "cursor-help underline decoration-dotted decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-3"
          )}
          htmlFor={ro ? undefined : `f-${f.field}`}
          title={note ? `${note}\n\n${f.field}` : f.field}
        >
          {labelOf(f)}
          {f.required && (
            <span className={required} aria-hidden="true">
              *
            </span>
          )}
        </label>
        {ro ? (
          <div className={why ? computed : undefined} title={why ?? undefined} dir={f.direction}>
            <RenderView field={f} value={value} context="record" record={current} />
            {hint && (
              <p className={hintCls}>
                <Icon name="lock" /> {hint}
              </p>
            )}
          </div>
        ) : (
          <div dir={f.direction}>
            <RenderEdit
              id={`f-${f.field}`}
              field={f}
              value={value}
              create={create}
              record={current}
              onChange={v => setField(f.field, v)}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5" data-layout={readonly ? "doc" : "form"}>
      {sections.map(s => (
        <section
          key={s.title}
          data-section={s.title}
          data-collapsed={s.collapsed ? (isShut(s) ? "shut" : "open") : undefined}
        >
          {s.title && !s.collapsed && <h3 className={sectionHead}>{s.title}</h3>}
          {s.title && s.collapsed && (
            <button type="button" className={sectionToggle} aria-expanded={!isShut(s)} onClick={() => toggle(s)}>
              <Icon name={isShut(s) ? "chevron-right" : "chevron-down"} /> {s.title}
            </button>
          )}
          {!isShut(s) && <div className={grid}>{s.fields.map(f => field(f))}</div>}
        </section>
      ))}
      {bodyFields.length > 0 && <div className={grid}>{bodyFields.map(f => field(f, true))}</div>}
    </div>
  )
}
