/**
 * THE TABLE — the built-in `table` List (ported from the Vue ui's DataTable.vue): a thin renderer over the
 * browse's state. A checkbox column for the batch selection; a header per column that sorts it (ascending, then
 * descending) and keeps a field's `width` as a minimum in characters; each cell the field's resolved View.
 *
 * GROUPED, it is one `<tbody>` per band — a table may have many, which is exactly what a band is, so the columns
 * stay aligned across all of them for free. A band's header carries the value's glyph, label and colour from the
 * enum map, and for a REFERENCE the referenced record's title (`lib/record-cache.ts`), the same name a relation
 * cell one row below shows; until it lands, the de-slugged reference. Ungrouped, it is one implicit band with no
 * header. Collapsing a band lasts as long as the table: a saved view reopening with bands shut would read as
 * missing data.
 *
 * Its own scroll box (`fillsHeight`): the column header sticks and the pager under it never walks off screen.
 * Loading and empty are said once for the whole result set, never per band; rows already drawn stay put while a
 * re-read is in flight.
 */
import { useEffect, useMemo, useState } from "react"
import { rowContext } from "../lib/vscode-context.ts"
import type { FieldRow } from "../api/types.ts"
import type { Row } from "../api/client.ts"
import { useApp, useSignal } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { GroupHeader } from "../browse/GroupHeader.tsx"
import { computedReason, isRelationField } from "../lib/field-row.ts"
import { fileBases } from "../lib/file-record.ts"
import { labelOf } from "../lib/format-title.ts"
import { bucketize, UNGROUPED, type Bucket } from "../lib/grouping.ts"
import { initialsOf } from "../lib/initials.ts"
import { askTitles, knownTitle, referenceTitlesChanged } from "../lib/record-cache.ts"
import { resolveRowSize } from "../lib/row-size.ts"
import { DUPLICATES_FIELD } from "../lib/sources.ts"
import type { ListProps } from "../registry/props.ts"
import { RenderView } from "../render/Render.tsx"
import { cx, iconButton, linkButton } from "../styles/classes.ts"

// ---- the looks (was dt-table, dt-table-scroll, dt-density-*, dt-group-row, …) --------------------------------------
// Every cell carries its own classes, the density's padding chosen here: a rule on the <table> for the cells would
// tie with a row's or a density's override, and Tailwind orders ties by the stylesheet, not by intent.
/** What every cell shares. */
const cellCore = "text-left px-3 border-b border-border whitespace-nowrap overflow-hidden text-ellipsis"
/** …and a body cell, which also caps its width and keeps a View's row of chips, labels or references on one line. */
const cellCapped = "max-w-[320px] [&_[data-items]]:flex-nowrap"
const padY = (size: string, head = false) =>
  size === "compact" ? "py-[3px]" : size === "comfortable" && !head ? "py-3" : "py-[7px]"
const headCell = (size: string) =>
  cx(
    cellCore,
    "max-w-[320px]",
    padY(size, true),
    "text-small uppercase tracking-[0.04em] text-fg-subtle font-semibold bg-bg-subtle sticky top-0 z-[2] [&_.codicon]:ml-1 [&_.codicon]:align-[-2px]"
  )
/** The checkbox column. */
const checkCol = "w-8 pr-0"
/** A row; the last one in its band draws no bottom border. */
const rowCls = "cursor-pointer [&:last-child>td]:border-b-0"
/** An empty picture in a comfortable lead column: the record's initials in a disc. */
const avatarCls = "inline-grid place-items-center w-12 h-12 rounded-full bg-bg-active text-fg-subtle font-semibold"
/** The duplicate-id mark. (was dt-dup-badge) */
const dupBadge =
  "inline-flex items-center gap-1 ml-1.5 px-2 h-5 rounded-full border border-[color-mix(in_srgb,var(--dt-color-charts-orange)_50%,transparent)] text-chart-orange text-small whitespace-nowrap"

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)

/** An id more than one root holds: the first-named root's copy is the one read — said on the row. */
function duplicateNote(record: Row): string {
  const roots = record[DUPLICATES_FIELD]
  if (!Array.isArray(roots) || roots.length < 2) return ""
  return `held by both ${roots.join(" and ")} — ${roots[0]}'s copy is the one read; dreamteamer check names the files`
}

const columnStyle = (field: FieldRow) =>
  typeof field.width === "number" && field.width > 0 ? { minWidth: `${field.width}ch` } : undefined

export function ListTable({ state }: ListProps) {
  const { schema, version } = useApp()
  useSignal(referenceTitlesChanged)
  const options = state.listOptions["table"] ?? {}
  const columns = state.columns
  const records = state.records

  // only ever the option, never inferred — and a named field this collection lacks means "not grouped", so a typo
  // in a view never erases the table
  const named = options["group_by"]
  const groupField = typeof named === "string" && named ? (state.fields.find(f => f.field === named) ?? null) : null
  const bands = useMemo<Bucket[]>(
    () =>
      groupField
        ? bucketize(groupField, records, {
            showUngrouped: options["show_ungrouped_rows"] === true,
            showEmpty: options["show_empty_rows"] === true,
          })
        : [{ value: "", label: "", records }],
    [groupField, records, options]
  )
  const byReference = groupField !== null && isRelationField(groupField)
  const bandValues = bands.map(b => b.value).filter(v => v && v !== UNGROUPED)
  useEffect(() => {
    if (byReference) askTitles(bandValues, schema, version)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the values themselves
  }, [byReference, bandValues.join("\n"), schema, version])
  const bandLabel = (b: Bucket) => (byReference && b.value !== UNGROUPED ? knownTitle(b.value) : null) || b.label

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleBand = (value: string) =>
    setCollapsed(c => {
      const next = new Set(c)
      if (!next.delete(value)) next.add(value)
      return next
    })

  const rowSize = resolveRowSize(options)
  // comfortable: an empty leading picture column draws the record's initials instead of a dash — only when that
  // column references a binary collection, by the host's list and never by a collection's name
  const lead = columns[0]
  const leadTarget = lead && isRelationField(lead) ? schema.target(lead)?.collection : undefined
  const leadIsPicture = !!leadTarget && fileBases().some(b => b.collection === leadTarget)
  const span = columns.length + 1

  return (
    <div className="flex-auto min-h-0 overflow-auto border border-border rounded-dt" data-table-scroll>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={cx(headCell(rowSize), checkCol)}>
              <input
                type="checkbox"
                checked={state.allVisibleSelected}
                aria-label="Select all"
                onChange={state.toggleSelectAllVisible}
              />
            </th>
            {columns.map(f => {
              const reason = computedReason(f, { create: false })
              const sorted = state.sortIndicator(f.field)
              return (
                <th
                  key={f.field}
                  className={cx(headCell(rowSize), "cursor-pointer", reason !== null && "opacity-65 italic")}
                  title={f.description || reason || undefined}
                  style={columnStyle(f)}
                  onClick={() => state.toggleSort(f.field)}
                >
                  {labelOf(f)}
                  {sorted && <Icon name={sorted === "asc" ? "arrow-up" : "arrow-down"} />}
                </th>
              )
            })}
          </tr>
        </thead>
        {records.length === 0 ? (
          <tbody>
            <tr className={cx(rowCls, "hover:bg-bg-hover")}>
              <td
                colSpan={span}
                className={cx(cellCore, cellCapped, "text-fg-subtle cursor-default text-center! p-6!")}
              >
                {state.loading ? (
                  "Loading…"
                ) : state.hasActiveQuery ? (
                  "No records match your search or filters."
                ) : (
                  <>
                    No records yet.{" "}
                    {!state.unavailable && (
                      <button type="button" className={linkButton} onClick={() => state.createRecord()}>
                        Create record
                      </button>
                    )}
                  </>
                )}
              </td>
            </tr>
          </tbody>
        ) : (
          bands.map(band => (
            <tbody key={band.value} className={state.loading ? "opacity-70" : undefined}>
              {groupField && (
                <tr className={rowCls}>
                  <td
                    colSpan={span}
                    className={cx(
                      cellCore,
                      padY(rowSize),
                      "max-w-none bg-bg-subtle sticky top-[31px] z-[1] cursor-default"
                    )}
                  >
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className={iconButton}
                        aria-expanded={!collapsed.has(band.value)}
                        title={collapsed.has(band.value) ? "Expand" : "Collapse"}
                        onClick={() => toggleBand(band.value)}
                      >
                        <Icon name={collapsed.has(band.value) ? "chevron-right" : "chevron-down"} />
                      </button>
                      <GroupHeader
                        label={bandLabel(band)}
                        count={band.records.length}
                        description={band.description}
                        icon={band.icon}
                        color={band.color}
                        background={band.background}
                      />
                    </div>
                  </td>
                </tr>
              )}
              {!collapsed.has(band.value) &&
                (band.records as Row[]).map(r => {
                  const tint = state.tintOf(r)
                  const dup = duplicateNote(r)
                  return (
                    <tr
                      key={`${String(r["$source"] ?? "")}/${r.id}`}
                      className={cx(
                        rowCls,
                        tint
                          ? "bg-[color-mix(in_srgb,var(--dt-tint-bg)_8%,transparent)]"
                          : state.isSelected(r.id)
                            ? "bg-bg-active"
                            : "hover:bg-bg-hover"
                      )}
                      style={tint}
                      data-vscode-context={rowContext(state.collection, r.id, state.selectedIds)}
                      onClick={() => state.openRecord(r)}
                    >
                      <td
                        className={cx(cellCore, cellCapped, padY(rowSize), checkCol)}
                        onClick={e => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={state.isSelected(r.id)}
                          aria-label="Select"
                          onChange={() => state.toggleSelect(r.id)}
                        />
                      </td>
                      {columns.map((f, i) => (
                        <td
                          key={f.field}
                          className={cx(
                            cellCore,
                            cellCapped,
                            padY(rowSize),
                            f.field === state.titleField &&
                              (rowSize === "comfortable" ? "font-semibold" : "font-medium"),
                            i === 0 && tint && "shadow-[inset_3px_0_0_var(--dt-tint)]",
                            i === 0 &&
                              rowSize === "comfortable" &&
                              "[&_[data-image]]:w-12 [&_[data-image]]:h-12 [&_[data-image]]:max-h-none [&_[data-image]]:object-cover"
                          )}
                        >
                          {rowSize === "comfortable" && i === 0 && leadIsPicture && isEmpty(r[f.field]) ? (
                            <span className={avatarCls} title={state.recordTitleOf(r)} aria-hidden="true">
                              {initialsOf(state.recordTitleOf(r))}
                            </span>
                          ) : (
                            <RenderView field={f} value={r[f.field]} record={r} />
                          )}
                          {i === 0 && dup && (
                            <span className={dupBadge} title={dup} role="img" aria-label="duplicate id">
                              <Icon name="warning" />
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  )
                })}
            </tbody>
          ))
        )}
      </table>
    </div>
  )
}
