import type { NavDoc, NavTarget } from "../../navDoc.ts"
import type { NavNode } from "../../navModel.ts"
import { navViewsOf } from "../fsdata.ts"
import { viewRow } from "../fsdata/viewRow.ts"
import { PLAIN_FOLDER_ICON, navPathKey } from "../nav.ts"
import { moduleLabel } from "./moduleLabel.ts"
import { tailOrder } from "./tailOrder.ts"

const longestNamespace = (name: any, namespaces: any) => {
  let best = ""
  for (const ns of namespaces) if (name.startsWith(`${ns}/`) && ns.length > best.length) best = ns
  return best
}

/**
 * The tree nav.yaml describes, as nodes (design §3, rules 1-8). `doc` null draws the flat tree: every row by
 * title, then each namespace as a folder. Every folder, namespace and collection node carries `target`, the
 * NavTarget a host sends back in an op. No module marks and no module routes on folders.
 * @param {object} o
 * @param {Array<{ name: string }>} o.descriptors  the compiled collections
 * @param {object | null} o.doc  the NavDoc (normalised here)
 * @param {string[]} o.namespaces  the declared namespaces
 * @param {(d) => string} o.titleOf  a collection's title (the unplaced rows sort by it)
 * @param {Array} [o.views]  the workspace's ui-views; a collection's nav views draw under it (default node only)
 * @param {(ns: string, parentNs: string) => string} [o.namespaceTitle]  a namespace folder's label
 * @param {(d) => object} [o.nodeOf]  a collection's node (label, icon, route, count…); key and target are set here
 * @param {(name?: string) => string} [o.icon]  maps an authored icon name to the drawn one
 * @param {(d) => boolean} [o.internal]  a collection that stays out of the tree
 */
export function buildTree({
  descriptors,
  doc,
  namespaces = [],
  titleOf = (d: any) => d.title ?? d.name,
  views = [],
  namespaceTitle,
  nodeOf,
  icon = (n?: string) => n,
  internal = (d: any) => d.internal === true && !d.overlaid,
}: {
  descriptors: ReadonlyArray<{ name: string; title?: string; internal?: boolean; display?: any }>
  doc: NavDoc | null | undefined
  namespaces?: string[]
  titleOf?: (d: any) => string
  views?: any[]
  namespaceTitle?: (ns: string, parentNs: string) => string
  nodeOf?: (d: any) => Partial<NavNode>
  icon?: (name?: string) => string | undefined
  internal?: (d: any) => boolean
}): Array<NavNode & { target?: NavTarget }> {
  const usable = descriptors.filter(d => !internal(d))
  const byName = new Map(usable.map(d => [d.name, d]))
  const tree = Array.isArray(doc?.tree) ? doc.tree : []
  const hidden = new Set(Array.isArray(doc?.hidden) ? doc.hidden.filter(h => typeof h === "string") : [])
  const nsTitle =
    namespaceTitle ??
    ((ns, parent) => moduleLabel(parent && ns.startsWith(parent + "/") ? ns.slice(parent.length + 1) : ns))
  const parentNs = (ns: any) =>
    longestNamespace(
      ns,
      namespaces.filter(n => n !== ns)
    )
  const collectionName = (e: any) =>
    typeof e === "string"
      ? e
      : e && typeof e === "object" && typeof e.collection === "string"
        ? e.collection
        : undefined
  const isFolder = (e: any) => e && typeof e === "object" && typeof e.folder === "string"
  const isNamespace = (e: any) => e && typeof e === "object" && typeof e.namespace === "string"
  // the first occurrence of every name in document order: the one entry that draws it (rule 5). Held by POSITION
  // (the items array and the index in it), never by the entry: two plain-string entries `tasks` are equal, so an
  // identity test would let both draw
  const first = new Map()
  const placed = new Set(hidden)
  const isFirst = (id: any, items: any, i: any) => {
    const f = first.get(id)
    return f !== undefined && f.items === items && f.i === i
  }
  const scan = (items: any) => {
    for (const [i, e] of (Array.isArray(items) ? items : []).entries()) {
      const c = collectionName(e)
      const id = c !== undefined ? `c:${c}` : isNamespace(e) ? `n:${e.namespace}` : undefined
      if (id && !first.has(id)) first.set(id, { items, i })
      if (c !== undefined) placed.add(c)
      if (isNamespace(e)) placed.add(`ns:${e.namespace}`)
      if (isFolder(e) || isNamespace(e)) scan(e.items)
    }
  }
  scan(tree)
  const order = [...tailOrder(usable, titleOf)]
  const used = new Map()
  const uniqueKey = (key: any) => {
    const n = (used.get(key) ?? 0) + 1
    used.set(key, n)
    return n === 1 ? key : `${key}~${n}`
  }
  const defaultNode = (d: any) => {
    const kids = navViewsOf(views, d.name).map(v => {
      const r = viewRow(v)
      return {
        kind: "view",
        key: `v/${v.id}`,
        label: r.label,
        icon: icon(r.icon),
        ...(r.description ? { description: r.description } : {}),
        tooltip: r.tooltip,
        ...(v.route ? { route: v.route } : {}),
      }
    })
    return {
      kind: "collection",
      label: String(titleOf(d) ?? d.name),
      icon: icon(d.display?.nav?.icon),
      ...(kids.length ? { children: kids } : {}),
    }
  }
  const collectionNode = (d: any, entryIcon?: any) => {
    const node: NavNode & { target?: NavTarget } = { ...(nodeOf ? nodeOf(d) : defaultNode(d)) } as NavNode
    node.kind = "collection"
    node.key = uniqueKey(`c/${d.name}`)
    node.target = { name: d.name }
    if (entryIcon) node.icon = icon(entryIcon)
    return node
  }
  const namespaceNode = (ns: string, path: string[], entry?: any): any => {
    const p = [...path, `ns:${ns}`]
    return {
      kind: "namespace",
      key: uniqueKey(navPathKey("n", p)),
      label: nsTitle(ns, parentNs(ns)),
      icon: icon(entry?.icon ?? PLAIN_FOLDER_ICON),
      target: { name: ns },
      children: [...drawItems(entry?.items, p), ...tailsOf(ns, p)],
    }
  }
  /** What a level draws after its entries: its unplaced rows by title, then its unplaced namespaces by label. */
  const tailsOf = (ns: string, path: string[]): any[] => {
    const rows = order
      .filter(n => !placed.has(n) && longestNamespace(n, namespaces) === ns)
      .map(n => collectionNode(byName.get(n)))
    const nested = namespaces
      .filter(n => !placed.has(`ns:${n}`) && !hidden.has(n) && parentNs(n) === ns)
      .map(n => ({ n, label: nsTitle(n, parentNs(n)) }))
      .sort((a, b) => a.label.localeCompare(b.label, "en") || a.n.localeCompare(b.n, "en"))
      .map(({ n }) => namespaceNode(n, path))
    return [...rows, ...nested]
  }
  function drawItems(items: unknown, path: string[]): any[] {
    const out: any[] = []
    for (const [i, e] of (Array.isArray(items) ? items : []).entries()) {
      const c = collectionName(e)
      if (c !== undefined) {
        if (!isFirst(`c:${c}`, items, i) || hidden.has(c) || !byName.has(c)) continue
        out.push(collectionNode(byName.get(c), typeof e === "object" ? e.icon : undefined))
      } else if (isFolder(e)) {
        if (e.hidden === true) continue
        const p = [...path, e.folder]
        out.push({
          kind: "folder",
          key: uniqueKey(navPathKey("f", p)),
          label: e.folder,
          icon: icon(e.icon ?? PLAIN_FOLDER_ICON),
          target: { folder: p },
          children: drawItems(e.items, p),
        })
      } else if (isNamespace(e)) {
        if (!isFirst(`n:${e.namespace}`, items, i) || e.hidden === true || hidden.has(e.namespace)) continue
        out.push(namespaceNode(e.namespace, path, e))
      }
    }
    return out
  }
  return [...drawItems(tree, []), ...tailsOf("", [])]
}
