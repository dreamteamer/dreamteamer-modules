// THE BUILD'S TEMPORARY FILES NEVER REACH GIT. scripts/build.ts writes `.tsconfig.build.<pid>.json` beside a module
// for one tsc run and removes it in a `finally`; an interrupted build leaves one behind, holding the absolute paths of
// the machine that built it. One was committed that way. The leak gate's own suite skips every file whose name starts
// with a dot, so this check is its own: no such file is tracked, and git ignores the next one.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { ROOT } from "./helpers/workspace.ts"

const BUILD_TEMP = /(^|\/)\.tsconfig\.build\.\d+\.json$/

test("no build tsconfig is tracked", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n")
  assert.deepEqual(
    tracked.filter(f => BUILD_TEMP.test(f)),
    []
  )
})

test("git ignores the next one, wherever a build writes it", () => {
  for (const f of ["modules/users/.tsconfig.build.4242.json", ".tsconfig.build.7.json"]) {
    const r = spawnSync("git", ["check-ignore", "--no-index", "-q", f], { cwd: ROOT })
    assert.equal(r.status, 0, `${f} is not ignored`)
  }
})
