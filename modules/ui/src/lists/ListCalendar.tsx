/**
 * THE MONTH CALENDAR — the built-in `calendar` List (ported from the Vue ui's ListCalendar.vue): a Monday-first
 * month grid over the same rows the table draws, a record a chip on the day its date field names. The field is the
 * `start` option, else the first `date` field, else the first `datetime` (every collection has `last_modified`, so
 * the layout always has something to plot). A day shows four chips and says how many more.
 *
 * The month is the grid's own state — moving it never touches the browse's query, so the rows are the browse's
 * page and a record outside it is not on the grid. Pure month maths is lib/calendarGrid.ts.
 */
import { useMemo, useState } from "react"
import type { Row } from "../api/client.ts"
import { addMonths, calendarWeeks, startOfMonth, WEEKDAYS } from "../lib/calendarGrid.ts"
import { rowContext } from "../lib/vscodeContext.ts"
import type { ListProps } from "../registry/props.ts"
import { ListEmpty } from "./ListEmpty.tsx"
import { button, buttonSize, buttonTone, cx, listEmpty, subtle } from "../styles/classes.ts"
import { calChip } from "./looks.ts"

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
    return <p className={listEmpty}>No date field to place records on — set one in Layout options (Start).</p>

  const weeks = calendarWeeks(cursor, new Date())
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={cx(button, buttonTone.default, buttonSize.default)}
          title="Previous month"
          onClick={() => setCursor(addMonths(cursor, -1))}
        >
          ‹
        </button>
        <button
          type="button"
          className={cx(button, buttonTone.default, buttonSize.default)}
          onClick={() => setCursor(startOfMonth(new Date()))}
        >
          Today
        </button>
        <button
          type="button"
          className={cx(button, buttonTone.default, buttonSize.default)}
          title="Next month"
          onClick={() => setCursor(addMonths(cursor, 1))}
        >
          ›
        </button>
        <span className="font-semibold ml-1.5">
          {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <span className={subtle}>on {dateField}</span>
      </div>
      <div
        className={cx(
          "grid grid-cols-[repeat(7,minmax(0,1fr))] gap-px bg-border border border-border rounded-dt overflow-hidden",
          state.loading && "opacity-70"
        )}
      >
        {WEEKDAYS.map(d => (
          <div
            key={d}
            className="bg-bg-subtle py-1.5 px-2 text-small font-bold uppercase tracking-[0.04em] text-fg-subtle"
          >
            {d}
          </div>
        ))}
        {weeks.flat().map(cell => {
          const records = byDay.get(cell.key) ?? []
          return (
            <div
              key={cell.key}
              className={cx("min-h-24 p-1.5 min-w-0", cell.inMonth ? "bg-bg" : "bg-bg-subtle opacity-60")}
              data-day={cell.key}
            >
              <div
                className={cx(
                  "inline-flex items-center justify-center w-[22px] h-[22px] rounded-full mb-1",
                  cell.isToday && "bg-accent text-accent-fg"
                )}
              >
                {cell.day}
              </div>
              {records.slice(0, SHOWN).map(r => {
                const title = state.recordTitleOf(r) || r.id
                return (
                  <button
                    type="button"
                    key={`${String(r["$source"] ?? "")}/${r.id}`}
                    className={calChip(!!state.tintOf(r))}
                    style={state.tintOf(r)}
                    title={title}
                    data-vscode-context={rowContext(state.collection, r.id)}
                    onClick={() => state.openRecord(r)}
                  >
                    {title}
                  </button>
                )
              })}
              {records.length > SHOWN && (
                <div className="text-small text-fg-subtle">+{records.length - SHOWN} more</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
