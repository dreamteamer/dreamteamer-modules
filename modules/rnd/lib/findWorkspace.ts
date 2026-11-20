// The workspace root: the nearest ancestor with package.json AND package-lock.json — a module folder carries
// package.json too. Each module carries its own copy, because a module never imports another module's code.
import fs from "node:fs"
import path from "node:path"

export function findWorkspace(from = process.cwd()) {
  for (let d = path.resolve(from); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, "package.json")) && fs.existsSync(path.join(d, "package-lock.json"))) return d
    if (path.dirname(d) === d) return null
  }
}
