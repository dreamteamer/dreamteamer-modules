/**
 * THE GANTT — the built-in `gantt` List (ported from the Vue ui's ListGantt.vue): one horizontal bar per record
 * from a start date to an end date on a shared time axis, the rows carved into the SAME bands the table, the cards
 * and the board draw (`lib/grouping.ts`, `GroupHeader`). The calendar answers "what is on the 14th"; this answers
 * "what overlaps what, and for how long".
 *
 * No chart library: a CSS grid whose columns are days. A bar is a grid item placed by grid LINES,
 * `columnOf(start) / columnOf(end) + 1` — never `span n`, which past a fold is no longer a day count. The axis
 * (scale, ticks, the FOLDS of runs in which nothing starts or ends, the day → column map) is lib/gantt-axis.ts; the
 * record-side decisions (spans, colours, labels, lane shapes) are lib/gantt-rows.ts.
 *
 *   · A record with no start is NOT dropped: it is listed in the undated tail under the chart, with a count.
 *   · An end before its start is DRAWN — a dashed point at the start whose tooltip says why.
 *   · Folds start folded (`fold_gaps`, default on); a header cell opens one. A grouped chart starts with every
 *     lane COLLAPSED (`start_collapsed`, default on) — each lane one row carrying its extent, one segment per run.
 *   · A lane grouped by a reference is named after the record it points at (`useGroupLabels.ts`): the view's
 *     `group_title`, else the target's `record_title`; its picture and one-line summary come from the same record.
 *   · The bar's text rides in the timeline — inside when the bar is wide enough, beside it from its start when not.
 *
 * It fills height so the horizontal scroll lives INSIDE the chart, not under the whole browse.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import type { Row } from "../api/client.ts"
import type { FieldRow } from "../api/types.ts"
import { Icon } from "../components/Icon.tsx"
import { GroupHeader } from "../browse/GroupHeader.tsx"
import { themeColor } from "../lib/collection-display.ts"
import { buildAxis, DAY_PX, todayNumber } from "../lib/gantt-axis.ts"
import {
  bandRange,
  bandShapeOf,
  barColor,
  barLabel,
  barTitle,
  colorMapOf,
  spansOf,
  type BandShape,
  type Span,
} from "../lib/gantt-rows.ts"
import { labelFor } from "../lib/group-label.ts"
import { bucketize, type Bucket } from "../lib/grouping.ts"
import { rowContext } from "../lib/vscode-context.ts"
import type { ListProps } from "../registry/props.ts"
import { ListEmpty } from "./ListEmpty.tsx"
import { useGroupLabels } from "./useGroupLabels.ts"
import { cx, iconButton, listEmpty, subtle } from "../styles/classes.ts"
import { calChip } from "./looks.ts"

// ---- the looks (was dt-gantt-*) ---------------------------------------------------------------------------------
// The axis sizes ride on three variables the canvas sets (lib/gantt-axis.ts writes its grid in them): the gutter,
// a fold's column and a day's width at the scale. A lane's rail colour is `--dt-lane-rail`, set inline per band.
const SCALE: Record<string, string> = {
  day: "[--dt-gantt-day:30px]",
  week: "[--dt-gantt-day:7px]",
  month: "[--dt-gantt-day:2.4px]",
}
/** The sticky left column: a row's title, the header's field names, a band's header. */
const gutter = (opts: { band?: boolean; lane?: boolean; head?: boolean; row?: boolean } = {}) =>
  cx(
    "flex-[0_0_var(--dt-gantt-gutter)] w-(--dt-gantt-gutter) box-border sticky left-0 z-[2] bg-bg py-1 overflow-hidden text-ellipsis whitespace-nowrap",
    opts.band ? "min-h-9 flex items-center gap-0.5 pr-0" : "pr-2.5",
    opts.lane && "border-l-2 border-l-(--dt-lane-rail)",
    opts.lane && opts.row ? "pl-3" : "pl-0",
    opts.row && "group-hover/row:bg-bg-hover",
    opts.head && "text-fg-subtle text-small uppercase tracking-[0.02em]"
  )
/** The day grid of a row; its columns are the axis template, set inline. */
const track = (band = false) => cx("grid flex-none items-center", band ? "min-h-9" : "min-h-7")
const barLabelBase = "text-small leading-none whitespace-nowrap pointer-events-none"
/** A band's span under its header, with an end tick at either side. */
const bandBar =
  "relative h-[3px] min-w-[2px] rounded-full bg-[var(--dt-lane-rail,var(--dt-border))] before:content-[''] before:absolute before:-top-[3px] before:left-0 before:w-[2px] before:h-[9px] before:rounded-[1px] before:bg-inherit after:content-[''] after:absolute after:-top-[3px] after:right-0 after:w-[2px] after:h-[9px] after:rounded-[1px] after:bg-inherit"
const undatedCls = "flex flex-wrap items-center gap-1.5 flex-none pt-1.5 border-t border-border text-small"

/** Roughly the narrowest bar that can hold readable text plus its own padding. */
const LABEL_FITS_PX = 72

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null)

export function ListGantt({ state }: ListProps) {
  const options = state.listOptions["gantt"] ?? {}
  const fieldNamed = (key: string): FieldRow | null => {
    const name = text(options[key])
    return name ? (state.fields.find(f => f.field === name.trim()) ?? null) : null
  }
  // `start` blank IS automatic (first date, then datetime); `end` blank means every record is a point
  const startField =
    fieldNamed("start") ??
    state.fields.find(f => f.type === "date") ??
    state.fields.find(f => f.type === "datetime") ??
    null
  const endField = fieldNamed("end")
  const records = state.records

  const spans = useMemo(
    () => (startField ? spansOf(records, startField.field, endField?.field ?? null, r => state.recordTitleOf(r)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recordTitleOf follows the collection row
    [records, startField?.field, endField?.field]
  )
  const spanOf = useMemo(() => new Map<Row, Span<Row>>(spans.map(s => [s.record, s])), [spans])
  const undated = records.filter(r => !spanOf.has(r))

  // ── the axis ──
  const foldGaps = options["fold_gaps"] !== false
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const today = todayNumber()
  const axis = useMemo(() => buildAxis(spans, { today, fold: foldGaps, expanded }), [spans, today, foldGaps, expanded])
  const template = axis?.template ?? "var(--dt-gantt-day)"
  const todayOffset = axis && today >= axis.origin && today < axis.origin + axis.days ? axis.offsetOf(today) : null
  const toggleFold = (key: string) =>
    setExpanded(s => {
      const next = new Set(s)
      if (!next.delete(key)) next.add(key)
      return next
    })

  // ── colour: the browse's colorBy (this view's color_by, else the collection's) ──
  const colorField = state.colorBy ? (state.fields.find(f => f.field === state.colorBy) ?? null) : null
  const colors = useMemo(() => colorMapOf(colorField, records), [colorField, records])

  // ── the bar's text ──
  const barTemplate = text(options["template"])
  const labelField = fieldNamed("bar_label")?.field ?? null
  const labelInside = (s: Span<Row>) =>
    !!axis && (axis.columnOf(s.end) + 1 - axis.columnOf(s.start)) * DAY_PX[axis.scale] >= LABEL_FITS_PX
  const barStyle = (s: Span<Row>): CSSProperties => {
    const style: Record<string, string> = { gridColumn: `${axis!.columnOf(s.start)} / ${axis!.columnOf(s.end) + 1}` }
    const id = barColor(s.record, colorField, colors.map)
    if (id) style["--dt-gantt-bar"] = themeColor(id)
    return style as CSSProperties
  }

  // ── bands: only PLACEABLE records are banded, and a list-valued field fans a record into each of its values ──
  const groupField = fieldNamed("group_by")
  const grouped = groupField !== null
  const bands = useMemo<Bucket[]>(() => {
    const placed = spans.map(s => s.record)
    if (!groupField) return [{ value: "", label: "", records: placed }]
    return bucketize(groupField, placed, {
      showUngrouped: options["show_ungrouped_rows"] === true,
      showEmpty: options["show_empty_rows"] === true,
      multi: true,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the two switches are read off options
  }, [spans, groupField, options["show_ungrouped_rows"], options["show_empty_rows"]])
  const group = useGroupLabels({
    values: bands.map(b => b.value),
    field: groupField,
    template: text(options["group_title"]),
    summaryTemplate: text(options["group_summary"]),
    iconField: text(options["group_icon"])?.trim() ?? null,
  })
  const bandLabel = (b: Bucket) => labelFor(b.value, b.label, group.labels)
  const shapes = useMemo(() => {
    const map = new Map<string, BandShape>()
    for (const b of bands) {
      const shape = bandShapeOf(b.records.map(r => spanOf.get(r as Row)).filter((s): s is Span<Row> => !!s))
      if (shape) map.set(b.value, shape)
    }
    return map
  }, [bands, spanOf])

  // a grouped chart starts COLLAPSED — once per band, so a lane the reader opened never snaps shut on a reload
  const startCollapsed = options["start_collapsed"] !== false
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const introduced = useRef(new Set<string>())
  const bandKey = bands.map(b => b.value).join("\n")
  useEffect(() => {
    if (!grouped || !startCollapsed) return
    const fresh = bands.map(b => b.value).filter(v => !introduced.current.has(v))
    if (!fresh.length) return
    for (const v of fresh) introduced.current.add(v)
    setCollapsed(c => new Set([...c, ...fresh]))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the band values
  }, [bandKey, grouped, startCollapsed])
  const toggleBand = (value: string) =>
    setCollapsed(c => {
      const next = new Set(c)
      if (!next.delete(value)) next.add(value)
      return next
    })

  if (!records.length) return <ListEmpty state={state} />
  if (!startField)
    return <p className={listEmpty}>No date field to lay records out on — set one in Layout options (Start).</p>

  return (
    <div className="flex flex-col flex-auto min-h-0 gap-2.5">
      {axis && (
        <div className={cx("flex-1 min-h-0 overflow-auto", state.loading && "opacity-70")}>
          <div
            className={cx(
              "relative w-max min-w-full [--dt-gantt-gutter:180px] [--dt-gantt-fold:84px]",
              SCALE[axis.scale]
            )}
          >
            <div className="flex items-stretch sticky top-0 z-[3] bg-bg shadow-[inset_0_-1px_0_var(--dt-border)]">
              <div className={gutter({ head: true })}>
                {startField.field}
                {endField && <> → {endField.field}</>}
              </div>
              <div className={track()} style={{ gridTemplateColumns: template }}>
                {axis.ticks.map(t => (
                  <div
                    key={t.key}
                    className="row-start-1 text-small text-fg-subtle py-1 px-0 border-l border-border overflow-hidden whitespace-nowrap text-center"
                    style={{ gridColumn: `${t.column} / span ${t.columns}` }}
                  >
                    {t.label}
                  </div>
                ))}
                {axis.folds.map(f => (
                  <button
                    key={f.key}
                    type="button"
                    className="row-start-1 flex items-center justify-center gap-px py-1 px-0 border-y-0 border-x border-dashed border-border bg-[color-mix(in_srgb,var(--dt-fg-subtle)_10%,transparent)] text-fg-subtle text-small leading-none cursor-pointer overflow-hidden whitespace-nowrap hover:text-fg hover:bg-bg-hover"
                    style={{ gridColumn: String(f.column) }}
                    title={f.title}
                    aria-expanded={f.expanded}
                    onClick={() => toggleFold(f.key)}
                  >
                    <Icon name={f.expanded ? "chevron-left" : "chevron-right"} />
                    <span className={cx("overflow-hidden text-ellipsis", f.expanded && "hidden")}>{f.label}</span>
                  </button>
                ))}
              </div>
            </div>
            {axis.folds.map(f => (
              <div
                key={`strip/${f.key}`}
                className={cx(
                  "absolute top-0 bottom-0 w-(--dt-gantt-fold) border-y-0 border-dashed border-border pointer-events-none z-0",
                  f.expanded ? "border-l" : "border-x bg-[color-mix(in_srgb,var(--dt-fg-subtle)_7%,transparent)]"
                )}
                style={{ left: axis.offsetOf(f.firstDay) }}
                aria-hidden="true"
              />
            ))}
            {todayOffset && (
              <div
                className="absolute top-0 bottom-0 w-0 border-l border-accent pointer-events-none z-[1]"
                style={{ left: todayOffset }}
                aria-hidden="true"
              />
            )}
            {bands.map(band => {
              const shut = collapsed.has(band.value)
              const shape = shapes.get(band.value)
              const rail = band.color || band.background
              return (
                <section
                  key={band.value}
                  className={
                    grouped
                      ? cx(
                          "[--dt-lane-rail:var(--dt-border)] [section+&]:mt-2.5 [section+&]:border-t [section+&]:border-border [section+&]:pt-1.5",
                          shut ? "pb-0" : "pb-1.5"
                        )
                      : undefined
                  }
                  style={rail ? ({ "--dt-lane-rail": themeColor(rail) } as CSSProperties) : undefined}
                >
                  {grouped && (
                    <div className="flex items-stretch mb-0.5">
                      <div className={gutter({ band: true, lane: true })}>
                        <button
                          type="button"
                          className={iconButton}
                          aria-expanded={!shut}
                          title={shut ? "Expand" : "Collapse"}
                          onClick={() => toggleBand(band.value)}
                        >
                          <Icon name={shut ? "chevron-right" : "chevron-down"} />
                        </button>
                        <GroupHeader
                          label={bandLabel(band)}
                          count={band.records.length}
                          description={group.summaries[band.value] ?? band.description}
                          icon={group.icons[band.value] ?? band.icon}
                          color={band.color}
                          background={band.background}
                        />
                      </div>
                      <div className={track(true)} style={{ gridTemplateColumns: template }}>
                        {shape?.runs.map((run, i) => (
                          <div
                            key={`run/${run.start}`}
                            className={bandBar}
                            style={{ gridColumn: `${axis.columnOf(run.start)} / ${axis.columnOf(run.end) + 1}` }}
                            title={`${bandLabel(band)} — ${bandRange(shape)}`}
                          >
                            {i === 0 && (
                              <span className="absolute left-0 top-2 whitespace-nowrap text-small text-fg-subtle pointer-events-none">
                                {bandRange(shape)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {!shut &&
                    (band.records as Row[]).map(r => {
                      const s = spanOf.get(r)!
                      const label = barLabel(s, barTemplate, labelField)
                      const inside = labelInside(s)
                      return (
                        <div
                          key={`${band.value}/${String(r["$source"] ?? "")}/${r.id}`}
                          className="group/row flex items-stretch cursor-pointer hover:bg-bg-hover"
                          data-vscode-context={rowContext(state.collection, r.id)}
                          onClick={() => state.openRecord(r)}
                        >
                          <div className={gutter({ lane: grouped, row: true })} title={s.title}>
                            {s.title || "—"}
                          </div>
                          <div className={track()} style={{ gridTemplateColumns: template }}>
                            <div
                              className={cx(
                                "relative flex items-center h-4 min-w-[3px]",
                                s.start === s.end ? "rounded-full" : "rounded-[3px]",
                                s.inverted
                                  ? "bg-transparent border border-dashed border-danger"
                                  : "bg-[var(--dt-gantt-bar,var(--dt-accent))]"
                              )}
                              style={barStyle(s)}
                              title={barTitle(s)}
                            >
                              {label && (
                                <span
                                  className={cx(
                                    barLabelBase,
                                    inside
                                      ? cx(
                                          "py-0 px-1.5 overflow-hidden text-ellipsis font-medium",
                                          s.inverted ? "text-danger" : "[color:var(--vscode-editor-background,#fff)]"
                                        )
                                      : "absolute left-0 py-0 px-1 rounded-xs bg-[color-mix(in_srgb,var(--dt-bg)_72%,transparent)] text-fg-subtle max-w-[60ch] overflow-hidden text-ellipsis group-hover/row:text-fg"
                                  )}
                                >
                                  {label}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                </section>
              )
            })}
          </div>
        </div>
      )}
      {colors.uncoloured > 0 && (
        <div className={undatedCls}>
          <span className={subtle}>
            {colors.uncoloured} more value{colors.uncoloured > 1 ? "s" : ""} of {colorField?.field} than the palette has
            colours — {colors.uncoloured > 1 ? "those bars share" : "that bar keeps"} the neutral
          </span>
        </div>
      )}
      {undated.length > 0 && (
        <div className={undatedCls}>
          <span className={subtle}>
            {undated.length} undated — no {startField.field} to place {undated.length > 1 ? "them" : "it"} on
          </span>
          {undated.map(r => (
            <button
              type="button"
              key={`${String(r["$source"] ?? "")}/${r.id}`}
              className={calChip(false, true)}
              data-vscode-context={rowContext(state.collection, r.id)}
              onClick={() => state.openRecord(r)}
            >
              {state.recordTitleOf(r) || r.id}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
