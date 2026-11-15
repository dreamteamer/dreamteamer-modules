/**
 * THE MONTH CALENDAR — the built-in `calendar` List (ported from @dreamteamer/ui's ListCalendar.vue): a Monday-first
 * month grid over the same rows the table draws, a record a chip on the day its date field names. The field is the
 * `start` option, else the first `date` field, else the first `datetime` (every collection has `last_modified`, so
 * the layout always has something to plot). A day shows four chips and says how many more.
 *
 * The month is the grid's own state — moving it never touches the browse's query, so the rows are the browse's
 * page and a record outside it is not on the grid. Pure month maths is lib/calendar-grid.ts.
 */
import { useMemo, useState } from "react"
import type { Row } from "../api/client.ts"
import { addMonths, calendarWeeks, startOfMonth, WEEKDAYS } from "../lib/calendar-grid.ts"
import { rowContext } from "../lib/vscode-context.ts"
import type { ListProps } from "../registry/props.ts"
import { ListEmpty } from "./ListEmpty.tsx"

const SHOWN = 4

export function ListCalendar({ state }: ListProps) {
  const options = state.listOptions["calendar"] ?? {}
  const named = options["start"]
  const dateField =
    typeof named === "string" && named
      ? named
      : (state.fields.find(f => f.type === "date")?.field ?? state.fields.find(f => f.type === "datetime")?.field)
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()))

  const byDay = useMemo(() => {
    const out = new Map<string, Row[]>()
    if (!dateField) return out
    for (const r of state.records) {
      const raw = r[dateField]
      if (typeof raw !== "string" || raw.length < 10) continue
      const key = raw.slice(0, 10)
      const list = out.get(key)
      if (list) list.push(r)
      else out.set(key, [r])
    }
    return out
  }, [state.records, dateField])

  if (!state.records.length) return <ListEmpty state={state} />
  if (!dateField)
    return <p className="ui2-list-empty">No date field to place records on — set one in Layout options (Start).</p>

  const weeks = calendarWeeks(cursor, new Date())
  return (
    <div className="ui2-cal">
      <div className="ui2-cal-bar">
        <button
          type="button"
          className="ui2-button"
          title="Previous month"
          onClick={() => setCursor(addMonths(cursor, -1))}
        >
          ‹
        </button>
        <button type="button" className="ui2-button" onClick={() => setCursor(startOfMonth(new Date()))}>
          Today
        </button>
        <button type="button" className="ui2-button" title="Next month" onClick={() => setCursor(addMonths(cursor, 1))}>
          ›
        </button>
        <span className="ui2-cal-month">
          {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <span className="ui2-subtle">on {dateField}</span>
      </div>
      <div className={`ui2-cal-grid${state.loading ? " is-revalidating" : ""}`}>
        {WEEKDAYS.map(d => (
          <div key={d} className="ui2-cal-weekday">
            {d}
          </div>
        ))}
        {weeks.flat().map(cell => {
          const records = byDay.get(cell.key) ?? []
          return (
            <div
              key={cell.key}
              className={`ui2-cal-cell${cell.inMonth ? "" : " is-out"}${cell.isToday ? " is-today" : ""}`}
              data-day={cell.key}
            >
              <div className="ui2-cal-day">{cell.day}</div>
              {records.slice(0, SHOWN).map(r => {
                const title = state.recordTitleOf(r) || r.id
                return (
                  <button
                    type="button"
                    key={`${String(r["$source"] ?? "")}/${r.id}`}
                    className={`ui2-cal-chip${state.tintOf(r) ? " is-tinted" : ""}`}
                    style={state.tintOf(r)}
                    title={title}
                    data-vscode-context={rowContext(state.collection, r.id)}
                    onClick={() => state.openRecord(r)}
                  >
                    {title}
                  </button>
                )
              })}
              {records.length > SHOWN && <div className="ui2-cal-more">+{records.length - SHOWN} more</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
