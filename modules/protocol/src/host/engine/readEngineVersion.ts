import * as fs from "node:fs"
import * as path from "node:path"

export function readEngineVersion(engineDir: string): string | null {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(engineDir, "package.json"), "utf8")).version
    return typeof v === "string" ? v : null
  } catch {
    return null
  }
}
