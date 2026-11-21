import * as fs from "node:fs"
import * as path from "node:path"
import { acc, recordIdOf, type Descriptor, type RecordEntry, walk } from "../fsdata.ts"
import { collectionRoots } from "./collectionRoots.ts"
import { parseRecord } from "./parseRecord.ts"
import { recordRoots } from "./recordRoots.ts"
import { walkIds } from "./walkIds.ts"

export function listRecords(root: string, d: Descriptor): RecordEntry[] {
  const storage = acc().storageOf(d)
  const out = []
  if (storage.under?.collection) {
    for (const r of recordRoots(root, d)) {
      if (!fs.existsSync(r)) continue
      for (const f of walk(r)) {
        const id = recordIdOf(path.relative(r, f), d)
        if (id !== undefined) out.push({ id, file: f, fields: parseRecord(f, d) })
      }
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }
  const seen = new Set()
  for (const { dir } of collectionRoots(root, d)) {
    for (const r of listRoot(dir, d)) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      out.push(r)
    }
  }
  return out
}

function listRoot(dir: string, d: Descriptor) {
  return [...walkIds(dir, d)].map(([id, file]) => ({ id, file, fields: parseRecord(file, d) }))
}
