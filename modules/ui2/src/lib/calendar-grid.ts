/**
 * The calendar layout's month maths (ported out of @dreamteamer/ui's ListCalendar.vue so it can be pinned): a
 * Monday-first grid of six weeks around a month, each cell keyed by its LOCAL day (`YYYY-MM-DD`) — the same key
 * a record's date field is cut to, so a chip lands on the day its value names whatever the browser's zone.
 */

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const

export interface CalendarCell {
  key: string
  day: number
  inMonth: boolean
  isToday: boolean
}

export const startOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1)
export const addMonths = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth() + n, 1)

/** A local date's day key. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Six Monday-first weeks covering `month` (any date in it), `today` marked. Always 42 cells, so the grid never
 *  changes height between months. */
export function calendarWeeks(month: Date, today: Date): CalendarCell[][] {
  const first = startOfMonth(month)
  const offset = (first.getDay() + 6) % 7
  const todayKey = dayKey(today)
  const weeks: CalendarCell[][] = []
  for (let w = 0; w < 6; w++) {
    const row: CalendarCell[] = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(first.getFullYear(), first.getMonth(), 1 - offset + w * 7 + d)
      const key = dayKey(date)
      row.push({ key, day: date.getDate(), inMonth: date.getMonth() === first.getMonth(), isToday: key === todayKey })
    }
    weeks.push(row)
  }
  return weeks
}
