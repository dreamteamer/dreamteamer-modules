#!/usr/bin/env node
// release:next — publish every module as one commit-stamped prerelease set under the `next` dist-tag,
// built for and tested on the engine's own `next`, so `dreamteamer@next` and `@dreamteamer/*@next` are
// installed and tried together. `latest` is never touched; nothing here moves a git tag or commits.
//
//   npm run release:next                 gates, suite on dreamteamer@next, pack, scan, smoke, confirm, publish
//   npm run release:next -- --no-names   skip the private-name scan on purpose (LEAK_NAMES unset)
//   npm run release:next -- --yes        publish without the confirmation prompt
//
// Each module's package.json is stamped only while `npm pack` runs, and every one is restored byte for
// byte before anything else happens:
//   version              <next patch>-next.<utc yyyymmddhhmmss>.g<short sha> — one stamp for the whole set
//   dreamteamer.engine   >=<the engine's next version>, so an older engine refuses the module by name
//   @dreamteamer/* in dependencies, peerDependencies and a preset's pins → the set's exact next versions,
//                        because npm keeps prereleases out of `>=x.y.z` ranges and would otherwise resolve
//                        a sibling to its `latest`, or refuse the peer outright
//
// ⚠ This is the local twin of release.yml for prereleases only, which docs/extensions-RELEASING.md
// allows; a `latest` release is still a tag and CI. The private-name list lives in a GitHub secret, so
// that scan runs only when LEAK_NAMES is exported and refuses without it unless --no-names says so.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import readline from "node:readline/promises"
import { execFile, spawnSync } from "node:child_process"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

export const DIST_TAG = "next"
const SCOPE = "@dreamteamer/"

// ⚠ nextVersion, SECRET_SHAPES and the scan are the engine's scripts/release-next.ts, copied: no package
// carries scripts between the two repositories. Change one, change both.
export const SECRET_SHAPES =
  /sk-ant-[A-Za-z0-9_-]{20}|sk-[A-Za-z0-9]{32}|ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[0-9A-Za-z-]{10,}|glpat-[0-9A-Za-z_-]{20}|npm_[A-Za-z0-9]{36}|-----BEGIN [A-Z ]*PRIVATE KEY-----/
const HEBREW = /[\u0590-\u05FF]/

export function nextVersion(current: string, now: Date, sha: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(current)
  if (!m) throw new Error(`version "${current}" is not semver`)
  const [major, minor, patch] = [m[1], m[2], Number(m[3])]
  const core = m[4] ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`
  const stamp = now.toISOString().replace(/\D/g, "").slice(0, 14)
  if (!/^[0-9a-f]{4,40}$/.test(sha)) throw new Error(`"${sha}" is not a commit sha`)
  return `${core}-${DIST_TAG}.${stamp}.g${sha}`
}

export interface Manifest {
  name: string
  version: string
  private?: boolean
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  dreamteamer?: { engine?: string; preset?: Record<string, string>; [key: string]: unknown }
  [key: string]: unknown
}

/** A module's manifest as its next tarball carries it; `versions` maps every package in the set. */
export function stampManifest(pkg: Manifest, versions: Map<string, string>, engineVersion: string): Manifest {
  const out = structuredClone(pkg)
  const own = versions.get(pkg.name)
  if (!own) throw new Error(`${pkg.name} is not in the set`)
  out.version = own
  out.dreamteamer = { ...out.dreamteamer, engine: `>=${engineVersion}` }
  for (const deps of [out.dependencies, out.peerDependencies, out.dreamteamer.preset])
    for (const name of Object.keys(deps ?? {})) if (versions.has(name)) deps[name] = versions.get(name)
  return out
}

// A path in the allow-list is a SOURCE (modules/recordings/skills/x/bin/detect.mts), a path in a tarball
// is what ships (dist/skills/x/bin/detect.mjs, its .d.mts, its map). Both reduce to the same stem.
const stem = (p: string): string => {
  const dir = path.posix.dirname(p.replace(/^dist\//, ""))
  const base = path.posix.basename(p).split(".")[0]
  return dir === "." ? base : `${dir}/${base}`
}

/** The Hebrew exemptions of one module, as stems a tarball path is matched against. */
export function hebrewAllowedIn(allowFile: string, moduleId: string): Set<string> {
  const allowed = new Set<string>()
  const prefix = `modules/${moduleId}/`
  for (const line of allowFile.split("\n")) {
    if (/^\s*(#|$)/.test(line)) continue
    const [file, rule] = line.split("\t")
    if (rule === "hebrew" && file.startsWith(prefix)) allowed.add(stem(file.slice(prefix.length)))
  }
  return allowed
}

export interface ScanFile {
  path: string
  bytes: Buffer
}

export interface ScanHits {
  names: string[]
  secrets: string[]
  hebrew: string[]
}

// Paths only, never the matching content: the names being looked for are themselves private.
export function scan(files: ScanFile[], names: RegExp | null, hebrewAllowed: Set<string>): ScanHits {
  const hits: ScanHits = { names: [], secrets: [], hebrew: [] }
  for (const f of files) {
    if (f.bytes.includes(0)) continue // binary, as grep -I skips it
    const text = f.bytes.toString("utf8")
    if (names?.test(text)) hits.names.push(f.path)
    if (SECRET_SHAPES.test(text)) hits.secrets.push(f.path)
    if (HEBREW.test(text) && !hebrewAllowed.has(stem(f.path))) hits.hebrew.push(f.path)
  }
  return hits
}

function walk(dir: string, base = dir): ScanFile[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return walk(full, base)
    return [{ path: path.relative(base, full).split(path.sep).join("/"), bytes: fs.readFileSync(full) }]
  })
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const execFileAsync = promisify(execFile)

function fail(message: string): never {
  console.error(`✖ ${message}`)
  process.exit(1)
}

function step(title: string): void {
  console.log(`\n▸ ${title}`)
}

function capture(cmd: string, args: string[], cwd = ROOT): string {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" })
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} failed:\n${r.stdout}${r.stderr}`)
  return r.stdout.trim()
}

function run(cmd: string, args: string[], cwd = ROOT): void {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" })
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} exited ${r.status}`)
}

async function published(name: string): Promise<boolean> {
  try {
    return Boolean((await execFileAsync("npm", ["view", name, "version"])).stdout.trim())
  } catch {
    return false
  }
}

// The set, engine@next and every module tarball installed by npm into one fresh workspace: npm must
// resolve every pinned sibling from the set, and compile must refuse no module for its engine floor.
function smoke(engineTgz: string, moduleTgzs: string[], dir: string): void {
  fs.mkdirSync(dir)
  capture("git", ["init", "-q"], dir)
  capture("git", ["config", "user.email", "release-next@example.com"], dir)
  capture("git", ["config", "user.name", "Smoke"], dir)
  capture("npm", ["init", "-y"], dir)
  run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", engineTgz, ...moduleTgzs], dir)
  fs.writeFileSync(
    path.join(dir, ".env"),
    `FILES_FOLDER=${dir}/files\nINBOX_FOLDERS=${dir}/inbox\nREPOS_FOLDER=${dir}\n`
  )
  const bin = path.join(dir, "node_modules", "dreamteamer", "bin", "dreamteamer.js")
  const dt = (...args: string[]) => {
    const r = spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: "utf8" })
    const out = `${r.stdout}${r.stderr}`
    if (r.status !== 0) fail(`dt ${args.join(" ")} exited ${r.status}:\n${out}`)
    return out
  }
  dt("init")
  const refused = dt("compile")
    .split("\n")
    .filter(l => /needs engine/.test(l))
  if (refused.length) fail(`compile refused modules for their engine floor:\n  ${refused.join("\n  ")}`)
  dt("check")
  console.log(`  ✔ npm installed the set; init, compile (no module refused), check`)
}

async function main(argv: string[]): Promise<void> {
  const known = new Set(["--no-names", "--yes"])
  const unknown = argv.filter(a => !known.has(a))
  if (unknown.length) fail(`unknown flag ${unknown.join(", ")} — expected ${[...known].join(", ")}`)
  const flags = new Set(argv)

  step("the tree is clean")
  if (capture("git", ["status", "--porcelain"]))
    fail("the working tree has changes — commit or stash them, so the stamped commit is what ships")

  const leakNames = process.env.LEAK_NAMES?.trim()
  if (!leakNames && !flags.has("--no-names"))
    fail("LEAK_NAMES is not set, so the private-name scan cannot run. Export it, or pass --no-names to skip it.")

  step("npm login")
  console.log(`  publishing as ${capture("npm", ["whoami"])}`)

  step("dreamteamer@next")
  const engineVersion = spawnSync("npm", ["view", `dreamteamer@${DIST_TAG}`, "version"], { encoding: "utf8" })
    .stdout?.trim()
    .split("\n")
    .pop()
  if (!engineVersion) fail(`the engine has no \`${DIST_TAG}\` on npm — publish one first (npm run release:next there)`)
  console.log(`  ${engineVersion}`)

  step("the set: every module already on npm")
  const modules = fs
    .readdirSync(path.join(ROOT, "modules"))
    .filter(id => fs.existsSync(path.join(ROOT, "modules", id, "package.json")))
    .map(id => {
      const file = path.join(ROOT, "modules", id, "package.json")
      const text = fs.readFileSync(file, "utf8")
      return { id, file, text, pkg: JSON.parse(text) as Manifest }
    })
    .filter(m => !m.pkg.private && m.pkg.name.startsWith(SCOPE))
  const onNpm = await Promise.all(modules.map(m => published(m.pkg.name)))
  const set = modules.filter((_, i) => onNpm[i])
  const skipped = modules.filter((_, i) => !onNpm[i]).map(m => m.pkg.name)
  if (skipped.length) console.log(`  skipped, never published (a first publish is a release): ${skipped.join(", ")}`)

  const sha = capture("git", ["rev-parse", "--short=7", "HEAD"])
  const now = new Date()
  const versions = new Map(set.map(m => [m.pkg.name, nextVersion(m.pkg.version, now, sha)]))
  console.log(`  ${set.length} modules at ${sha}, e.g. ${set[0].pkg.name}@${versions.get(set[0].pkg.name)}`)

  step("gates: types, format, build")
  run("npm", ["run", "typecheck"])
  run("npm", ["run", "format:check"])
  run("npm", ["run", "build"])

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dtm-release-next-"))
  try {
    const engineDir = path.join(tmp, "engine")
    fs.mkdirSync(engineDir)
    const engineTgz = path.join(
      engineDir,
      capture("npm", ["pack", `dreamteamer@${engineVersion}`, "--silent", "--pack-destination", engineDir])
        .split("\n")
        .pop()!
    )

    step(`the whole suite on dreamteamer@${engineVersion}`)
    run(process.execPath, [path.join(ROOT, "scripts", "test-candidate.ts"), engineTgz])

    step("pack (package.json stamped for the pack only)")
    const packDir = path.join(tmp, "modules")
    fs.mkdirSync(packDir)
    const tarballs = new Map<string, string>()
    try {
      for (const m of set)
        fs.writeFileSync(m.file, JSON.stringify(stampManifest(m.pkg, versions, engineVersion), null, "\t") + "\n")
      for (const m of set) {
        const name = capture("npm", ["pack", "--silent", "--pack-destination", packDir], path.dirname(m.file))
        tarballs.set(m.pkg.name, path.join(packDir, name.split("\n").pop()!))
      }
    } finally {
      for (const m of set) fs.writeFileSync(m.file, m.text)
    }
    if (capture("git", ["status", "--porcelain"])) fail("the tree is not clean after packing — inspect `git status`")
    console.log(`  ${tarballs.size} tarballs, every package.json restored`)

    step(`leak scan of every tarball${leakNames ? "" : " (private names SKIPPED: --no-names)"}`)
    const allowFile = path.join(ROOT, ".leak-scan-allow")
    const allowText = fs.existsSync(allowFile) ? fs.readFileSync(allowFile, "utf8") : ""
    const names = leakNames ? new RegExp(leakNames, "i") : null
    let files = 0
    let dirty = false
    for (const m of set) {
      const unpacked = path.join(tmp, "unpacked", m.id)
      fs.mkdirSync(unpacked, { recursive: true })
      capture("tar", ["-xzf", tarballs.get(m.pkg.name)!, "-C", unpacked])
      const pkgDir = path.join(unpacked, "package")
      const packed = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")) as Manifest
      if (packed.version !== versions.get(m.pkg.name)) fail(`${m.pkg.name}: the tarball says ${packed.version}`)
      if (packed.dreamteamer?.engine !== `>=${engineVersion}`)
        fail(`${m.pkg.name}: the tarball floors the engine at ${packed.dreamteamer?.engine}`)
      const contents = walk(pkgDir)
      files += contents.length
      const hits = scan(contents, names, hebrewAllowedIn(allowText, m.id))
      for (const [what, paths] of [
        ["match a private name", hits.names],
        ["match a credential shape", hits.secrets],
        ["carry Hebrew outside .leak-scan-allow", hits.hebrew],
      ] as const)
        if (paths.length) {
          dirty = true
          console.error(`  ${m.pkg.name}: ${paths.length} file(s) ${what}:\n    ${paths.join("\n    ")}`)
        }
    }
    if (dirty) fail("a tarball failed the leak scan — nothing was published")
    console.log(`  ✔ ${files} files clean`)

    step(`smoke: dreamteamer@${engineVersion} and the whole set in one workspace`)
    smoke(engineTgz, [...tarballs.values()], path.join(tmp, "smoke"))

    console.log(
      `\n  ${set.length} modules, dist-tag ${DIST_TAG} (latest is not touched), engine floor >=${engineVersion}`
    )
    for (const m of set) console.log(`    ${m.pkg.name}@${versions.get(m.pkg.name)}`)
    if (!flags.has("--yes")) {
      if (!process.stdin.isTTY) fail("no terminal to confirm on — pass --yes to publish non-interactively")
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      const answer = await rl.question(`  Publish all ${set.length}? These versions are permanent. [y/N] `)
      rl.close()
      if (!/^y(es)?$/i.test(answer.trim())) fail("not published")
    }

    step("publish")
    const done: string[] = []
    for (const m of set) {
      // no --access: every package in the set already exists, and keeps the access it has
      const r = spawnSync("npm", ["publish", tarballs.get(m.pkg.name)!, "--tag", DIST_TAG], { stdio: "inherit" })
      if (r.status !== 0)
        fail(
          `${m.pkg.name} failed to publish — ${done.length} of ${set.length} are out (${done.join(", ") || "none"}). ` +
            "Run release:next again for a fresh, complete set; the partial one is superseded under the same tag."
        )
      done.push(m.pkg.name)
    }
    console.log(`\n✔ published ${done.length} modules — install with: npm install @dreamteamer/<id>@${DIST_TAG}`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

const real = (p: string): string => {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) await main(process.argv.slice(2))
