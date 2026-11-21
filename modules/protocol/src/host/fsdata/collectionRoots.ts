import * as path from "node:path"
import { acc, isRuntime, type CollectionRoot, type Descriptor } from "../fsdata.ts"

export function collectionRoots(root: string, d: Descriptor): CollectionRoot[] {
  const s = acc().storageOf(d)
  const base = isRuntime(d) ? path.join(root, ".dreamteamer") : root
  return [{ dir: path.resolve(base, s.path), repo: s.repo ?? "." }]
}
