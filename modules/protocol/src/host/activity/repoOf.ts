import * as fs from "node:fs"
import * as path from "node:path"

export function repoOf(root: string, rel: string): string {
  let dir = rel.replace(/\/+$/, "")
  while (dir && dir !== ".") {
    if (fs.existsSync(path.join(root, dir, ".git"))) return dir
    const up = path.posix.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return "."
}
