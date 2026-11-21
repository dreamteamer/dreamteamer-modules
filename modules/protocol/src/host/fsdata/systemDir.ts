import * as path from "node:path"
import * as fs from "node:fs"

export function systemDir(root: string, kind: string): string {
  const flat = path.join(root, ".dreamteamer", kind)
  if (fs.existsSync(flat)) return flat
  const nested = path.join(root, ".dreamteamer", "system", kind)
  return fs.existsSync(nested) ? nested : flat
}
