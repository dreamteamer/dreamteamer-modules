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
    <div className="dt-table-scroll">
      <table className={`dt-table dt-density-${rowSize}`}>
        <thead>
          <tr>
            <th className="dt-check-col">
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
                  className={`is-sortable${reason !== null ? " is-computed" : ""}`}
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
            <tr className="dt-empty-row">
              <td colSpan={span}>
                {state.loading ? (
                  "Loading…"
                ) : state.hasActiveQuery ? (
                  "No records match your search or filters."
                ) : (
                  <>
                    No records yet.{" "}
                    {!state.unavailable && (
                      <button type="button" className="dt-link-button" onClick={() => state.createRecord()}>
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
            <tbody key={band.value} className={state.loading ? "is-revalidating" : undefined}>
              {groupField && (
                <tr className="dt-group-row">
                  <td colSpan={span}>
                    <div className="dt-group-band">
                      <button
                        type="button"
                        className="dt-icon-button"
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
                      className={`${state.isSelected(r.id) ? "is-selected" : ""}${tint ? " is-tinted" : ""}`}
                      style={tint}
                      data-vscode-context={rowContext(state.collection, r.id, state.selectedIds)}
                      onClick={() => state.openRecord(r)}
                    >
                      <td className="dt-check-col" onClick={e => e.stopPropagation()}>
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
                          className={`${i === 0 ? "is-lead" : ""}${f.field === state.titleField ? " dt-cell-title" : ""}`}
                        >
                          {rowSize === "comfortable" && i === 0 && leadIsPicture && isEmpty(r[f.field]) ? (
                            <span className="dt-avatar-fallback" title={state.recordTitleOf(r)} aria-hidden="true">
                              {initialsOf(state.recordTitleOf(r))}
                            </span>
                          ) : (
                            <RenderView field={f} value={r[f.field]} record={r} />
                          )}
                          {i === 0 && dup && (
                            <span className="dt-dup-badge" title={dup} role="img" aria-label="duplicate id">
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
