import type { Descriptor } from "../fsdata.ts"
import { engine } from "../engine.ts"
import type { SourceEntry, SourceStackEntry, SourcesContext } from "../sources.ts"
import { collectionSources } from "./collectionSources.ts"

export function sourcesStack(
  root: string,
  descriptors: Descriptor[],
  ctx: SourcesContext
): {
  workspace: SourceStackEntry
  modules: SourceStackEntry[]
} {
  const workspace: SourceStackEntry = {
    name: ctx.workspace,
    kind: "own",
    repo: ".",
    installed: true,
    via: "own",
    access: "write",
    collections: [],
  }
  const modules = new Map<string, SourceStackEntry>()
  for (const d of descriptors) {
    if (engine().descriptor.isRuntime(d)) continue
    for (const s of collectionSources(root, d, ctx)) {
      const row = { collection: d.name, path: s.path, count: s.count }
      if (s.kind === "own") workspace.collections.push(row)
      else {
        const m =
          modules.get(s.name) ?? (modules.set(s.name, { ...stripCount(s), collections: [] }), modules.get(s.name))
        m.collections.push(row)
      }
    }
  }
  return { workspace, modules: [...modules.values()] }
}

function stripCount(s: SourceEntry): Omit<SourceEntry, "count" | "path"> {
  const { count: _c, path: _p, ...rest } = s
  return rest
}
