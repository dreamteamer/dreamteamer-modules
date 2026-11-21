import * as fs from "node:fs"
import * as yaml from "js-yaml"
import * as path from "node:path"
import type { ModuleRecord } from "../fsdata.ts"
import { systemDir } from "./systemDir.ts"

export function loadModules(root: string): ModuleRecord[] {
  const dir = systemDir(root, "modules")
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".module.yaml")) continue
    try {
      const doc: any = yaml.load(fs.readFileSync(path.join(dir, f), "utf8"))
      out.push({ ...doc, id: f.replace(/\.module\.yaml$/, "") })
    } catch {}
  }
  return out
}
