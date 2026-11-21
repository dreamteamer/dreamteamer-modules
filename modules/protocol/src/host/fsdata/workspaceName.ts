import * as fs from "node:fs"
import * as path from "node:path"

export function workspaceName(root: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    const v = pkg?.name
    return typeof v === "string" && v ? v : path.basename(root)
  } catch {
    return path.basename(root)
  }
}
