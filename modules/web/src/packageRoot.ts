// The package this file ships in: the nearest folder above it with a package.json. The same answer from the
// source (src/x.ts) and from the build (dist/src/x.js), which sits one folder deeper.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export function packageRoot(metaUrl: string): string {
  let dir = path.dirname(fileURLToPath(metaUrl))
  while (!fs.existsSync(path.join(dir, "package.json"))) {
    const up = path.dirname(dir)
    if (up === dir) throw new Error(`no package.json above ${fileURLToPath(metaUrl)}`)
    dir = up
  }
  return dir
}
