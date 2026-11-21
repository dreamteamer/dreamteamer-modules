import * as path from "node:path"
import * as fs from "node:fs"
import { acc, recordTail, type Descriptor } from "../fsdata.ts"
import { recordRoots } from "./recordRoots.ts"

export function recordFileFor(root: string, d: Descriptor, id: string, descriptors?: Descriptor[]): string | undefined {
  const storage = acc().storageOf(d)
  const name = storage.shape === "folder" ? path.join(id, storage.entry ?? "SKILL.md") : `${id}${recordTail(d)}`
  for (const dir of recordRoots(root, d, descriptors)) {
    const file = path.join(dir, name)
    if (fs.existsSync(file)) return file
  }
  return undefined
}
