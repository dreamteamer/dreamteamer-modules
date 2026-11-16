/**
 * `properties` — the record page's DEFAULT layout (ported from the Vue ui's ItemProperties.vue): a note's
 * properties block, not a web form. One-line `icon · label · value` rows with no input chrome, then the body
 * drawn as the document beneath a hairline. Registered as a record-scoped Edit AND View, so it backs both modes
 * of the same page: the pencil flips `readonly` and the widgets swap in place, each row keeping its geometry.
 *
 * The display contract's per-field answers, as the form follows them: SECTIONS from `form.sections` (a heading
 * over each, a collapsed one shut and last, the unclaimed fields unnamed, the body after them all); `hidden` per
 * surface; a control only where `hasControl` says so; a computed value dimmed with THE computed rule's sentence.
 *
 * A LIST RELATION on the read is drawn as the TARGET COLLECTION'S OWN VIEW — its table, columns, sort and
 * paging, scoped to exactly the related records (`RelationField`, `lib/relation-view.ts`); the row then stacks
 * to full width. The plan is decided once per row, for both the component and the geometry.
 *
 * On the read, a collection that declares `display.record.options.stages` gets its STAGE MAP above the rows
 * (`StageMap.tsx`).
 *
 * A generated MIRROR lists only the owners in its own repo; on a collection that reads another root the owner
 * collection is asked how many records point here, and the difference is said beside it.
 */
import { useEffect, useMemo, useState } from "react"
import { listRecords } from "../api/client.ts"
import type { FieldRow } from "../api/types.ts"
import { useApp, useSignal } from "../app-context.tsx"
import { HoverCard, type HoverLine } from "../components/HoverCard.tsx"
import { Icon } from "../components/Icon.tsx"
import { computedReason, hasControl, isMirrorField } from "../lib/field-row.ts"
import { fieldIcon } from "../lib/field-icon.ts"
import { labelOf } from "../lib/format-title.ts"
import { isEmptyValue, withEdits } from "../lib/record-page.ts"
import { embeddedRelationPlan, type EmbeddedRelationPlan } from "../lib/relation-view.ts"
import { hasForeignSource } from "../lib/sources.ts"
import { uiViews } from "../lib/ui-views.ts"
import type { RecordLayoutProps } from "../registry/props.ts"
import { RenderEdit, RenderView } from "../render/Render.tsx"
import { RelationField } from "./RelationField.tsx"
import { StageMap } from "./StageMap.tsx"
import { useSections } from "./use-sections.ts"

export function RecordProperties(props: RecordLayoutProps) {
  const { collection, fields, record, edits, setField, readonly, create, options } = props
  const { schema, version } = useApp()
  const views = useSignal(uiViews) ?? []
  const { sections, bodyFields, isShut, toggle } = useSections(collection, fields, readonly)
  const current = withEdits(record, edits)
  const valueOf = (f: FieldRow) => (f.field in edits ? edits[f.field] : (record?.[f.field] ?? null))
  const targetOf = (f: FieldRow) => schema.target(f)?.collection
  const isReadonly = (f: FieldRow) => readonly || !hasControl(f, { create })
  const why = (f: FieldRow) => computedReason(f, { create, target: targetOf(f) })

  // ---- the mirror's owners in other repos ----------------------------------------------------------------
  const foreign = hasForeignSource(schema.collection(collection)?.sources)
  const id = typeof record?.["id"] === "string" ? (record["id"] as string) : null
  const [overflow, setOverflow] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!readonly || !foreign || !id) return
    let live = true
    for (const f of fields) {
      const target = schema.target(f)?.collection
      if (!isMirrorField(f) || !f.mirror_of || !target) continue
      const value = record?.[f.field]
      const listed = Array.isArray(value) ? value.length : value ? 1 : 0
      listRecords(target, { limit: 1, filter: { [f.mirror_of]: { _eq: `${collection}/${id}` } } }).then(
        page => live && setOverflow(o => ({ ...o, [f.field]: Math.max(0, (page.total ?? listed) - listed) })),
        () => {}
      )
    }
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-asked per record and per invalidation
  }, [readonly, foreign, id, collection, version])

  // ---- which rows draw the target's own view -------------------------------------------------------------
  const plans = useMemo(() => {
    const out = new Map<string, EmbeddedRelationPlan>()
    for (const s of sections)
      for (const f of s.fields) {
        if (!(readonly || !hasControl(f, { create }))) continue
        const plan = embeddedRelationPlan({
          field: f,
          value: f.field in edits ? edits[f.field] : record?.[f.field],
          target: schema.target(f)?.collection,
          views,
          pageOptions: options,
        })
        if (plan) out.set(f.field, plan)
      }
    return out
  }, [sections, readonly, create, edits, record, schema, views, options])

  const hoverLines = (f: FieldRow): HoverLine[] => {
    const lines: HoverLine[] = [{ text: labelOf(f), kind: "title" }]
    const note = (f.description ?? "").trim()
    if (note) lines.push({ text: note })
    const w = why(f)
    if (w && w !== note) lines.push({ text: w })
    const more = overflow[f.field] ?? 0
    if (more > 0)
      lines.push({
        text: `${more} record${more === 1 ? "" : "s"} in other sources point${more === 1 ? "s" : ""} here — this list shows only its own repo's.`,
      })
    lines.push({ text: f.field, kind: "code" })
    return lines
  }

  const row = (f: FieldRow) => {
    const ro = isReadonly(f)
    const w = why(f)
    const value = valueOf(f)
    const plan = plans.get(f.field)
    const more = overflow[f.field] ?? 0
    const hint = ro && isMirrorField(f) && f.mirror_of ? (w ?? "") : ""
    return (
      <div
        key={f.field}
        className={`dt-prop${plan ? " is-stacked" : ""}${w !== null ? " is-computed" : ""}`}
        data-field={f.field}
      >
        <HoverCard lines={hoverLines(f)} className={`dt-prop-key${f.description ? " is-documented" : ""}`}>
          <Icon name={fieldIcon(f)} className="dt-prop-icon" />
          <label className="dt-prop-label" htmlFor={ro ? undefined : `f-${f.field}`}>
            {labelOf(f)}
          </label>
          {f.required && (
            <span className="dt-required" aria-hidden="true">
              *
            </span>
          )}
        </HoverCard>
        {ro && isEmptyValue(value) ? (
          <HoverCard lines={hoverLines(f)} className="dt-prop-value">
            <span className="dt-prop-read">
              <span className="dt-prop-empty">Empty</span>
              {more > 0 && <span className="dt-prop-soft">+{more} elsewhere</span>}
            </span>
          </HoverCard>
        ) : (
          <div
            className={`dt-prop-value${w !== null && !plan ? " dt-computed" : ""}`}
            title={plan ? undefined : (w ?? undefined)}
            dir={f.direction}
          >
            {ro ? (
              <span className="dt-prop-read">
                {plan ? (
                  <RelationField plan={plan} />
                ) : (
                  <RenderView field={f} value={value} context="record" record={current} />
                )}
                {hint && (
                  <span className="dt-prop-generated" title={hint}>
                    <Icon name="lock" /> {hint}
                  </span>
                )}
                {more > 0 && <span className="dt-prop-soft">{more} more from other sources</span>}
              </span>
            ) : (
              <RenderEdit
                id={`f-${f.field}`}
                field={f}
                value={value}
                create={create}
                record={current}
                onChange={v => setField(f.field, v)}
              />
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="dt-props" data-layout="properties">
      {/* the lifecycle its collection declares, on the read only — nothing at all for a collection with no stages */}
      {readonly && !create && record && (
        <StageMap collection={collection} record={record} fields={fields} options={options} />
      )}
      {sections.map(s => (
        <section
          key={s.title}
          className={`dt-props-list${s.title ? " is-named" : ""}`}
          data-section={s.title}
          data-collapsed={s.collapsed ? (isShut(s) ? "shut" : "open") : undefined}
        >
          {s.title && !s.collapsed && <h3 className="dt-props-section">{s.title}</h3>}
          {s.title && s.collapsed && (
            <button
              type="button"
              className="dt-props-section dt-link-button"
              aria-expanded={!isShut(s)}
              onClick={() => toggle(s)}
            >
              <Icon name={isShut(s) ? "chevron-right" : "chevron-down"} /> {s.title}
            </button>
          )}
          {!isShut(s) && s.fields.map(row)}
        </section>
      ))}
      {/* the document: no label, no box — an empty body on the read draws nothing, not even the rule */}
      {bodyFields.map(f =>
        !isReadonly(f) ? (
          <section key={f.field} className="dt-props-body" dir={f.direction}>
            <RenderEdit
              id={`f-${f.field}`}
              field={f}
              value={valueOf(f)}
              create={create}
              record={current}
              onChange={v => setField(f.field, v)}
            />
          </section>
        ) : isEmptyValue(valueOf(f)) ? null : (
          <section key={f.field} className="dt-props-body" dir={f.direction}>
            <RenderView field={f} value={valueOf(f)} context="record" record={current} />
          </section>
        )
      )}
    </div>
  )
}
