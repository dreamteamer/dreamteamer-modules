import type { Descriptor } from "../fsdata.ts"
import * as path from "node:path"
import type { SourceEntry } from "../sources.ts"

export function sourceOfFile(
  root: string,
  d: Descriptor,
  file: string,
  sources: SourceEntry[]
): SourceEntry | undefined {
  const target = path.resolve(file)
  let best
  for (const s of sources) {
    const dir = path.resolve(root, s.path)
    if (target !== dir && !target.startsWith(dir + path.sep)) continue
    if (!best || dir.length > path.resolve(root, best.path).length) best = s
  }
  return best
}
