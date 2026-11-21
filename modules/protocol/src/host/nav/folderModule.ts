import type { ModuleRecord } from "../fsdata.ts"

export function folderModule(
  folder: {
    key: string
    collections?: ReadonlyArray<{
      name: string
    }>
  },
  modules: ReadonlyArray<Pick<ModuleRecord, "id" | "namespaces" | "collections">>
): string | undefined {
  const has = (id: any) => (id && modules.some(m => m.id === id) ? id : undefined)
  if (folder.key.startsWith("mod:")) return has(folder.key.slice(4))
  if (folder.key.startsWith("ns:")) {
    const ns = folder.key.slice(3)
    return modules.find(m => m.namespaces?.includes(ns))?.id
  }
  if (folder.key.startsWith("grp:")) {
    const held = new Set((folder.collections ?? []).map(d => d.name))
    if (!held.size) return undefined
    return modules.find(m => {
      const ships = (m.collections ?? []).map(c => c.replace(/^collections\//, ""))
      return ships.length === held.size && ships.every(c => held.has(c))
    })?.id
  }
  return undefined
}
