// scripts/unreleased.ts — what release-unreleased.yml publishes: a module whose version npm does not hold,
// every module or only the named ones; an unknown name and a registry that did not answer stop the plan.
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { unreleased } from "../scripts/unreleased.ts"

const repo = (mods: Record<string, { version: string; private?: boolean }>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dt-unreleased-"))
  for (const [id, m] of Object.entries(mods)) {
    fs.mkdirSync(path.join(root, "modules", id), { recursive: true })
    fs.writeFileSync(
      path.join(root, "modules", id, "package.json"),
      JSON.stringify({ name: `@dreamteamer/${id}`, version: m.version, ...(m.private ? { private: true } : {}) })
    )
  }
  fs.mkdirSync(path.join(root, "modules", "not-a-module"))
  return root
}
const ROOT = repo({
  web: { version: "0.4.0" },
  ui: { version: "0.4.0" },
  core: { version: "0.13.2" },
  code: { version: "0.2.0", private: true },
})
const NPM = new Set(["@dreamteamer/core@0.13.2", "@dreamteamer/ui@0.3.2"])
const has = (name: string, version: string) => NPM.has(`${name}@${version}`)

test("every module whose version npm lacks, sorted; a published one and a private one are left out", () => {
  assert.deepEqual(unreleased(ROOT, has), [
    { id: "ui", name: "@dreamteamer/ui", version: "0.4.0" },
    { id: "web", name: "@dreamteamer/web", version: "0.4.0" },
  ])
})

test("--modules narrows the plan, and a named module npm already holds is not released again", () => {
  assert.deepEqual(
    unreleased(ROOT, has, ["web"]).map(m => m.id),
    ["web"]
  )
  assert.deepEqual(unreleased(ROOT, has, ["core"]), [])
})

test("a name that is no module stops the plan", () => {
  assert.throws(() => unreleased(ROOT, has, ["web", "nope"]), /no such module: nope/)
})

test("a registry that did not answer stops the plan rather than reading as unreleased", () => {
  const down = () => {
    throw new Error("npm view failed: ETIMEDOUT")
  }
  assert.throws(() => unreleased(ROOT, down), /ETIMEDOUT/)
})
