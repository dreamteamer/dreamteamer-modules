import type { ModuleRecord } from "../fsdata.ts"

export function moduleOfSource(
  source: string,
  modules: ReadonlyArray<Pick<ModuleRecord, "id" | "path">>
): string | undefined {
  let best
  for (const m of modules) {
    const root = m.path?.replace(/\/+$/, "")
    if (!root || (source !== root && !source.startsWith(root + "/"))) continue
    if (!best || root.length > best.len) best = { id: m.id, len: root.length }
  }
  return best?.id
}
