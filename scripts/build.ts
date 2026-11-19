#!/usr/bin/env node
// build — every module's TypeScript into the JavaScript its package ships. A checkout runs the .ts through
// Node's type stripping; an installed package cannot (Node strips no types under node_modules, and Node 20
// strips none at all), so what npm packs is this build.
//
//   node scripts/build.ts                  every module
//   node scripts/build.ts --module=web     one module (repeatable); a module's `prepack` runs this
//   node scripts/build.ts --root=<clone>   the modules of another checkout (what `preview.mjs link` builds)
//
// Everything it writes is under the module's dist/, which mirrors the module root, so a relative import between
// folders resolves the same in either tree:
//   • src/, lib/, bin/ → dist/src, dist/lib, dist/bin (x.ts → x.js). The manifest names dist/ for main, exports,
//     the extension, its npm `bin` and its `dreamteamer.scripts` (run by name: `dt run <module> <script>`).
//   • a module whose skills hold TypeScript is built whole into dist/skills (x.mts → x.mjs, every other file
//     copied), and its manifest's `dreamteamer.skills: "dist/skills"` has `dt compile` stage its skills from
//     there — to the same .dreamteamer/skills/<name>/ paths their SKILL.md runs.
// Each code .ts emits its .d.ts beside its .js (skills, which nothing imports, emit none), generated from the source's own types, so the declarations a consumer
// compiles against cannot drift from the code. Files beside the code that are not TypeScript (assets) are copied.
// Types are not checked here (`npm run typecheck` does that); a file tsc cannot emit fails the build.
// ui and ui2 are browser apps with their own Vite build and are skipped.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// The checkout to build: --root, else the one this script sits in. Explicit because a caller may reach this file
// through a symlink, and Node resolves the entry's real path — the script's own location is not the caller's tree.
const rootArg = process.argv.find(a => a.startsWith("--root="))?.slice("--root=".length)
const ROOT = rootArg ? path.resolve(rootArg) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const MODULES = path.join(ROOT, "modules")
// tsc is this script's own dependency, wherever the checkout it builds is
const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const CODE_DIRS = ["src", "lib", "bin"]
const BROWSER_APPS = new Set(["ui", "ui2"])
const TSC = path.join(TOOLS, "node_modules", "typescript", "bin", "tsc")

const OPTIONS = [
  "--target",
  "es2023",
  "--module",
  "nodenext",
  "--moduleResolution",
  "nodenext",
  "--rewriteRelativeImportExtensions",
  "--allowImportingTsExtensions",
  "--verbatimModuleSyntax",
  "--erasableSyntaxOnly",
  "--resolveJsonModule",
  "--skipLibCheck",
  "--noCheck",
  "--sourceMap",
  "false",
  "--types",
  "node",
]

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "__pycache__"].includes(e.name) || e.name.startsWith(".")) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const isSource = (f: string) => f.endsWith(".ts") && !f.endsWith(".d.ts")

function tsc(files: string[], rootDir: string, outDir: string, extra: string[] = []) {
  // the file list goes through a generated tsconfig: a command line has a length limit on Windows
  const config = path.join(rootDir, `.tsconfig.build.${process.pid}.json`)
  fs.writeFileSync(config, JSON.stringify({ files }))
  try {
    execFileSync(
      process.execPath,
      [TSC, "-p", config, "--rootDir", rootDir, "--outDir", outDir, ...OPTIONS, ...extra],
      {
        cwd: ROOT,
        stdio: "inherit",
      }
    )
  } finally {
    fs.rmSync(config, { force: true })
  }
}

/** A script with a shebang stays runnable by its path. */
function keepRunnable(file: string) {
  const fd = fs.openSync(file, "r")
  const head = Buffer.alloc(2)
  fs.readSync(fd, head, 0, 2, 0)
  fs.closeSync(fd)
  if (head.toString() === "#!") fs.chmodSync(file, 0o755)
}

export function buildModule(id: string): { code: number; skills: number } {
  const dir = path.join(MODULES, id)
  const dist = path.join(dir, "dist")
  const inCode = CODE_DIRS.flatMap(d => walk(path.join(dir, d)))
  const code = inCode.filter(isSource)
  const skills = walk(path.join(dir, "skills")).filter(f => f.endsWith(".mts"))

  fs.rmSync(dist, { recursive: true, force: true })
  if (code.length) {
    tsc(code, dir, dist, ["--declaration"])
    for (const f of inCode.filter(f => !isSource(f))) {
      const to = path.join(dist, path.relative(dir, f))
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(f, to)
    }
    for (const f of walk(dist)) {
      if (f.endsWith(".js")) keepRunnable(f)
      // tsc rewrites .ts specifiers in the .js only; a consumer's TypeScript resolves a declaration's .js import
      else if (f.endsWith(".d.ts")) {
        const text = fs.readFileSync(f, "utf8")
        fs.writeFileSync(
          f,
          text.replace(/((?:from\s+|import\s+|import\(\s*)['"]\.\.?\/[\w./-]+)\.ts(['"])/g, "$1.js$2")
        )
      }
    }
  }
  if (skills.length) {
    const skillsDir = path.join(dir, "skills")
    const out = path.join(dist, "skills")
    tsc(skills, skillsDir, out)
    for (const f of walk(skillsDir).filter(f => !f.endsWith(".mts"))) {
      const to = path.join(out, path.relative(skillsDir, f))
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(f, to)
      fs.chmodSync(to, fs.statSync(f).mode)
    }
    for (const f of skills) keepRunnable(path.join(out, path.relative(skillsDir, f)).replace(/\.mts$/, ".mjs"))
  }
  return { code: code.length, skills: skills.length }
}

export function modulesToBuild(): string[] {
  if (!fs.existsSync(MODULES)) return []
  return fs
    .readdirSync(MODULES)
    .filter(m => !BROWSER_APPS.has(m) && fs.existsSync(path.join(MODULES, m, "package.json")))
    .sort()
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const picked = process.argv
    .slice(2)
    .filter(a => a.startsWith("--module="))
    .map(a => a.slice("--module=".length))
  for (const id of picked)
    if (!fs.existsSync(path.join(MODULES, id, "package.json"))) {
      console.error(`✖ no module ${id} under modules/`)
      process.exit(1)
    }
  let built = 0
  for (const id of picked.length ? picked : modulesToBuild()) {
    const r = buildModule(id)
    if (r.code || r.skills) built++
  }
  console.log(`✔ built ${built} module${built === 1 ? "" : "s"}`)
}
