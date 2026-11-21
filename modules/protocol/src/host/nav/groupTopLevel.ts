import type { Descriptor } from "../fsdata.ts"
import { isRuntime } from "../fsdata.ts"
import { engine } from "../engine.ts"
import { shouldFoldOutOfRecordTree, type NavFolder } from "../nav.ts"
import { compareChildren } from "./compareChildren.ts"
import { foldSameLabel } from "./foldSameLabel.ts"
import { groupLabel } from "./groupLabel.ts"

export function groupTopLevel(
  descriptors: Descriptor[],
  declared: string[],
  workspaceModule?: string,
  dependsOn?: Map<string, string[]>,
  navGroups?: Map<string, string[]>,
  namespacesOf?: Map<string, string[]>,
  titleOf: Map<string, string | undefined> = new Map()
): {
  top: Descriptor[]
  folders: NavFolder[]
} {
  const byLength = [...declared].sort((a, b) => b.length - a.length)
  const namespaceOf = (name: any) => byLength.find(ns => name.startsWith(ns + "/")) ?? ""
  const foldModuleOf = (d: any) => {
    if (!workspaceModule || namespaceOf(d.name)) return undefined
    const id = isRuntime(d) ? engine().descriptor.overlaidByOf(d)[0] : engine().descriptor.moduleOf(d)
    return id && id !== workspaceModule ? id : undefined
  }
  const perModule = new Map()
  for (const d of descriptors) {
    const id = foldModuleOf(d)
    if (id) perModule.set(id, (perModule.get(id) ?? 0) + 1)
  }
  const folds = (id: any) => (perModule.get(id) ?? 0) >= 2
  const hostModuleOf = (id: any) => {
    if (folds(id)) return id
    for (const ref of dependsOn?.get(id) ?? []) {
      const dep = ref.replace(/^modules\//, "")
      if (dep !== id && folds(dep)) return dep
    }
    return undefined
  }
  const groupOfModule = new Map()
  for (const [key, ids] of navGroups ?? []) for (const id of ids) groupOfModule.set(id, key)
  const homeNamespaceOf = (id: any) => {
    const own = (namespacesOf?.get(id) ?? []).filter(ns => declared.includes(ns))
    if (own.includes(id)) return id
    const roots = own.filter(ns => !own.some(o => ns.startsWith(o + "/")))
    return roots.length === 1 ? roots[0] : undefined
  }
  const folderKeyOf = (mod: any) => {
    const host = hostModuleOf(mod)
    const group = groupOfModule.get(mod) ?? (host ? groupOfModule.get(host) : undefined)
    if (group) return `grp:${group}`
    if (!host) return undefined
    const home = homeNamespaceOf(host)
    return home ? `ns:${home}` : `mod:${host}`
  }
  const top = []
  const byKey = new Map()
  const folder = (key: any) => {
    let f = byKey.get(key)
    if (!f) byKey.set(key, (f = { key, collections: [], children: [] }))
    return f
  }
  for (const d of descriptors) {
    if (shouldFoldOutOfRecordTree(d)) continue
    const section = engine().descriptor.displayOf(d).nav?.section
    if (typeof section === "string" && section.trim()) {
      folder(`grp:${section.trim()}`).collections.push(d)
      continue
    }
    const ns = namespaceOf(d.name)
    if (ns) {
      folder(`ns:${ns}`).collections.push(d)
      continue
    }
    const mod = foldModuleOf(d)
    const key = mod ? folderKeyOf(mod) : undefined
    if (key) {
      folder(key).collections.push(d)
      continue
    }
    top.push(d)
  }
  for (const key of [...byKey.keys()]) {
    if (!key.startsWith("ns:")) continue
    for (let parent = namespaceOf(key.slice(3)); parent; parent = namespaceOf(parent)) folder(`ns:${parent}`)
  }
  const homeOf = (d: any) => {
    const ns = namespaceOf(d.name)
    if (ns) return `ns:${ns}`
    const owner = foldModuleOf(d)
    if (!owner) return undefined
    const folded = folderKeyOf(owner)
    if (folded) return folded
    const home = homeNamespaceOf(owner)
    return home ? `ns:${home}` : undefined
  }
  const sectionParent = new Map()
  for (const [key, f] of [...byKey]) {
    if (!key.startsWith("grp:")) continue
    const homes = new Set<any>(f.collections.map(homeOf))
    const [home] = homes
    if (homes.size !== 1 || !home) continue
    if (home.startsWith("mod:") && byKey.has(home)) sectionParent.set(key, home)
    else if (home.startsWith("ns:") && (byKey.has(home) || f.collections.some((d: any) => namespaceOf(d.name)))) {
      folder(home)
      for (let parent = namespaceOf(home.slice(3)); parent; parent = namespaceOf(parent)) folder(`ns:${parent}`)
      sectionParent.set(key, home)
    }
  }
  const labelUnder = (key: any, parentKey: any) => groupLabel(key, titleOf, parentKey).trim().toLowerCase()
  const parentKeyOf = (key: any) => {
    const ns = key.startsWith("ns:") ? namespaceOf(key.slice(3)) : ""
    return ns ? `ns:${ns}` : undefined
  }
  for (const [key, home] of [...sectionParent]) {
    if (labelUnder(key, home) !== labelUnder(home, parentKeyOf(home))) continue
    byKey.get(home).collections.push(...byKey.get(key).collections)
    byKey.delete(key)
    sectionParent.delete(key)
  }
  const sorted = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key))
  const roots = []
  for (const f of sorted) {
    const parent = f.key.startsWith("ns:") ? namespaceOf(f.key.slice(3)) : ""
    if (parent) byKey.get(`ns:${parent}`).children.push(f)
    else if (sectionParent.has(f.key)) byKey.get(sectionParent.get(f.key)).children.push(f)
    else roots.push(f)
  }
  for (const f of byKey.values()) f.children.sort(compareChildren)
  return { top, folders: foldSameLabel(roots, titleOf) }
}
