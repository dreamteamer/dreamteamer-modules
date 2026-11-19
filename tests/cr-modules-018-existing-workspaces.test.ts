// ACCEPTANCE — A WORKSPACE ON CORE 0.12.0 MOVES TO 0.13.0 AND LOSES NOTHING (cr-modules-018; rnd/tests
// dreamteamer-modules/cr-modules-018-t6, -t9). The "before" is what a person has today: core 0.12.0 and
// its seventeen pinned members, and @dreamteamer/google-workspace 0.3.0, packed from the npm registry
// (all published). The "after" is this repo, packed. Every engine run gets a HOME of its own; the update
// and the installs read the packed folders (`--from`), so the only network use is `npm pack` of the
// published set — each case skips, naming the reason, when the registry does not answer.
//
// t6 is line 6: update core, install both connectors — every record file byte-identical, `dt check`
// clean, /scrape-contact and /fetch-meetings compiled again. t9 is the acceptance review's finding
// `switch-from-google-workspace-has-no-line`: a workspace that also holds google-workspace 0.3.0 and has
// its calendars, credentials and setup receipts takes the documented switch (update core, `npm uninstall
// @dreamteamer/google-workspace`, install the connector) and keeps all of them.
import { test, describe, before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import {
  ROOT,
  closure,
  packedInto,
  virginWorkspace,
  run,
  cleanup,
  engineMeets,
  ENGINE_VERSION,
} from "./helpers/workspace.ts"

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
const HOME = () => ({ HOME: tmp("dtm-HOME-") })

// The parent's npm_* environment is dropped: under `npm test` it names THIS repo as the prefix.
const npmEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k)))
const npm = (args, opts = {}) => spawnSync("npm", args, { encoding: "utf8", timeout: 180_000, env: npmEnv(), ...opts })

function registrySkip() {
  if (!engineMeets("core")) return `a module preset installs on engine 0.49.0 or later; testing ${ENGINE_VERSION}`
  const r = npm(["view", "@dreamteamer/core@0.12.0", "version"], { timeout: 30_000 })
  return r.status === 0 && r.stdout.trim() === "0.12.0" ? false : "registry unreachable"
}
const skip = registrySkip()

const FIXTURES = path.join(ROOT, "tests", "fixtures", "cr-modules-018", "data")
const SYNC_ROW = "team@northwind.example | northwind | dana@northwind.example"

let OLD, NEW
/** core 0.12.0, its seventeen pins and google-workspace 0.3.0, packed from the registry into one folder. */
function oldSet() {
  if (OLD) return OLD
  const preset = JSON.parse(npm(["view", "@dreamteamer/core@0.12.0", "dreamteamer.preset", "--json"]).stdout)
  assert.equal(Object.keys(preset).length, 17, "core 0.12.0 does not pin seventeen members")
  const dir = tmp("dtm-018-old-")
  const specs = [
    "@dreamteamer/core@0.12.0",
    "@dreamteamer/google-workspace@0.3.0",
    ...Object.entries(preset).map(([n, v]) => `${n}@${v}`),
  ]
  const r = npm(["pack", ...specs, "--pack-destination", dir, "--silent"], { cwd: dir })
  assert.equal(r.status, 0, `npm pack of the published 0.12.0 set: ${r.stderr}`)
  assert.equal(fs.readdirSync(dir).filter(f => f.endsWith(".tgz")).length, specs.length)
  return (OLD = dir)
}
/** This repo: core 0.13.0 with its members and both connectors. */
const newSet = () =>
  (NEW ??= packedInto(
    tmp("dtm-018-new-"),
    ...new Set([...closure("core"), ...closure("connectors-linkedin"), ...closure("connectors-google-workspace")])
  ))

/** Every file under data/, relative to the workspace, with its sha256. */
function dataHashes(root) {
  const out = {}
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else out[path.relative(root, p)] = createHash("sha256").update(fs.readFileSync(p)).digest("hex")
    }
  }
  walk(path.join(root, "data"))
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

const ok = (r, what, codes = [0]) =>
  assert.ok(codes.includes(r.status), `${what}: exit ${r.status}\n${r.stderr}\n${r.stdout.slice(-1500)}`)
const git = (root, ...args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...npmEnv(),
      GIT_AUTHOR_NAME: "Dana Oren",
      GIT_AUTHOR_EMAIL: "dana.o@northwind.example",
      GIT_COMMITTER_NAME: "Dana Oren",
      GIT_COMMITTER_EMAIL: "dana.o@northwind.example",
    },
  })

/** A workspace on the published core 0.12.0 holding the t5 fixtures and one task, project and company. */
function workspaceOn012({ googleWorkspace = false } = {}) {
  const root = virginWorkspace()
  ok(
    run(root, ["install", "@dreamteamer/core", "--from", oldSet(), "--no-input"], HOME()),
    "dt install @dreamteamer/core (0.12.0)"
  )
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, "node_modules", "@dreamteamer", "core", "package.json"), "utf8"))
      .version,
    "0.12.0"
  )
  if (googleWorkspace)
    ok(
      run(root, ["install", "@dreamteamer/google-workspace", "--from", oldSet(), "--no-input"], HOME()),
      "dt install @dreamteamer/google-workspace (0.3.0)",
      [0, 3]
    )
  // before the change, the scraper and the sync are there
  for (const f of ["scrape-contact", "fetch-meetings"])
    assert.ok(fs.existsSync(path.join(root, ".dreamteamer", "commands", `${f}.command.md`)), `0.12.0 compiled no /${f}`)
  for (const f of walkFixtures()) {
    fs.mkdirSync(path.dirname(path.join(root, "data", f)), { recursive: true })
    fs.copyFileSync(path.join(FIXTURES, f), path.join(root, "data", f))
  }
  ok(run(root, ["add", "tasks", "--name", "Send Harbor Mutual the workshop agenda"], HOME()), "dt add tasks")
  ok(run(root, ["add", "projects", "--name", "Northwind onboarding"], HOME()), "dt add projects")
  ok(run(root, ["add", "companies", "--name", "Harbor Mutual"], HOME()), "dt add companies")
  const c = run(root, ["check"], HOME())
  ok(c, "dt check on 0.12.0")
  git(root, "add", "-A")
  git(root, "commit", "-q", "-m", "records before the core update")
  return root
}
function walkFixtures(dir = FIXTURES) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap(e =>
      e.isDirectory() ? walkFixtures(path.join(dir, e.name)) : [path.relative(FIXTURES, path.join(dir, e.name))]
    )
}

describe("t6 a 0.12.0 workspace updated keeps everything (line 6)", { skip }, () => {
  let root, before_
  before(() => {
    root = workspaceOn012()
    before_ = dataHashes(root)
    ok(run(root, ["update", "@dreamteamer/core", "--from", newSet()], HOME()), "dt update @dreamteamer/core")
    ok(
      run(root, ["install", "@dreamteamer/connectors-linkedin", "--from", newSet(), "--no-input"], HOME()),
      "dt install @dreamteamer/connectors-linkedin"
    )
    ok(
      run(root, ["install", "@dreamteamer/connectors-google-workspace", "--from", newSet(), "--no-input"], HOME()),
      "dt install @dreamteamer/connectors-google-workspace",
      [0, 3]
    )
  })
  test("core is 0.13.x and both connectors are installed", () => {
    const v = n =>
      JSON.parse(fs.readFileSync(path.join(root, "node_modules", "@dreamteamer", n, "package.json"), "utf8")).version
    assert.match(v("core"), /^0\.13\.\d+$/) // this repo's core: a 0.13 patch carries the move cr-modules-018 proves
    assert.equal(v("contacts"), "0.2.0")
    assert.equal(v("meetings"), "0.4.0")
    assert.ok(v("connectors-linkedin"))
    assert.ok(v("connectors-google-workspace"))
  })
  test("every data/ file is present with the same sha256", () => {
    assert.ok(Object.keys(before_).length >= 9, `only ${Object.keys(before_).length} record files before`)
    assert.deepEqual(dataHashes(root), before_)
  })
  test("dt check exits 0", () => {
    const c = run(root, ["check"], HOME())
    assert.equal(c.status, 0, `${c.stdout}\n${c.stderr}`)
  })
  test("/scrape-contact and /fetch-meetings are compiled commands again", () => {
    for (const f of ["scrape-contact", "fetch-meetings"])
      assert.ok(fs.existsSync(path.join(root, ".dreamteamer", "commands", `${f}.command.md`)), `/${f} is not compiled`)
  })
})

describe("t9 a google-workspace 0.3.0 workspace switches to the connector and loses nothing", { skip }, () => {
  const KEPT = ["WORK_CALENDARS", "GOOGLE_CLIENT_SECRET_PATH", "WORKSPACE_MCP_CREDENTIALS_DIR"]
  const RECEIPTS = ["google-workspace", "meetings"].map(u =>
    path.join(".dreamteamer", "setup", u, "cr-modules-018-probe.json")
  )
  let root, before_, env0, envLines
  const envLine = (text, k) => text.split("\n").filter(l => l.startsWith(`${k}=`))
  before(() => {
    root = workspaceOn012({ googleWorkspace: true })
    ok(
      run(root, ["setup", "meetings", "--input", `calendar=${SYNC_ROW}`, "--no-input"], HOME()),
      "dt setup meetings on 0.12.0"
    )
    const credentials = tmp("dtm-018-creds-")
    // a value the person chose, for each key google-workspace 0.3.0's install did not already write
    const values = {
      GOOGLE_CLIENT_SECRET_PATH: `${credentials}/client_secret.json`,
      WORKSPACE_MCP_CREDENTIALS_DIR: `${credentials}/accounts`,
    }
    for (const [k, v] of Object.entries(values)) {
      if (envLine(fs.readFileSync(path.join(root, ".env"), "utf8"), k).length === 0)
        fs.appendFileSync(path.join(root, ".env"), `${k}=${v}\n`)
    }
    for (const r of RECEIPTS) {
      fs.mkdirSync(path.dirname(path.join(root, r)), { recursive: true })
      fs.writeFileSync(
        path.join(root, r),
        JSON.stringify({ unit: path.basename(path.dirname(r)), verified: "2026-11-14T10:00:00+02:00" }) + "\n"
      )
    }
    env0 = fs.readFileSync(path.join(root, ".env"), "utf8")
    envLines = Object.fromEntries(KEPT.map(k => [k, envLine(env0, k)]))
    for (const k of KEPT)
      assert.equal(envLines[k].length, 1, `${k} is not set exactly once before the switch:\n${env0}`)
    before_ = dataHashes(root)
    // the documented switch (core UPDATING 0.13.0, connectors-google-workspace README 0.4.0)
    ok(run(root, ["update", "@dreamteamer/core", "--from", newSet()], HOME()), "dt update @dreamteamer/core")
    const u = npm(["uninstall", "@dreamteamer/google-workspace", "--no-audit", "--no-fund", "--offline"], { cwd: root })
    assert.equal(u.status, 0, `npm uninstall @dreamteamer/google-workspace: ${u.stderr}`)
    ok(
      run(root, ["install", "@dreamteamer/connectors-google-workspace", "--from", newSet(), "--no-input"], HOME()),
      "dt install @dreamteamer/connectors-google-workspace",
      [0, 3]
    )
  })
  test("google-workspace is gone and the connector is installed", () => {
    assert.ok(
      !fs.existsSync(path.join(root, "node_modules", "@dreamteamer", "google-workspace")),
      "node_modules still holds google-workspace"
    )
    assert.ok(
      fs.existsSync(path.join(root, "node_modules", "@dreamteamer", "connectors-google-workspace", "package.json"))
    )
  })
  test(".env keeps the three values byte for byte", () => {
    const now = fs.readFileSync(path.join(root, ".env"), "utf8")
    for (const k of KEPT) assert.deepEqual(envLine(now, k), envLines[k], k)
  })
  test("both setup receipts are still there, unchanged", () => {
    for (const r of RECEIPTS) assert.ok(fs.existsSync(path.join(root, r)), `${r} is gone`)
  })
  test("dt status shows connectors-google-workspace › meetings, not missing WORK_CALENDARS", () => {
    const s = run(root, ["status"], HOME())
    assert.equal(s.status, 0, s.stderr)
    const line = s.stdout.split("\n").find(l => /connectors-google-workspace › meetings\s/.test(l))
    assert.ok(line, s.stdout)
    assert.doesNotMatch(line, /WORK_CALENDARS missing/)
    assert.doesNotMatch(s.stdout, /^\s*google-workspace\s/m, "the old package still has a status line")
  })
  test("/fetch-meetings is compiled, data/ is unchanged and dt check exits 0", () => {
    assert.ok(fs.existsSync(path.join(root, ".dreamteamer", "commands", "fetch-meetings.command.md")))
    assert.deepEqual(dataHashes(root), before_)
    const c = run(root, ["check"], HOME())
    assert.equal(c.status, 0, `${c.stdout}\n${c.stderr}`)
  })
})
