import type { SourceEntry, SourceKind, SourcesContext } from "../sources.ts"
import { moduleSource } from "./moduleSource.ts"

export function runtimeSources(modules: Iterable<string | undefined>, ctx: SourcesContext): SourceEntry[] {
  const byName = new Map<string, SourceEntry>()
  for (const id of modules) {
    const s = moduleSource(id ? ctx.modules.find(m => m.id === id) : undefined, ctx)
    const entry = byName.get(s.name) ?? byName.set(s.name, { ...s, count: 0 }).get(s.name)
    entry.count++
  }
  const rank: Record<SourceKind, number> = { own: 0, module: 1 }
  return [...byName.values()].sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name))
}
