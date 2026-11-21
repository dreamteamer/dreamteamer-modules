import * as fs from "node:fs"
import * as path from "node:path"
import { acc, collectionDir, loadDescriptors, type Descriptor } from "../fsdata.ts"

export function recordRoots(root: string, d: Descriptor, descriptors?: Descriptor[]): string[] {
  const own = collectionDir(root, d)
  const under = acc().storageOf(d).under
  if (!under?.collection) return [own]
  const parent = (descriptors ?? loadDescriptors(root)).find(x => x.name === under.collection)
  if (!parent) return [own]
  const parentDir = collectionDir(root, parent)
  if (!fs.existsSync(parentDir)) return [own]
  const roots = [own]
  for (const e of fs.readdirSync(parentDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue
    roots.push(path.join(parentDir, e.name, ...under.subfolder.split("/")))
  }
  return roots
}
