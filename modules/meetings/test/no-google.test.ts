// MEETINGS ALONE REACHES NO GOOGLE (cr-modules-018). The calendar sync — `/fetch-meetings`, the
// `fetching-meetings` skill, the `meetings` setup unit and `WORK_CALENDARS` — left meetings for
// `@dreamteamer/connectors-google-workspace`. Meetings keeps every field, `/update-contacts-from-meetings`
// and the two record-writing scripts, now under its own `bin/`. Measured on the real engine with the
// packed closure in a fresh workspace and a HOME of its own, never a reading of the source tree alone.
import { test, describe, before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { virginWorkspace, installPacked, closure, pkgOf, run, cleanup } from "../../../tests/helpers/workspace.ts"

const homes = []
after(() => {
  cleanup()
  for (const h of homes) fs.rmSync(h, { recursive: true, force: true })
})

describe("meetings alone: no calendar sync, no setup unit, no Google", () => {
  let root, env
  before(() => {
    root = virginWorkspace()
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dtm-HOME-")))
    homes.push(home)
    env = { HOME: home }
    installPacked(root, [...closure("meetings")])
    const c = run(root, ["compile"], env)
    assert.equal(c.status, 0, `${c.stdout}\n${c.stderr}`)
  })

  test("compiles no /fetch-meetings command and no fetching-meetings skill", () => {
    assert.ok(
      !fs.existsSync(path.join(root, ".dreamteamer", "commands", "fetch-meetings.command.md")),
      "/fetch-meetings was compiled"
    )
    assert.ok(
      !fs.existsSync(path.join(root, ".dreamteamer", "skills", "fetching-meetings")),
      "the fetching-meetings skill was compiled"
    )
  })

  test("compiles /update-contacts-from-meetings, which stays in meetings", () => {
    assert.ok(fs.existsSync(path.join(root, ".dreamteamer", "commands", "update-contacts-from-meetings.command.md")))
  })

  test("declares no env key and no extension, so nothing asks for WORK_CALENDARS", () => {
    const dt = pkgOf("meetings").dreamteamer
    assert.equal(dt.env, undefined)
    assert.equal(dt.extension, undefined)
    const example = path.join(root, ".env.example")
    if (fs.existsSync(example)) assert.doesNotMatch(fs.readFileSync(example, "utf8"), /WORK_CALENDARS/)
  })

  test("dt status has no meetings setup line and no line naming Google or WORK_CALENDARS", () => {
    const j = run(root, ["status", "--json"], env)
    assert.equal(j.status, 0, j.stderr)
    const setup = JSON.parse(j.stdout).setup
    assert.deepEqual(
      setup.filter(l => l.unit === "meetings"),
      [],
      "a meetings setup unit is still declared"
    )
    const s = run(root, ["status"], env)
    assert.equal(s.status, 0, s.stderr)
    const lines = (s.stdout + s.stderr).split("\n").filter(l => /google|WORK_CALENDARS/i.test(l))
    assert.deepEqual(lines, [])
    assert.doesNotMatch(s.stdout, /meetings\s+(configured|blocked|ready)/)
  })

  test("dt doctor has no meetings unit block", () => {
    const d = run(root, ["doctor"], env)
    assert.doesNotMatch(d.stdout, /^(\S+ › )?meetings — /m, d.stdout)
    assert.doesNotMatch(d.stdout + d.stderr, /WORK_CALENDARS|google/i)
  })

  test("node node_modules/@dreamteamer/meetings/bin/touch-contacts.mjs --all --dry-run, from the workspace root, exits 0", () => {
    // every consumer workspace has a lockfile; the script resolves the workspace by it
    if (!fs.existsSync(path.join(root, "package-lock.json")))
      fs.writeFileSync(path.join(root, "package-lock.json"), "{}\n")
    const r = spawnSync(
      process.execPath,
      [path.join("node_modules", "@dreamteamer", "meetings", "bin", "touch-contacts.mjs"), "--all", "--dry-run"],
      { cwd: root, encoding: "utf8", timeout: 60_000 }
    )
    assert.equal(r.status, 0, r.stderr + r.stdout)
    assert.match(r.stdout, /would update 0 contact\(s\) from 0 meeting\(s\)/)
  })
})
