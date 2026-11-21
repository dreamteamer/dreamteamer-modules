import type { Descriptor } from "../fsdata.ts"
import type { SourceEntry } from "../sources.ts"
import { engine } from "../engine.ts"
import { describeSources } from "../sources/describeSources.ts"

export function collectionRow(d: Descriptor, sources?: SourceEntry[]): Record<string, any> {
  const { titleOf, displayOf, storageOf } = engine().descriptor
  const count = sources ? sources.reduce((n, s) => n + (s.installed ? s.count : 0), 0) : undefined
  const row = {
    label: titleOf(d),
    icon: displayOf(d).nav?.icon,
    tooltip: storageOf(d).path,
    ...(count !== undefined ? { count } : {}),
  }
  if (!sources?.some(s => s.kind !== "own")) return row
  const { description, detail } = describeSources(sources)
  const shared = sources.some(s => s.kind !== "own" && s.count > 0)
  const head = shared ? `Shared · ${description}` : description
  const tooltip = [...(head ? [head] : []), storageOf(d).path, "", ...detail].join("\n")
  return { ...row, tooltip, ...(shared ? { shared: true } : {}) }
}
