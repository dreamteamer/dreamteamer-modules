import * as path from "node:path"
import * as fs from "node:fs"

export function engineRoot(root: string): string {
  const found = path.join(root, "node_modules", "dreamteamer")
  if (fs.existsSync(path.join(found, "package.json"))) return found
  throw new Error("no dreamteamer engine in this workspace — looked in node_modules/dreamteamer (run: npm install)")
}
