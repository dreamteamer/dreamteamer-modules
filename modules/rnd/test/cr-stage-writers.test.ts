// THE STAGE WRITERS — the lifecycle keeps a change request's `stage` current as it moves the request: each
// stage's skill and the review whose approve moves it spell the write, `stage=` LAST on the line (so the
// 0.7.0 tag pins stay whole and leaving it out is dropping the last token). A step that sends a request
// back writes the stage of the earliest gate `dt next --json` names.
import { test, describe } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"

const RND = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const skill = s => fs.readFileSync(path.join(RND, "skills", s, "SKILL.md"), "utf8")
const agent = a => fs.readFileSync(path.join(RND, "agents", `${a}.agent.md`), "utf8")
const lit = s => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))

describe("each writer spells its stage write, stage last", () => {
  const ROWS = [
    ["rnd-change-request", "--stage design"],
    ["rnd-design", "dt set rnd/change-requests/<id> tags=<each existing> tags=designed stage=design-review"],
    ["recording-reviews", "dt set rnd/change-requests/<id> stage=acceptance"],
    ["recording-reviews", "`stage=plan` (already `accepted`)"],
    [
      "recording-reviews",
      "dt set rnd/change-requests/<id> status=accepted accepted_by=<you> accepted_on=<now> stage=plan",
    ],
    ["recording-reviews", "status=rejected stage=rejected"],
    ["recording-reviews", "a plan approved → `dt set rnd/change-requests/<id> stage=implement`"],
    ["recording-reviews", "a code review approved → `dt set rnd/change-requests/<id> stage=test`"],
    ["recording-reviews", "dt set rnd/change-requests/<id> verified_on=<now> stage=deploy"],
    ["recording-reviews", "`stage=live-check` when `deployed_on` is already set"],
    ["recording-reviews", "dt set rnd/change-requests/<id> status=implemented stage=done"],
    ["rnd-plan", "dt set rnd/change-requests/<id> stage=plan-review"],
    ["rnd-implement", "dt set rnd/change-requests/<id> tags=<each existing> tags=implemented stage=code-review"],
    ["rnd-test", "dt set rnd/change-requests/<id> tested_on=<now> tags=<each existing> tags=tested stage=test-review"],
    ["rnd-test", "with `stage=test` last on the same write"],
    [
      "rnd-deploy",
      "dt set rnd/change-requests/<id> deployed_on=<now> tags=<each existing> tags=deployed stage=live-check",
    ],
    [
      "rnd-release",
      "dt set rnd/change-requests/<cr> deployed_on=<published_on> tags=<each existing> tags=deployed stage=live-check",
    ],
    ["rnd-release", "release=<the next planned release, or empty> stage=deploy"],
  ]
  for (const [s, line] of ROWS) test(`${s}: ${line}`, () => assert.match(skill(s), lit(line)))

  test("a two-write step commits the other record and the request together, by id", () => {
    for (const s of ["recording-reviews", "rnd-plan", "rnd-implement"])
      assert.match(
        skill(s),
        /commit(ted)? (both|with the (plan|doc|design doc)) (together )?by id|committed together by id/i,
        s
      )
  })
})

describe("the stage writers, and the send-back", () => {
  for (const a of ["rnd-agent", "qa-manager"])
    test(`${a} names stage among what it writes`, () => assert.match(agent(a), /`stage`/))
  test("the rnd-agent writes stage only through a stage", () => {
    assert.match(agent("rnd-agent"), /never outside a stage/)
  })

  test("rnd-change-request files into the workspace and leaves later stages to the lifecycle", () => {
    assert.match(
      skill("rnd-change-request"),
      /every later stage moves `stage` as it moves the request; never set it by hand/
    )
  })

  test("the send-back reads dt next --json and maps every binding; recording-reviews carries the whole table", () => {
    for (const s of ["recording-reviews", "rnd-implement", "rnd-test"]) {
      assert.match(skill(s), lit("dt next rnd/change-requests/<id> --json"), s)
      assert.match(skill(s), /earliest/, s)
    }
    const t = skill("recording-reviews")
    const map = [
      ["rnd--design--change-requests", "design"],
      ["rnd--review--change-requests--design", "design-review"],
      ["rnd--review--change-requests", "acceptance"],
      ["rnd--plan--change-requests", "plan"],
      ["rnd--review--change-requests--plan", "plan-review"],
      ["rnd--implement--change-requests", "implement"],
      ["rnd--review--change-requests--code", "code-review"],
      ["rnd--test--change-requests", "test"],
      ["rnd--review--change-requests--test", "test-review"],
      ["rnd--deploy--change-requests", "deploy"],
      ["rnd--release--change-requests", "deploy"],
      ["rnd--review--change-requests--deploy", "live-check"],
    ]
    for (const [b, s] of map) assert.match(t, lit(`| \`${b}\` | \`${s}\` |`), b)
  })
})
