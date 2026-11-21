// EVERY MODULE IS PUBLISHABLE ALONE (cr-dt-008, task 7; rnd/tests dreamteamer-modules/check-alone-every-module).
//
// `dt check modules/<id> --alone` is the engine's own publish gate: it packs the module (and, offline from this
// repo's modules/, every dependency and every member of a module preset it names), installs that set alone into
// a fresh workspace, compiles and checks it. Run from this repo's root, which the engine reads as a workspace of
// inline modules. Engine 0.49.0 walks preset members, so below it the gate cannot judge core and every case skips.
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { ROOT, MODULES, SCOPE, moduleIds, pkgOf, run, ENGINE_VERSION } from "./helpers/workspace.ts"
import { engineMeets } from "dreamteamer/testing"

const skip =
  !engineMeets(">=0.49.0") && `dt check --alone walks module presets from engine 0.49.0; testing ${ENGINE_VERSION}`

// RELEASE ORDER. The gate packs a module's dreamteamer dependencies and preset members from this repo, but a
// sibling named in npm `dependencies` (one a module imports as code) is installed from the
// registry. So between the commit that bumps such a sibling and the tag that publishes it, the dependant cannot
// be judged: npm answers ETARGET. That one window skips, naming the sibling to publish first — and only when
// the registry really lacks every version the pin accepts. It never skips for the module a release tag is
// publishing (scripts/test.mjs --module=<id> sets DT_RELEASE_MODULE): there a missing sibling fails, so a tag
// pushed out of order publishes nothing.
// Only the registry SAYING so counts as "not there": an empty answer (no version matches the pin) or E404 (no
// such package). Offline, a timeout, an auth error — anything else — reads as "there", so the case runs and
// fails in its own words rather than skipping on a guess.
const onNpm = (name, range) => {
  try {
    return (
      execFileSync("npm", ["view", `${name}@${range}`, "version", "--json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
      }).trim() !== ""
    )
  } catch (e) {
    return !/\bE404\b/.test(`${e.stderr ?? ""}${e.stdout ?? ""}`)
  }
}
const awaitsSibling = m => {
  if (skip || process.env.DT_RELEASE_MODULE === m) return false
  for (const [name, range] of Object.entries(pkgOf(m).dependencies ?? {})) {
    if (
      !name.startsWith(`${SCOPE}/`) ||
      !fs.existsSync(path.join(MODULES, name.slice(SCOPE.length + 1), "package.json"))
    )
      continue
    if (!onNpm(name, range))
      return `release order: ${name}@${range} is not on npm yet — publish it first; this case runs for real on ${m}'s own release tag`
  }
  return false
}

describe("dt check modules/<id> --alone, for every module of this repo", { concurrency: 4 }, () => {
  for (const m of moduleIds()) {
    test(`${m} is publishable alone`, { skip: skip || awaitsSibling(m) }, () => {
      const r = run(ROOT, ["check", `modules/${m}`, "--alone"])
      const out = `${r.stdout}\n${r.stderr}`
      assert.equal(r.status, 0, `exit ${r.status}\n${out}`)
      assert.deepEqual(
        out.split("\n").filter(l => /^\s*✖/.test(l)),
        [],
        out
      )
      assert.match(r.stdout, new RegExp(`✔ modules/${m} is publishable`))
    })
  }
})
