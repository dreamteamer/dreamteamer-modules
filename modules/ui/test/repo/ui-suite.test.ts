// ui's own suites, run from the repo's runner as ui-legacy's test/ui-suite.test.mjs runs the Vue app's: the unit tests
// (test/*.test.ts, Node's type stripping, no browser) and the types (tsc, strict). Each is a child with a timeout.
// It lives one folder down so ui's `npm test` (`node --test test/*.test.ts`) never runs itself.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const require = createRequire(import.meta.url)

test("the unit tests pass", { timeout: 300_000 }, () => {
  // listed here, not globbed: Node 20 does not expand a pattern
  const files = fs
    .readdirSync(path.join(UI, "test"))
    .filter(f => f.endsWith(".test.ts"))
    .sort()
    .map(f => path.join("test", f))
  assert.ok(files.length > 0, "no unit tests found")
  // without the runner's own context: a `node --test` that inherits NODE_TEST_CONTEXT skips every file and exits 0
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST_")))
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...files], {
    cwd: UI,
    encoding: "utf8",
    env,
    timeout: 280_000,
  })
  assert.equal(r.status, 0, `${r.stdout.slice(-4000)}\n${r.stderr.slice(-2000)}`)
  const passed = Number(/^# pass (\d+)$/m.exec(r.stdout)?.[1] ?? 0)
  assert.ok(passed > files.length, `only ${passed} tests ran:\n${r.stdout.slice(-2000)}\n${r.stderr.slice(-2000)}`)
})

test("the source typechecks", { timeout: 300_000 }, () => {
  const bin = path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc")
  const r = spawnSync(process.execPath, [bin, "-p", "src/tsconfig.json"], {
    cwd: UI,
    encoding: "utf8",
    timeout: 280_000,
  })
  assert.equal(r.status, 0, `${r.stdout.slice(-4000)}\n${r.stderr.slice(-2000)}`)
})
