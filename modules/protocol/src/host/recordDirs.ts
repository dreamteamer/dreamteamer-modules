import { engine } from "./engine.ts"
export function unreadableReason(d: any, descriptors: Map<string, any>): string | null {
  const seen = new Set<string>()
  for (let cur = d; cur && !seen.has(cur.name);) {
    seen.add(cur.name)
    const s = engine().descriptor.storageOf(cur)
    if (s.unavailable) return s.unavailable
    const parent = s.under?.collection
    cur = parent ? descriptors.get(parent) : undefined
  }
  return null
}
export function recordDirsOrNone(store: any, d: any): string[] {
  return unreadableReason(d, store.descriptors) ? [] : store.recordDirs(d)
}
