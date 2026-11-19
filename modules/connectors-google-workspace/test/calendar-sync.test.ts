// CONNECTORS-GOOGLE-WORKSPACE BRINGS THE CALENDAR SYNC BACK, UNCHANGED (cr-modules-018). Installing the
// package (with meetings, which it depends on) restores what meetings 0.3.1 carried: `/fetch-meetings` and
// its binding on the meetings collection, the `fetching-meetings` skill, `WORK_CALENDARS` and the
// `meetings` setup unit — now labelled under this package beside its own `google-workspace` unit. Measured
// on the real engine through `dt install --from` a folder of tarballs, offline, with a HOME of its own.
import { test, describe, before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { virginWorkspace, packedInto, closure, run, cleanup } from "../../../tests/helpers/workspace.ts"

const made = []
after(() => {
  cleanup()
  for (const d of made) fs.rmSync(d, { recursive: true, force: true })
})
const tmp = p => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)))
  made.push(d)
  return d
}
const ROW = "team@northwind.example | northwind | dana@northwind.example"

describe("connectors-google-workspace, installed with its closure", () => {
  let root, env
  before(() => {
    root = virginWorkspace()
    // .env out of Git, the way a person keeps it: the engine refuses to write a .env git would commit
    fs.appendFileSync(path.join(root, ".gitignore"), ".env\n")
    env = { HOME: tmp("dtm-HOME-") }
    const from = packedInto(tmp("dtm-from-"), ...closure("connectors-google-workspace"))
    const r = run(root, ["install", "@dreamteamer/connectors-google-workspace", "--from", from, "--no-input"], env)
    assert.ok(r.status === 0 || r.status === 3, `install exit ${r.status}\n${r.stderr}\n${r.stdout.slice(-800)}`)
  })

  test("compiles /fetch-meetings and the fetching-meetings skill, gcal.mjs included", () => {
    assert.ok(
      fs.existsSync(path.join(root, ".dreamteamer", "commands", "fetch-meetings.command.md")),
      "/fetch-meetings is not compiled"
    )
    assert.ok(
      fs.existsSync(path.join(root, ".dreamteamer", "skills", "fetching-meetings", "SKILL.md")),
      "the fetching-meetings skill is not compiled"
    )
    assert.ok(
      fs.existsSync(path.join(root, ".dreamteamer", "skills", "fetching-meetings", "bin", "gcal.mjs")),
      "the skill arrives without gcal.mjs"
    )
  })

  test("dt next meetings names fetch-meetings", () => {
    const n = run(root, ["next", "meetings"], env)
    assert.equal(n.status, 0, n.stderr)
    assert.match(n.stdout, /fetch-meetings/)
  })

  test("dt status shows connectors-google-workspace › meetings and › google-workspace", () => {
    const s = run(root, ["status"], env)
    assert.equal(s.status, 0, s.stderr)
    assert.match(s.stdout, /connectors-google-workspace › meetings\s/, s.stdout)
    assert.match(s.stdout, /connectors-google-workspace › google-workspace\s/, s.stdout)
    const units = JSON.parse(run(root, ["status", "--json"], env).stdout)
      .setup.filter(l => l.package === "@dreamteamer/connectors-google-workspace")
      .map(l => l.unit)
      .sort()
    assert.deepEqual(units, ["google-workspace", "meetings"])
  })

  test(".env.example names WORK_CALENDARS under connectors-google-workspace", () => {
    const example = path.join(root, ".env.example")
    assert.ok(fs.existsSync(example), "no .env.example written")
    const text = fs.readFileSync(example, "utf8")
    assert.match(text, /^WORK_CALENDARS=/m)
    assert.match(text, /# declared by @dreamteamer\/connectors-google-workspace\n/)
  })

  test("dt setup meetings --input calendar=… --no-input writes WORK_CALENDARS to .env", () => {
    const r = run(root, ["setup", "meetings", "--input", `calendar=${ROW}`, "--no-input"], env)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /✔ add-calendar-rows — wrote \.env \(WORK_CALENDARS\)/)
    assert.match(
      fs.readFileSync(path.join(root, ".env"), "utf8"),
      /^WORK_CALENDARS="team@northwind\.example \| northwind \| dana@northwind\.example"$/m
    )
  })
})
