import { engine } from "../engine.ts"
import type { NavFolder } from "../nav.ts"

export function compareChildren(a: NavFolder, b: NavFolder): number {
  const sa = a.key.startsWith("grp:"),
    sb = b.key.startsWith("grp:")
  if (sa !== sb) return sa ? -1 : 1
  if (sa) {
    const low = (f: any) =>
      Math.min(Infinity, ...f.collections.map((d: any) => engine().descriptor.displayOf(d).nav?.order ?? Infinity))
    const d = low(a) - low(b)
    if (d !== 0 && !Number.isNaN(d)) return d
  }
  return a.key.localeCompare(b.key)
}
