import * as path from "node:path"
import type { Descriptor } from "../fsdata.ts"
import { collectionRoots } from "./collectionRoots.ts"

export function repoOfPath(root: string, descriptors: Iterable<Descriptor>, abs: string): string {
  const target = path.resolve(abs)
  let best
  for (const d of descriptors) {
    for (const r of collectionRoots(root, d)) {
      const dir = path.resolve(r.dir)
      if (target !== dir && !target.startsWith(dir + path.sep)) continue
      if (!best || dir.length > path.resolve(best.dir).length) best = r
    }
  }
  return best?.repo ?? "."
}
