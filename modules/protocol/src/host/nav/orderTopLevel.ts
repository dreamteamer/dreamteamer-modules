import type { Descriptor } from "../fsdata.ts"
import type { NavFolder } from "../nav.ts"
import { navKey } from "./navKey.ts"

export function orderTopLevel(top: Descriptor[], folders: NavFolder[], navOrder?: string[]): any[] {
  if (!navOrder?.length) {
    return [
      ...top.map(d => ({ kind: "collection", descriptor: d })),
      ...folders.map(f => ({ kind: "folder", folder: f })),
    ]
  }
  const folderNames = new Set()
  const collect = (f: any) => {
    folderNames.add(navKey({ kind: "folder", folder: f }))
    f.children.forEach(collect)
  }
  folders.forEach(collect)
  const named = new Set(navOrder.filter(n => !folderNames.has(n)))
  const lifted: any = []
  const prune = (f: any) => {
    const keep: any = []
    for (const d of f.collections) (named.has(d.name) ? lifted : keep).push(d)
    const children = f.children.map(prune).filter((c: any) => c !== null)
    const untouched =
      keep.length === f.collections.length &&
      children.length === f.children.length &&
      children.every((c: any, i: any) => c === f.children[i])
    if (untouched) return f
    return keep.length || children.length ? { key: f.key, collections: keep, children } : null
  }
  const remaining = folders.map(prune).filter(f => f !== null)
  const entries = [
    ...top.map(d => ({ kind: "collection", descriptor: d })),
    ...lifted.map((d: any) => ({ kind: "collection", descriptor: d })),
    ...remaining.map(f => ({ kind: "folder", folder: f })),
  ]
  const rank = new Map<any, number>(navOrder.map((n, i) => [n, i]))
  return entries
    .map((e, i) => ({ e, i, r: rank.get(navKey(e)) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(({ e }) => e)
}
