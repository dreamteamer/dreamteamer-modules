// The modules whose package.json version npm does not have yet — what release-unreleased.yml publishes.
//
//   node scripts/unreleased.ts                     every module, as JSON on stdout
//   node scripts/unreleased.ts --modules web,ui    only these, each one checked
//
// A version npm answers E404 for is unreleased; any other npm failure stops the plan, because a registry
// that did not answer is not a registry that said no.
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

export interface Planned {
  id: string
  name: string
  version: string
}

/** Whether npm holds `name@version`: true, false on E404, and a throw on anything else. */
export type Lookup = (name: string, version: string) => boolean

export function npmHas(name: string, version: string): boolean {
  try {
    return (
      execFileSync("npm", ["view", `${name}@${version}`, "version"], { encoding: "utf8", stdio: "pipe" }).trim() ===
      version
    )
  } catch (e) {
    const out = `${(e as { stdout?: string }).stdout ?? ""}${(e as { stderr?: string }).stderr ?? ""}`
    if (/E404|is not in this registry/.test(out)) return false
    throw new Error(`npm view ${name}@${version} failed: ${out.trim().split("\n").at(-1) ?? "no output"}`)
  }
}

/** Every module under `root/modules`, or the named ones, whose version `has` says npm does not hold. */
export function unreleased(root: string, has: Lookup, only?: string[]): Planned[] {
  const all = fs
    .readdirSync(path.join(root, "modules"))
    .filter(id => fs.existsSync(path.join(root, "modules", id, "package.json")))
    .sort()
  const unknown = (only ?? []).filter(id => !all.includes(id))
  if (unknown.length) throw new Error(`no such module: ${unknown.join(", ")}`)
  const out: Planned[] = []
  for (const id of only?.length ? all.filter(m => only.includes(m)) : all) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "modules", id, "package.json"), "utf8"))
    if (pkg.private) continue
    if (!has(pkg.name, pkg.version)) out.push({ id, name: pkg.name, version: pkg.version })
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--modules")
  const only =
    at < 0
      ? undefined
      : (process.argv[at + 1] ?? "")
          .split(/[\s,]+/)
          .map(s => s.trim())
          .filter(Boolean)
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const plan = unreleased(root, npmHas, only)
  for (const m of plan) console.error(`to release: ${m.name}@${m.version}`)
  if (!plan.length) console.error("nothing to release: npm holds every version")
  console.log(JSON.stringify(plan))
}
