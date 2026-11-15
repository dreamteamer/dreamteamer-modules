#!/usr/bin/env node
// THIS REPO'S SUITES ON AN ENGINE CHECKOUT — the whole candidate loop in one command, for a local engine
// branch that is not published yet. `node scripts/test-candidate.mjs <engine-checkout> [test.mjs args…]`:
//
//   1. packs the checkout with `npm pack` (its prepack builds dist/) into a temp folder and writes the
//      SHA256SUMS beside the tarball;
//   2. installs it over node_modules/dreamteamer with `scripts/use-candidate.mjs` — the same verified
//      step CI runs — after setting the published engine aside;
//   3. runs `scripts/test.mjs` with the remaining arguments (`--only=…`, `--module=…`) and DT_CANDIDATES
//      set, so `tests/candidate-engine.test.mjs` also checks the engine in place is the one packed;
//   4. puts the published engine back, whatever the suite did (pass `--keep` to stay on the candidate;
//      `npm ci` restores it later).
//
// The engine's branch, commit and a dirty tree are printed first: a run names the engine it measured.
// Exit status is the suite's, or 1 when packing or installing the candidate fails.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const die = m => {
  console.error(`✖ ${m}`)
  process.exit(1)
}

const args = process.argv.slice(2)
const keep = args.includes("--keep")
const engineArg = args.find(a => !a.startsWith("--"))
const testArgs = args.filter(a => a !== engineArg && a !== "--keep")
if (!engineArg) die("usage: node scripts/test-candidate.mjs <engine-checkout> [--keep] [scripts/test.mjs args…]")

const engine = path.resolve(engineArg)
const enginePkgFile = path.join(engine, "package.json")
if (!fs.existsSync(enginePkgFile)) die(`${engine}: no package.json — not an engine checkout`)
const enginePkg = JSON.parse(fs.readFileSync(enginePkgFile, "utf8"))
if (enginePkg.name !== "dreamteamer") die(`${engine} is ${enginePkg.name}, not the engine`)

const git = (...a) => {
  try {
    return execFileSync("git", ["-C", engine, ...a], { encoding: "utf8" }).trim()
  } catch {
    return null
  }
}
const branch = git("branch", "--show-current") || "(detached)"
const commit = git("rev-parse", "--short", "HEAD") ?? "(not a git checkout)"
const dirty = git("status", "--porcelain") ? " + uncommitted changes" : ""
console.log(`▶ engine ${enginePkg.version} from ${engine} — ${branch} @ ${commit}${dirty}`)

const installed = path.join(ROOT, "node_modules", "dreamteamer")
if (!fs.existsSync(path.join(installed, "package.json"))) die("node_modules/dreamteamer is missing — run npm ci first")

const work = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-test-candidate-"))
const folder = path.join(work, "candidate")
const saved = path.join(work, "published")
fs.mkdirSync(folder)

let swapped = false
const restore = () => {
  if (swapped && !keep) {
    fs.rmSync(installed, { recursive: true, force: true })
    fs.cpSync(saved, installed, { recursive: true, verbatimSymlinks: true })
    console.log(
      `↩ node_modules/dreamteamer is the published ${JSON.parse(fs.readFileSync(path.join(installed, "package.json"), "utf8")).version} again`
    )
  } else if (swapped) console.log("… --keep: node_modules/dreamteamer stays the candidate (npm ci restores it)")
  swapped = false
  fs.rmSync(work, { recursive: true, force: true })
}
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    restore()
    process.exit(130)
  })

let status = 1
try {
  console.log("▶ packing (the engine's prepack builds dist/)…")
  const packed = spawnSync("npm", ["pack", "--pack-destination", folder, "--json"], {
    cwd: engine,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  })
  if (packed.status !== 0) throw new Error(`npm pack in ${engine} failed (exit ${packed.status})`)
  const tgz = fs.readdirSync(folder).find(f => f.endsWith(".tgz"))
  if (!tgz) throw new Error("npm pack wrote no tarball")
  const sha = createHash("sha256")
    .update(fs.readFileSync(path.join(folder, tgz)))
    .digest("hex")
  fs.writeFileSync(path.join(folder, "SHA256SUMS"), `${sha}  ${tgz}\n`)

  fs.cpSync(installed, saved, { recursive: true, verbatimSymlinks: true })
  swapped = true
  const used = spawnSync(process.execPath, [path.join(ROOT, "scripts", "use-candidate.mjs"), folder, "--root", ROOT], {
    stdio: "inherit",
  })
  if (used.status !== 0) throw new Error("use-candidate refused the tarball (above)")

  console.log(`▶ node scripts/test.mjs ${testArgs.join(" ")}`.trimEnd())
  const tested = spawnSync(process.execPath, [path.join(ROOT, "scripts", "test.mjs"), ...testArgs], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, DT_CANDIDATES: folder },
  })
  status = tested.status ?? 1
  console.log(`${status === 0 ? "✔" : "✖"} suite on engine ${branch} @ ${commit}${dirty}: exit ${status}`)
} catch (e) {
  console.error(`✖ ${e.message}`)
  status = 1
} finally {
  restore()
}
process.exit(status)
