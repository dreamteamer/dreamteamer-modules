import * as fs from "node:fs"
import * as path from "node:path"

export function isInstalledPackage(rel: string, root?: string): boolean {
  if (!rel.split("/").includes("node_modules")) return false
  if (!root) return true
  try {
    return fs.realpathSync(path.join(root, rel)).split(path.sep).includes("node_modules")
  } catch {
    return true
  }
}
