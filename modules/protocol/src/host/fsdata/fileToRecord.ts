import * as path from "node:path"
import { acc, recordIdOf, recordTail, type Descriptor } from "../fsdata.ts"
import { collectionRoots } from "./collectionRoots.ts"

export function fileToRecord(
  root: string,
  descriptors: Descriptor[],
  fsPath: string
):
  | {
      d: Descriptor
      id: string
    }
  | undefined {
  const candidates = descriptors
    .flatMap(d => collectionRoots(root, d).map(({ dir }) => ({ d, dir })))
    .filter(({ dir }) => fsPath.startsWith(dir + path.sep))
    .sort((a, b) => b.dir.length - a.dir.length)
  for (const { d, dir } of candidates) {
    const rel = path.relative(dir, fsPath)
    const storage = acc().storageOf(d)
    if (storage.shape === "folder") {
      const entry = storage.entry ?? "SKILL.md"
      const segs = rel.split(path.sep)
      if (segs.length === 2 && segs[1] === entry) return { d, id: segs[0] }
      for (const child of placedUnder(descriptors, d)) {
        const pre = acc().storageOf(child).under.subfolder.split("/").join(path.sep) + path.sep
        const sub = segs.slice(1).join(path.sep)
        if (!sub.startsWith(pre)) continue
        const tail = recordTail(child)
        if (sub.endsWith(tail)) return { d: child, id: sub.slice(pre.length, -tail.length).split(path.sep).join("/") }
      }
      continue
    }
    const id = recordIdOf(rel, d)
    if (id !== undefined) return { d, id }
  }
  return undefined
}

function placedUnder(descriptors: Descriptor[], parent: Descriptor) {
  return descriptors.filter((c: Descriptor) => acc().storageOf(c).under?.collection === parent.name)
}
