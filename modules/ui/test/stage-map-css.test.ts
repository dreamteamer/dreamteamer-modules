// THE STAGE MAP'S LOOKS (cr-vscode-015), ported from the Vue ui's stage-map-css test: Node has no layout, so the
// rules that keep the map to two lines are read as the utilities record/stageMapLooks.ts gives each part — a
// non-wrapping row, capitalised titles, muted marks, the two width rules scoped to the chip, and a card that wraps.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  stageCardCls,
  stageCardTitleCls,
  stageChipCls,
  stageCls,
  stagesCls,
  stagesListCls,
  stagesNextCls,
  stageTitleCls,
} from "../src/record/stageMapLooks.ts"

const tokens = (cls: string | undefined) => new Set((cls ?? "").split(/\s+/).filter(Boolean))
const has = (cls: string | undefined, ...want: string[]) => {
  const t = tokens(cls)
  for (const w of want) assert.ok(t.has(w), `${w} in "${cls}"`)
}

test("line 1: the stages are one non-wrapping flex row with capitalised titles", () => {
  has(stagesListCls, "flex", "flex-nowrap", "whitespace-nowrap")
  has(stageTitleCls(false), "capitalize")
  has(stageTitleCls(true), "capitalize")
  has(stagesCls, "@container")
})

test("line 2: stages not reached and stages passed over are muted", () => {
  has(stageChipCls("ahead"), "text-fg-subtle")
  has(stageChipCls("skipped"), "text-fg-subtle")
  assert.ok(!tokens(stageChipCls("current")).has("text-fg-subtle"))
})

test("line 3: the subtitle is one line that ellipsises and keeps its height while loading", () => {
  has(stagesNextCls, "whitespace-nowrap", "text-ellipsis", "overflow-hidden", "min-h-[1.4em]")
})

test("line 4: the card is placed against the map, wraps its text, and heads with a capitalised title", () => {
  has(stagesCls, "relative")
  has(stageCardCls, "absolute", "top-full", "whitespace-normal")
  has(stageCardTitleCls, "capitalize", "font-semibold")
  for (const cls of [stageCls, stagesListCls])
    for (const t of tokens(cls))
      assert.ok(
        t !== "relative" && t !== "absolute",
        "neither the row nor an item is positioned, so the row never clips the card"
      )
})

test("line 5: two width rules shorten titles to the index, scoped to the chip, never reaching the card", () => {
  // the narrow width hides every title but the current stage's; the narrowest hides them all
  has(stageTitleCls(false), "@max-[560px]:hidden", "@max-[400px]:hidden")
  has(stageTitleCls(true), "@max-[400px]:hidden")
  assert.ok(!tokens(stageTitleCls(true)).has("@max-[560px]:hidden"), "the current stage keeps its title")
  for (const cls of [stageCardCls, stageCardTitleCls])
    for (const t of tokens(cls)) assert.ok(!t.startsWith("@"), "no width rule reaches into the card")
})
