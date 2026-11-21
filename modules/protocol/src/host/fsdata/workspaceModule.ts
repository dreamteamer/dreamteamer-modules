import * as fs from "node:fs"
import * as path from "node:path"

export function workspaceModule(root: string): string | undefined {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    const v = pkg?.dreamteamer?.workspace_module
    return typeof v === "string" && v ? v : undefined
  } catch {
    return undefined
  }
}
