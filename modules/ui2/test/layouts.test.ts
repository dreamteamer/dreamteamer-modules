// The step-8 layouts' pure halves: the calendar's month grid, the map's coordinates, the gantt's record-side
// decisions (spans, colours, labels, lanes), and the routes a page view answers. Synthetic Northwind data only.
import { test } from "node:test"
import assert from "node:assert/strict"
import { calendarWeeks, dayKey, addMonths, startOfMonth } from "../src/lib/calendar-grid.ts"
import { coordOf, fitKey } from "../src/lib/map-coords.ts"
import {
  bandRange,
  bandShapeOf,
  barColor,
  barLabel,
  barTitle,
  colorMapOf,
  PALETTE,
  spansOf,
} from "../src/lib/gantt-rows.ts"
import { iconOf } from "../src/lib/group-label.ts"
import { placeOf } from "../src/lib/pane-place.ts"
import { pageOf } from "../src/lib/route.ts"
import { enumRow, fieldRow } from "./field-rows.ts"

test("calendar: six Monday-first weeks around the month, today marked, the outside days flagged", () => {
  const weeks = calendarWeeks(new Date(2026, 10, 16), new Date(2026, 10, 16))
  assert.equal(weeks.length, 6)
  assert.ok(weeks.every(w => w.length === 7))
  // 1 Nov 2026 is a Sunday: the grid opens on Monday 26 Oct
  assert.equal(weeks[0]![0]!.key, "2026-10-26")
  assert.equal(weeks[0]![0]!.inMonth, false)
  assert.equal(weeks[0]![6]!.key, "2026-11-01")
  assert.equal(
    weeks
      .flat()
      .filter(c => c.isToday)
      .map(c => c.key)
      .join(),
    "2026-11-16"
  )
  assert.equal(weeks.flat().filter(c => c.inMonth).length, 30)
  assert.equal(dayKey(addMonths(startOfMonth(new Date(2026, 11, 31)), 1)), "2027-01-01")
})

test("map: the options' fields, then lat/lng-named numbers, then any {lat,lng} object; none → not plotted", () => {
  assert.deepEqual(coordOf({ lat: 51.5, lng: -0.12 }), [51.5, -0.12])
  assert.deepEqual(coordOf({ latitude: 1, longitude: 2 }), [1, 2])
  assert.deepEqual(coordOf({ y: 3, x: 4 }, { lat: "y", lng: "x" }), [3, 4])
  assert.deepEqual(coordOf({ office: { lat: 5, lng: 6 } }), [5, 6])
  assert.deepEqual(coordOf({ office: { lat: 5, lng: 6 } }, { lat: "office", lng: "office" }), [5, 6])
  assert.equal(coordOf({ lat: "51.5", lng: -0.12 }), null, "a string is not a coordinate")
  assert.equal(coordOf({ name: "Harbor Mutual" }), null)
  assert.equal(
    fitKey([
      [1, 2],
      [3, 4],
    ]),
    "1,2|3,4"
  )
})

const events = [
  { id: "kickoff", name: "Kickoff with Dana", starts: "2026-11-03", ends: "2026-11-04", kind: "meeting" },
  { id: "launch", name: "Northwind launch", starts: "2026-11-24", kind: "launch" },
  { id: "typo", name: "Typo", starts: "2026-11-20", ends: "2026-11-18", kind: "workshop" },
  { id: "idea", name: "Undated idea" },
]
const title = (r: Record<string, unknown>) => String(r["name"] ?? "")

test("gantt spans: no start is not placed, no end is a point, an end before its start is an inverted point", () => {
  const spans = spansOf(events, "starts", "ends", title)
  assert.deepEqual(
    spans.map(s => [s.record.id, s.end - s.start, s.inverted]),
    [
      ["kickoff", 1, false],
      ["launch", 0, false],
      ["typo", 0, true],
    ]
  )
  assert.match(barTitle(spans[2]!), /2026-11-18 is before 2026-11-20, so it is drawn as a point/)
  assert.equal(barTitle(spans[0]!), "Kickoff with Dana — 2026-11-03 → 2026-11-04")
  assert.equal(spansOf(events, "starts", null, title)[0]!.endKey, null, "no end field: never an invented end")
})

test("gantt colours: a declared colour wins, the rest take free palette slots, past the palette they go neutral", () => {
  const kind = enumRow("kind", [{ label: "meeting", value: "meeting", color: "charts.blue" }, "launch"])
  const { map, uncoloured } = colorMapOf(kind, events)
  assert.equal(map.get("meeting"), "charts.blue")
  assert.equal(map.get("launch"), "charts.green", "the first slot the declared colour did not claim")
  assert.equal(uncoloured, 0)
  assert.equal(barColor(events[0]!, kind, map), "charts.blue")
  assert.equal(barColor(events[3]!, kind, map), null)
  const many = Array.from({ length: PALETTE.length + 2 }, (_, i) => ({ id: `e${i}`, tag: `v${i}` }))
  const wide = colorMapOf(fieldRow("tag"), many)
  assert.equal(wide.map.size, PALETTE.length)
  assert.equal(wide.uncoloured, 2, "never a repeat: the overflow is counted, and neutral")
})

test("gantt labels: the template as one plain line, else the named field, else the title; an empty render is a miss", () => {
  const [span] = spansOf(events, "starts", "ends", title)
  assert.equal(barLabel(span!, "{{ name }}\n— {{ kind }}", null), "Kickoff with Dana — meeting")
  assert.equal(barLabel(span!, "{{ summary }}", "kind"), "meeting")
  assert.equal(barLabel(span!, null, null), "Kickoff with Dana")
  assert.equal(barLabel(span!, null, "summary"), "")
})

test("gantt lanes: one segment per run, the active days counted, never the envelope", () => {
  const spans = spansOf(
    [
      { id: "a", starts: "2026-03-09", ends: "2026-03-10" },
      { id: "b", starts: "2026-03-11", ends: "2026-03-12" },
      { id: "c", starts: "2026-05-01" },
    ],
    "starts",
    "ends",
    title
  )
  const shape = bandShapeOf(spans)!
  assert.equal(shape.runs.length, 2)
  assert.equal(shape.activeDays, 5)
  assert.match(bandRange(shape), /2 runs · 5 days active$/)
  assert.equal(bandShapeOf([]), null)
})

test("a band's picture: the named field, else avatar, icon, image — in that order", () => {
  assert.equal(iconOf({ avatar: "files/dana.png", icon: "person" }, null), "files/dana.png")
  assert.equal(iconOf({ icon: "person" }, null), "person")
  assert.equal(iconOf({ logo: "files/northwind.png", icon: "x" }, "logo"), "files/northwind.png")
  assert.equal(iconOf({ logo: "" }, "logo"), null)
})

const views = [
  { id: "desk", route: "/desk", scope: "page", display: { list: { layout: "page" } } },
  { id: "feed", route: "/feed", scope: "page", compiled: { display: { list: { layout: "activity" } } } },
  { id: "app", route: "/app", scope: "page", display: { list: { layout: "northwind-planner" } } },
]

test("a page view's route is its page — scoped by ?source=; a module app's page is still not drawn here", () => {
  assert.deepEqual(pageOf("/desk", [], views), { kind: "page-view", id: "desk" })
  assert.deepEqual(pageOf("/desk?source=northwind-archive", [], views), {
    kind: "page-view",
    id: "desk",
    source: "northwind-archive",
  })
  assert.deepEqual(pageOf("/feed/", [], views), { kind: "page-view", id: "feed" })
  assert.deepEqual(pageOf("/app", [], views), { kind: "unsupported", route: "/app" })
  assert.deepEqual(placeOf(pageOf("/desk", [], views)), { uiView: "desk" })
})
