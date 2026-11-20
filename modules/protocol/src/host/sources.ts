// Ported from the dreamteamer VS Code extension's host side (src/sources.ts); PROTOCOL.md is the contract it answers.
import * as fs from "node:fs"
import * as path from "node:path"
import { engine } from "./engine.ts"
import { collectionRoots, listRecords, loadModules, walkIds, workspaceName } from "./fsdata.ts"

import type { CollectionRoot, Descriptor, ModuleRecord } from "./fsdata.ts"

export type SourceKind = "own" | "module"
export type SourceVia = "own" | "clone" | "package"
export type SourceAccess = "write" | "edit" | "read"
export interface SourceEntry {
  name: string
  kind: SourceKind
  repo: string
  path: string
  installed: boolean
  count: number
  via: SourceVia
  access: SourceAccess
  note?: string
}
export interface SourcesContext {
  root?: string
  workspace: string
  modules: ModuleRecord[]
}
export interface SourceStackEntry extends Omit<SourceEntry, "count" | "path"> {
  collections: Array<{
    collection: string
    path: string
    count: number
  }>
}
export function sourcesContext(root: string): SourcesContext {
  return { root, workspace: workspaceName(root), modules: loadModules(root) }
}
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
export function isInstalledPackage(rel: string, root?: string): boolean {
  if (!rel.split("/").includes("node_modules")) return false
  if (!root) return true
  try {
    return fs.realpathSync(path.join(root, rel)).split(path.sep).includes("node_modules")
  } catch {
    return true
  }
}
function moduleFolderAccess(
  id: string,
  rel: string,
  root: string | undefined
): { via: SourceVia; access: SourceAccess; note?: string } {
  return isInstalledPackage(rel, root)
    ? {
        via: "package",
        access: "read",
        note: `${id} is an installed package — nothing is written to it from this workspace; change it in the package's own repo`,
      }
    : { via: "clone", access: "write" }
}
export function moduleSource(
  mod: Pick<ModuleRecord, "id" | "path"> | undefined,
  ctx: SourcesContext
): Omit<SourceEntry, "count"> {
  const p = mod?.path?.replace(/\/+$/, "") ?? ""
  if (!mod || !p.split("/").includes("node_modules"))
    return { name: ctx.workspace, kind: "own", repo: ".", path: p || ".", installed: true, via: "own", access: "write" }
  return {
    name: mod.id,
    kind: "module",
    repo: ".",
    path: p,
    installed: true,
    ...moduleFolderAccess(mod.id, p, ctx.root),
  }
}
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
export function describeSources(sources: SourceEntry[]): {
  description?: string
  detail: string[]
} {
  const foreign = sources.filter(s => s.kind !== "own")
  const holding = foreign.filter(s => s.count > 0)
  const absent = foreign.filter(s => !s.installed)
  const parts = []
  if (holding.length === 1) parts.push(`from ${holding[0].name}`)
  else if (holding.length > 1) parts.push(`from ${holding.length} sources`)
  for (const s of absent) parts.push(`${s.name} not installed`)
  const detail = sources.map(s =>
    s.installed
      ? `${s.name} (${s.kind}) — ${s.count} record${s.count === 1 ? "" : "s"}`
      : `${s.name} (${s.kind}) — not installed`
  )
  return { ...(parts.length ? { description: parts.join(" · ") } : {}), detail }
}
export function withoutSourceClauses(filter: unknown): unknown {
  const isSource = (c: unknown) =>
    !!c && typeof c === "object" && !Array.isArray(c) && Object.keys(c).length === 1 && "$source" in c
  if (isSource(filter)) return undefined
  if (
    filter &&
    typeof filter === "object" &&
    !Array.isArray(filter) &&
    Array.isArray((filter as Record<string, unknown>)._and) &&
    Object.keys(filter).length === 1
  ) {
    const rest = ((filter as Record<string, unknown>)._and as unknown[]).filter(c => !isSource(c))
    return rest.length === 0 ? undefined : rest.length === 1 ? rest[0] : { _and: rest }
  }
  return filter
}
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
