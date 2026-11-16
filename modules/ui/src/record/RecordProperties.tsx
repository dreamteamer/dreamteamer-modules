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
 * paging, scoped to exactly the related records (`RelationField`, `lib/relationView.ts`); the row then stacks
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
import { useApp, useSignal } from "../AppContext.tsx"
import { HoverCard, type HoverLine } from "../components/HoverCard.tsx"
import { Icon } from "../components/Icon.tsx"
import { computedReason, hasControl, isMirrorField } from "../lib/fieldRow.ts"
import { fieldIcon } from "../lib/fieldIcon.ts"
import { labelOf } from "../lib/formatTitle.ts"
import { isEmptyValue, withEdits } from "../lib/recordPage.ts"
import { embeddedRelationPlan, type EmbeddedRelationPlan } from "../lib/relationView.ts"
import { hasForeignSource } from "../lib/sources.ts"
import { uiViews } from "../lib/uiViews.ts"
import type { RecordLayoutProps } from "../registry/props.ts"
import { RenderEdit, RenderView } from "../render/Render.tsx"
import { RelationField } from "./RelationField.tsx"
import { StageMap } from "./StageMap.tsx"
import { useSections } from "./useSections.ts"
import { cx, required } from "../styles/classes.ts"
import { computed, sectionHead, sectionToggle } from "./looks.ts"

// ---- the looks (was dt-prop*, dt-props*) ----------------------------------------------------------------------------
/** A property's value cell. */
const valueCls = "flex flex-col justify-center min-h-[30px] min-w-0 py-[3px] px-0"
/** The read value inside it; a relation drawn as its own view (stacked) takes the full width. */
const readCls = (stacked: boolean) => (stacked ? "block p-0 min-w-0" : "py-0 px-[9px] min-w-0")
/** "Empty", and the notes beside a value. */
const quiet = "text-fg-subtle opacity-80"
const aside = "ml-2 text-small"
/** The document under the properties: ruled off, unless it is all there is. */
const bodyCls = "mt-5 pt-5 border-t border-border first:mt-0 first:pt-0 first:border-t-0"

/** In edit mode a property's control loses its chrome until it is touched — a boxed input per row would rebuild
 *  the form this layout replaces. Hovering the row shows the box (that rule sits on the row, and outranks focus);
 *  a focused text control shows the input's own. The controls carry `data-control` (edits/*, Select). */
const CONTROL_CHROME =
  "[&_[data-control]]:bg-transparent [&_[data-control]]:border-transparent [&_[data-control=text]:focus]:bg-input-bg [&_[data-control=text]:focus]:border-focus"

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
        className={cx(
          "grid items-start min-h-[30px] rounded-dt hover:bg-[color-mix(in_srgb,var(--dt-bg-subtle)_60%,transparent)]",
          plan
            ? "grid-cols-[minmax(0,1fr)] gap-0 mb-3"
            : "grid-cols-[172px_minmax(0,1fr)] gap-2 max-[720px]:grid-cols-[minmax(0,1fr)] max-[720px]:gap-0",
          "[&:hover_[data-prop-value]_[data-control]]:bg-bg-subtle [&:hover_[data-prop-value]_[data-control]]:border-border"
        )}
        data-field={f.field}
      >
        <HoverCard
          lines={hoverLines(f)}
          className={cx(
            "flex items-center gap-2 min-h-[30px] pl-1 min-w-0 text-fg-subtle",
            f.description &&
              "cursor-help [&:hover_label]:underline [&:hover_label]:decoration-dotted [&:hover_label]:decoration-current [&:hover_label]:underline-offset-3"
          )}
        >
          <Icon name={fieldIcon(f)} className="flex-none" />
          <label className="overflow-hidden text-ellipsis whitespace-nowrap" htmlFor={ro ? undefined : `f-${f.field}`}>
            {labelOf(f)}
          </label>
          {f.required && (
            <span className={required} aria-hidden="true">
              *
            </span>
          )}
        </HoverCard>
        {ro && isEmptyValue(value) ? (
          <HoverCard lines={hoverLines(f)} className={valueCls}>
            <span className={readCls(false)}>
              <span className={quiet}>Empty</span>
              {more > 0 && <span className={cx(quiet, aside)}>+{more} elsewhere</span>}
            </span>
          </HoverCard>
        ) : (
          <div
            className={cx(valueCls, w !== null && !plan && computed, CONTROL_CHROME)}
            data-prop-value
            title={plan ? undefined : (w ?? undefined)}
            dir={f.direction}
          >
            {ro ? (
              <span className={readCls(!!plan)}>
                {plan ? (
                  <RelationField plan={plan} />
                ) : (
                  <RenderView field={f} value={value} context="record" record={current} />
                )}
                {hint && (
                  <span className={cx(quiet, aside)} title={hint}>
                    <Icon name="lock" /> {hint}
                  </span>
                )}
                {more > 0 && <span className={cx(quiet, aside)}>{more} more from other sources</span>}
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
    <div className="flex flex-col" data-layout="properties">
      {/* the lifecycle its collection declares, on the read only — nothing at all for a collection with no stages */}
      {readonly && !create && record && (
        <StageMap collection={collection} record={record} fields={fields} options={options} />
      )}
      {sections.map((s, i) => (
        <section
          key={s.title}
          className={i > 0 && (s.title || sections[i - 1]!.title) ? "mt-4" : undefined}
          data-section={s.title}
          data-collapsed={s.collapsed ? (isShut(s) ? "shut" : "open") : undefined}
        >
          {s.title && !s.collapsed && <h3 className={sectionHead}>{s.title}</h3>}
          {s.title && s.collapsed && (
            <button type="button" className={sectionToggle} aria-expanded={!isShut(s)} onClick={() => toggle(s)}>
              <Icon name={isShut(s) ? "chevron-right" : "chevron-down"} /> {s.title}
            </button>
          )}
          {!isShut(s) && s.fields.map(row)}
        </section>
      ))}
      {/* the document: no label, no box — an empty body on the read draws nothing, not even the rule */}
      {bodyFields.map(f =>
        !isReadonly(f) ? (
          <section key={f.field} className={bodyCls} dir={f.direction}>
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
          <section key={f.field} className={bodyCls} dir={f.direction}>
            <RenderView field={f} value={valueOf(f)} context="record" record={current} />
          </section>
        )
      )}
    </div>
  )
}
