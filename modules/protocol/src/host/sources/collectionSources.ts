import type { Descriptor, ModuleRecord, CollectionRoot } from "../fsdata.ts"
import { engine } from "../engine.ts"
import * as path from "node:path"
import { walkIds } from "../fsdata/walkIds.ts"
import { listRecords } from "../fsdata/listRecords.ts"
import { collectionRoots } from "../fsdata/collectionRoots.ts"
import * as fs from "node:fs"
import { moduleFolderAccess, type SourceEntry, type SourcesContext } from "../sources.ts"

function owningModule(
  root: string,
  d: Descriptor,
  write: { dir: string; repo: string },
  ctx: SourcesContext
): ModuleRecord | undefined {
  const id = engine().descriptor.moduleOf(d)
  if (!id) return undefined
  const mod = ctx.modules.find(m => m.id === id)
  const rel = path.relative(root, write.dir).split(path.sep).join("/")
  if (mod?.path && mod.path !== "." && (rel === mod.path || rel.startsWith(mod.path + "/"))) return mod
  return undefined
}

export function collectionSources(root: string, d: Descriptor, ctx: SourcesContext): SourceEntry[] {
  const roots = collectionRoots(root, d)
  const counts = countsByRoot(root, d, roots)
  return roots.map((r, i): SourceEntry => {
    const rel = path.relative(root, r.dir).split(path.sep).join("/")
    const mod = owningModule(root, d, r, ctx)
    if (mod)
      return {
        name: mod.id,
        kind: "module",
        repo: r.repo,
        path: rel,
        installed: fs.existsSync(r.dir) || r.repo === ".",
        count: counts[i] ?? 0,
        ...moduleFolderAccess(mod.id, mod.path ?? rel, root),
      }
    return {
      name: ctx.workspace,
      kind: "own",
      repo: r.repo,
      path: rel,
      installed: true,
      count: counts[i] ?? 0,
      via: "own",
      access: "write",
    }
  })
}

function countsByRoot(root: string, d: Descriptor, roots: CollectionRoot[]): number[] {
  if (engine().descriptor.storageOf(d).under?.collection) return [listRecords(root, d).length]
  const seen = new Set<string>()
  return roots.map(r => {
    let n = 0
    for (const id of walkIds(r.dir, d).keys()) {
      if (seen.has(id)) continue
      seen.add(id)
      n++
    }
    return n
  })
}
