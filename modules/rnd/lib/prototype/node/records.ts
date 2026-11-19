// The records the bridge reads — one `dt list <collection> --json` call and one
// `dt get collections/<collection> --json` call per collection (the five the design names, plus rnd/products so a
// config product that is no record is caught), run in the workspace. Nothing here parses a record file.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

export const COLLECTIONS = {
  screens: "rnd/screens",
  journeys: "rnd/user-journeys",
  stories: "rnd/user-stories",
  personas: "rnd/personas",
  questions: "rnd/open-questions",
  products: "rnd/products",
}

/** The default runner: the workspace's own engine (its installed bin, else `npx --no-install`), never one
 *  fetched from the network. */
export function dtRunner(workspace: string) {
  const bin = path.join(workspace, "node_modules", "dreamteamer", "bin", "dreamteamer.js")
  const [cmd, pre] = fs.existsSync(bin) ? [process.execPath, [bin]] : ["npx", ["--no-install", "dreamteamer"]]
  return (args: string[]): string => {
    const r = spawnSync(cmd, [...pre, ...args], { cwd: workspace, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    if (r.status !== 0)
      throw new Error(
        `dreamteamer ${args.join(" ")} exited ${r.status}: ${(r.stderr || r.stdout || "").trim().split("\n").slice(0, 4).join(" | ")}`
      )
    return r.stdout
  }
}

const parse = (args: string[], out: string) => {
  try {
    return JSON.parse(out)
  } catch {
    throw new Error(`dreamteamer ${args.join(" ")} did not print JSON`)
  }
}

/** Read the five collections and their descriptors. A collection marked sensitive is refused; every field a
 *  descriptor marks sensitive is dropped from its rows before anything else sees them. */
/** One record row as `dt list --json` prints it, less its sensitive fields. */
export type Row = Record<string, any>

/** The five collections' rows, with what each descriptor declares and what was dropped as sensitive. */
export interface Records {
  screens: Row[]
  stories: Row[]
  personas: Row[]
  questions: Row[]
  journeys: Row[]
  products?: Row[]
  descriptors: Record<string, { fields: string[]; sensitive: string[] }>
  dropped: Record<string, string[]>
  [name: string]: unknown
}

export function readRecords(config: Record<string, any>, { dt = dtRunner(config.workspace) } = {}): Records {
  const out: Records = { descriptors: {}, dropped: {} } as Records
  for (const [name, collection] of Object.entries(COLLECTIONS)) {
    const dargs = ["get", `collections/${collection}`, "--json"]
    const d = parse(dargs, dt(dargs))
    if (d.sensitive === true) throw new Error(`${collection} is marked sensitive — the harness exports nothing from it`)
    const sensitive = Object.entries<any>(d.fields ?? {})
      .filter(([, f]) => f?.sensitive === true)
      .map(([k]) => k)
    out.descriptors[name] = { fields: Object.keys(d.fields ?? {}), sensitive }
    out.dropped[name] = sensitive
    const largs = ["list", collection, "--json"]
    const rows = parse(largs, dt(largs))
    out[name] = rows.map((r: Record<string, unknown>) => {
      const x = { ...r }
      for (const k of sensitive) delete x[k]
      return x
    })
  }
  return out
}
