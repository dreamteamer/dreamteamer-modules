/**
 * THE BOARD — the built-in `kanban` List (ported from @dreamteamer/ui's ListKanban.vue): columns by a field, a
 * card per record, a drag between columns writes that field. A thin renderer over the browse's state; every
 * decision a drag obeys is pure, in `lib/kanban-board.ts` and `lib/kanban-lock.ts`.
 *
 * COLUMNS COME FROM THE SCHEMA, IN SCHEMA ORDER: an `enum:` compiles to `editor_options.choices` in declared
 * order, so `todo, doing, done` reads left to right as authored and no second ordering is stored to drift from
 * it. A value present in the data but not the enum gets its own column after the declared ones, so an off-enum
 * record never vanishes. Empty columns show by default (a column is a drop target: an empty "Blocked" is where you
 * drag the thing just blocked); the ungrouped column is off by default, and the records it would hold are
 * counted under the board rather than silently dropped. `group_by` adds horizontal LANES, each with its own copy
 * of the columns — presentation only: a drag still writes the column field alone.
 *
 * Moves: onto a column, the column field (`updateRecord`, one engine commit); into a gap between cards while the
 * list is sorted by the collection's `position_field`, the column field when it changed and then the position
 * (`moveRecord`, the protocol's position route — the engine computes the key). A rejected write is the engine's
 * validation speaking, so it is shown above the board. A LOCKED column field (the edit form would draw no control
 * for it) moves nothing between columns; the card says why on hover, and the column `+` follows the create form's
 * rule. Native HTML5 drag and drop: the drag's own state is set a tick after `dragstart`, because changing the DOM
 * inside `dragstart` (the gaps appear) makes Chrome cancel the drag.
 *
 * Full height (`fillsHeight`): the board fills the browse's box, each column stretches to it, and a column's card
 * list is the only scroll box — the header stays pinned above it.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react"
import { moveRecord, updateRecord, type Row } from "../api/client.ts"
import { useApp, useSignal } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { SourceMark } from "../components/SourceMark.tsx"
import { themeColor } from "../lib/collection-display.ts"
import { hasControl, isRelationField } from "../lib/field-row.ts"
import { bucketize, buildLanes, ungroupedAllowed, UNGROUPED, valueOf, type Bucket } from "../lib/grouping.ts"
import { templateOption } from "../lib/display-template.ts"
import { addPrefill, columnFieldOf, laneFieldOf, planDrop, type Gap } from "../lib/kanban-board.ts"
import { kanbanLock } from "../lib/kanban-lock.ts"
import { askTitles, knownTitle, referenceTitlesChanged } from "../lib/record-cache.ts"
import type { ListProps } from "../registry/props.ts"
import { DisplayTemplate } from "../render/DisplayTemplate.tsx"

const ALL = "__all__"
const END = "__end__"

interface Lane {
  value: string
  label: string
  ungrouped?: boolean
  columns: Bucket[]
}

const keyOf = (lane: Lane, column: Bucket) => `${lane.value}:${column.value}`
const rowKey = (r: Row) => `${String(r["$source"] ?? "")}/${r.id}`
const count = (lane: Lane) => lane.columns.reduce((n, c) => n + c.records.length, 0)

export function ListKanban({ state }: ListProps) {
  const { schema, version } = useApp()
  useSignal(referenceTitlesChanged)
  const options = state.listOptions["kanban"] ?? {}
  const records = state.records

  const columnField = columnFieldOf(state.fields, options)
  const laneField = laneFieldOf(state.fields, options)
  const showUngrouped = ungroupedAllowed(columnField) && options["show_ungrouped_columns"] === true
  const showUngroupedLane = ungroupedAllowed(laneField) && options["show_ungrouped_rows"] === true
  // opposite defaults: a column is a drop target, a band is not (an empty band is only distance)
  const showEmptyColumns = options["show_empty_columns"] !== false
  const showEmptyLanes = options["show_empty_rows"] === true

  const lanes = useMemo<Lane[]>(() => {
    if (!columnField) return []
    const columnsOf = (rows: Record<string, unknown>[]) =>
      bucketize(columnField, rows, { showUngrouped, showEmpty: showEmptyColumns })
    const banded = buildLanes(laneField, records, { showUngrouped: showUngroupedLane, showEmpty: showEmptyLanes })
    if (!banded) return [{ value: ALL, label: "", columns: columnsOf(records) }]
    return banded.map(l => ({
      value: l.value,
      label: l.label,
      ...(l.ungrouped ? { ungrouped: true } : {}),
      columns: columnsOf(l.records),
    }))
  }, [columnField, laneField, records, showUngrouped, showUngroupedLane, showEmptyColumns, showEmptyLanes])

  // a reference axis is labelled with the referenced records' titles, as the table's bands are
  const titled = (field: typeof columnField, values: string[]) => (field && isRelationField(field) ? values : [])
  const wanted = [
    ...titled(
      columnField,
      lanes.flatMap(l => l.columns.map(c => c.value))
    ),
    ...titled(
      laneField,
      lanes.map(l => l.value)
    ),
  ].filter(v => v && v !== UNGROUPED && v !== ALL)
  useEffect(() => {
    if (wanted.length) askTitles([...new Set(wanted)], schema, version)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the values themselves
  }, [wanted.join("\n"), schema, version])
  const labelOf = (field: typeof columnField, b: { value: string; label: string; ungrouped?: boolean }) =>
    (field && isRelationField(field) && !b.ungrouped ? knownTitle(b.value) : null) || b.label

  const hidden = columnField && !showUngrouped ? records.filter(r => valueOf(r, columnField) === "").length : 0
  const laneHidden = laneField && !showUngroupedLane ? records.filter(r => valueOf(r, laneField) === "").length : 0

  const template = templateOption(options)
  const reorder = state.manualOrder
  const lock = kanbanLock(columnField, { reorder })
  const cardDraggable = !lock.columns || reorder
  const lanePrefill = laneField !== null && hasControl(laneField, { create: true })

  // ---- drag and drop ------------------------------------------------------------------------------------------
  const [drag, setDrag] = useState<{ id: string; from: string } | null>(null)
  const dragNow = useRef<{ id: string; from: string } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [dropSlot, setDropSlot] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)

  function onDragStart(event: DragEvent, record: Row, lane: Lane, column: Bucket): void {
    const d = { id: record.id, from: keyOf(lane, column) }
    dragNow.current = d
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", record.id)
    setMoveError(null)
    setTimeout(() => setDrag(d), 0)
  }
  function endDrag(): void {
    dragNow.current = null
    setDrag(null)
    setDropTarget(null)
    setDropSlot(null)
  }

  const gapsLive = (lane: Lane, column: Bucket) =>
    reorder && drag !== null && (!lock.columns || keyOf(lane, column) === drag.from)

  async function drop(lane: Lane, column: Bucket, gap?: Gap): Promise<void> {
    const d = dragNow.current
    endDrag()
    if (!d || !columnField || saving) return
    const current = records.find(r => r.id === d.id)
    const plan = planDrop({
      id: d.id,
      current: current ? valueOf(current, columnField) : "",
      field: columnField.field,
      target: { value: column.value, ...(column.ungrouped ? { ungrouped: true } : {}) },
      locked: lock.columns,
      ungroupedAllowed: ungroupedAllowed(columnField),
      ...(gap ? { gap, reorder, sameColumn: keyOf(lane, column) === d.from } : {}),
    })
    if (!plan) return
    setSaving(true)
    try {
      if (plan.fields) await updateRecord(state.collection, d.id, plan.fields)
      if (plan.position) await moveRecord(state.collection, d.id, plan.position)
      state.reload()
    } catch (error) {
      // the engine validates on write: a rejected move (a required field, a value the enum refuses) is real news
      setMoveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  function addTo(lane: Lane, column: Bucket): void {
    if (!columnField || column.ungrouped || !lock.add) return
    state.createRecord(
      addPrefill(
        { field: columnField.field, value: column.value },
        laneField && lane.value !== ALL
          ? {
              field: laneField.field,
              value: lane.value,
              prefill: lanePrefill,
              ...(lane.ungrouped ? { ungrouped: true } : {}),
            }
          : null
      )
    )
  }
  const addTitle = (lane: Lane, column: Bucket) =>
    `New record with ${columnField?.field} = ${column.value}${
      laneField && lanePrefill && !lane.ungrouped && lane.value !== ALL ? ` and ${laneField.field} = ${lane.value}` : ""
    }`

  if (!columnField)
    return (
      <div className="ui2-list-empty">
        <Icon name="split-horizontal" />
        <p>No field to group by — pick one in Layout options (Group columns by field).</p>
      </div>
    )

  const laned = laneField !== null
  const empty = !lanes.length || lanes.every(l => !l.columns.length)

  return (
    <div className="ui2-kanban-wrap">
      {moveError && <p className="ui2-error ui2-kanban-error">{moveError}</p>}
      {empty ? (
        <div className="ui2-list-empty">
          <Icon name="inbox" />
          <p>{state.loading ? "Loading…" : `No ${columnField.field} values to build columns from yet`}</p>
        </div>
      ) : (
        <div className={`ui2-kanban-lanes${saving ? " is-saving" : ""}${laned ? " is-laned" : ""}`}>
          {lanes.map(lane => (
            <section key={lane.value} className={`ui2-kanban-lane${lane.ungrouped ? " is-ungrouped" : ""}`}>
              {laned && (
                <header className="ui2-kanban-lane-head">
                  <span className="ui2-kanban-label">{labelOf(laneField, lane)}</span>
                  <span className="ui2-kanban-count" title={`${count(lane)} record(s) in this lane`}>
                    {count(lane)}
                  </span>
                </header>
              )}
              <div className="ui2-kanban">
                {lane.columns.map(column => {
                  const key = keyOf(lane, column)
                  const live = gapsLive(lane, column)
                  return (
                    <div
                      key={column.value}
                      className={`ui2-kanban-col${dropTarget === key ? " is-drop" : ""}${column.ungrouped ? " is-ungrouped" : ""}`}
                      onDragOver={e => {
                        if (lock.columns) return
                        e.preventDefault()
                        if (dropTarget !== key) setDropTarget(key)
                      }}
                      onDragLeave={e => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node | null) && dropTarget === key)
                          setDropTarget(null)
                      }}
                      onDrop={e => {
                        e.preventDefault()
                        void drop(lane, column)
                      }}
                    >
                      <div className="ui2-kanban-head">
                        {column.color && (
                          <span className="ui2-kanban-dot" style={{ background: themeColor(column.color) }} />
                        )}
                        <span className="ui2-kanban-label" title={column.description}>
                          {labelOf(columnField, column)}
                        </span>
                        <span className="ui2-kanban-count">{column.records.length}</span>
                        {!column.ungrouped && lock.add && !state.unavailable && (
                          <button
                            type="button"
                            className="ui2-icon-button ui2-kanban-add"
                            title={addTitle(lane, column)}
                            onClick={() => addTo(lane, column)}
                          >
                            <Icon name="add" />
                          </button>
                        )}
                      </div>
                      <div className="ui2-kanban-cards">
                        {(column.records as Row[]).map(r => {
                          const tint = state.tintOf(r)
                          const source = state.sourceOf(r)
                          return (
                            <div key={rowKey(r)} className="ui2-kanban-item">
                              {live && (
                                <div
                                  className={`ui2-kanban-slot${dropSlot === r.id ? " is-over" : ""}`}
                                  onDragOver={e => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    if (dropSlot !== r.id) setDropSlot(r.id)
                                  }}
                                  onDragLeave={() => dropSlot === r.id && setDropSlot(null)}
                                  onDrop={e => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    void drop(lane, column, { above: r.id })
                                  }}
                                />
                              )}
                              <div
                                className={`ui2-record-card ui2-kanban-card${tint ? " is-tinted" : ""}${
                                  drag?.id === r.id ? " is-dragging" : ""
                                }`}
                                style={tint}
                                title={lock.reason ?? undefined}
                                draggable={cardDraggable}
                                onDragStart={e => onDragStart(e, r, lane, column)}
                                onDragEnd={endDrag}
                                onClick={() => state.openRecord(r)}
                              >
                                {template ? (
                                  <DisplayTemplate
                                    template={template}
                                    record={r}
                                    fields={state.fields}
                                    context="record"
                                  />
                                ) : (
                                  <>
                                    <div className="ui2-kanban-title">{state.recordTitleOf(r)}</div>
                                    <div className="ui2-kanban-id">{r.id}</div>
                                  </>
                                )}
                                {source && (
                                  <footer className="ui2-record-card-foot">
                                    <SourceMark {...source} />
                                  </footer>
                                )}
                              </div>
                            </div>
                          )
                        })}
                        {live && (
                          <div
                            className={`ui2-kanban-slot is-end${dropSlot === END ? " is-over" : ""}`}
                            onDragOver={e => {
                              e.preventDefault()
                              e.stopPropagation()
                              if (dropSlot !== END) setDropSlot(END)
                            }}
                            onDragLeave={() => dropSlot === END && setDropSlot(null)}
                            onDrop={e => {
                              e.preventDefault()
                              e.stopPropagation()
                              void drop(lane, column, { above: null })
                            }}
                          />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      {hidden > 0 && (
        <p className="ui2-kanban-hint">
          {hidden} record{hidden === 1 ? "" : "s"} with no {columnField.field} hidden — turn on “Show ungrouped column”
          in Layout options to see {hidden === 1 ? "it" : "them"}.
        </p>
      )}
      {laneField && laneHidden > 0 && (
        <p className="ui2-kanban-hint">
          {laneHidden} record{laneHidden === 1 ? "" : "s"} with no {laneField.field} lane hidden — turn on “Show
          ungrouped band” in Layout options to see {laneHidden === 1 ? "it" : "them"}.
        </p>
      )}
    </div>
  )
}
