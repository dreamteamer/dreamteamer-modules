// The perspective reader's workspace resolver walks up for `package-lock.json` — `package.json` alone is not
// enough, because a module folder carries one. This pins that an inline module still finds its workspace.
import { test } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

const probe = fromDir =>
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { WORKSPACE_ROOT } from ${JSON.stringify(path.join(fromDir, "lib", "workspace.mjs"))}; process.stdout.write(WORKSPACE_ROOT);`,
    ],
    { encoding: "utf8" }
  )

// the built helper (dist/skills, scripts/build.ts): it is copied into fake trees and run from there as JavaScript
const LIB = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "dist",
  "skills",
  "running-retrospectives",
  "lib",
  "workspace.mjs"
)

/** A workspace with a lockfile, holding a clone that ALSO has one. */
test("the same resolver still finds a plain workspace with no clone involved", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-plain-"))
  const inner = path.join(root, "modules", "perspective", "skills", "running-retrospectives")
  fs.mkdirSync(path.join(inner, "lib"), { recursive: true })
  fs.writeFileSync(path.join(root, "package-lock.json"), "{}")
  fs.copyFileSync(LIB, path.join(inner, "lib", "workspace.mjs"))
  assert.equal(probe(inner), fs.realpathSync(root), "an inline module still walks up to its workspace")
})
