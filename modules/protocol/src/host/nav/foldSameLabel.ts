import type { NavFolder } from "../nav.ts"
import { compareChildren } from "./compareChildren.ts"
import { groupLabel } from "./groupLabel.ts"

const FOLD_RANK = ["ns:", "mod:", "grp:"]

const foldRank = (key: any) => {
  const i = FOLD_RANK.findIndex(p => key.startsWith(p))
  return i < 0 ? FOLD_RANK.length : i
}

export function foldSameLabel(
  folders: NavFolder[],
  titleOf: Map<string, string | undefined>,
  parentKey?: string
): NavFolder[] {
  const labelOf = (f: any) => groupLabel(f.key, titleOf, parentKey).trim().toLowerCase()
  const byLabel = new Map()
  for (const f of folders) byLabel.set(labelOf(f), [...(byLabel.get(labelOf(f)) ?? []), f])
  const out = []
  for (const f of folders) {
    const [keep, ...rest] = [...byLabel.get(labelOf(f))].sort(
      (a, b) => foldRank(a.key) - foldRank(b.key) || a.key.localeCompare(b.key)
    )
    if (keep !== f) continue
    const children = rest.length
      ? [...keep.children, ...rest.flatMap(r => r.children)].sort(compareChildren)
      : keep.children
    out.push({
      key: keep.key,
      collections: rest.length ? [...keep.collections, ...rest.flatMap(r => r.collections)] : keep.collections,
      children: foldSameLabel(children, titleOf, keep.key),
    })
  }
  return out
}
