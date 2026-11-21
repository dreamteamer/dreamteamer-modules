import * as fs from "node:fs"
import * as path from "node:path"
import { acc, recordIdOf, type Descriptor, walk } from "../fsdata.ts"

export function walkIds(dir: string, d: Descriptor): Map<string, string> {
  const out = new Map()
  if (!fs.existsSync(dir)) return out
  const storage = acc().storageOf(d)
  if (storage.shape === "folder") {
    for (const e of fs.readdirSync(dir).sort()) {
      if (e.startsWith(".")) continue
      const main = path.join(dir, e, storage.entry ?? "SKILL.md")
      if (fs.existsSync(main)) out.set(e, main)
    }
    return out
  }
  for (const f of walk(dir)) {
    const id = recordIdOf(path.relative(dir, f), d)
    if (id !== undefined) out.set(id, f)
  }
  return out
}
