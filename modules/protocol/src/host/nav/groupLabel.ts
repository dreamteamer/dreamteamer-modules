import { moduleLabel } from "./moduleLabel.ts"

export function groupLabel(key: string, titleOf: Map<string, string | undefined>, parentKey?: string): string {
  if (key.startsWith("ns:")) {
    const ns = key.slice(3)
    const authored = titleOf.get(ns)
    if (authored) return authored
    const parent = parentKey?.startsWith("ns:") ? parentKey.slice(3) : ""
    return moduleLabel(parent && ns.startsWith(parent + "/") ? ns.slice(parent.length + 1) : ns)
  }
  const id = key.slice(4)
  return moduleLabel(id, titleOf.get(id))
}
