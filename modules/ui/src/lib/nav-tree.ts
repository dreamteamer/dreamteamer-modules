/**
 * WHAT A NAV GESTURE MEANS (cr-dt-008): the nav is `nav.yaml`, arranged by hand, and every drop and every row-menu
 * entry is ONE NavOp sent as `PATCH /nav`, built from the nodes' own `target`s — a key is never decoded. This file
 * is the decision, pure, so it is tested without a DOM; components/Nav.tsx only turns DOM events into these calls.
 * Ported from the Vue ui's components/NavSidebar.vue (dropOp, tailOp, the row menu) and NavRow.ts (dropWhere).
 *
 * Layers keep their own nav: a drop onto a layer row or the layers folder means nothing, and their rows have no menu.
 * A view row is not arranged: a drop on it is a drop after its collection.
 */

/** What an op addresses (copied from @dreamteamer/protocol `nav-doc.d.ts` — ui takes no protocol dependency).
 *  `name` is a collection or a namespace as nav.yaml writes it; `folder` is the label path from the top level, a
 *  namespace entry being the element `ns:<name>`. */
export type NavTarget = { name: string } | { folder: string[] }

/** One gesture — the body of `PATCH /nav` (copied from @dreamteamer/protocol `nav-doc.d.ts`). */
export type NavOp =
  | { op: "move"; target: NavTarget; into?: NavTarget; after?: NavTarget; position?: "top" | "bottom" }
  | { op: "new-folder"; label: string; into?: NavTarget }
  | { op: "rename"; target: { folder: string[] }; label: string }
  | { op: "dissolve"; target: { folder: string[] } }
  | { op: "icon"; target: NavTarget; icon: string | null }
  | { op: "hide"; target: NavTarget }
  | { op: "show"; target: NavTarget }

/** One node of `GET /nav` (PROTOCOL.md). */
export interface NavNode {
  kind: "workspace" | "collection" | "namespace" | "view" | "folder" | string
  key: string
  label: string
  icon?: string
  route?: string
  tooltip?: string
  description?: string
  marks?: string
  notice?: string
  target?: NavTarget
  children?: NavNode[]
}

export type DropWhere = "before" | "into" | "after"
export interface DropHint {
  key: string
  where: DropWhere
}

/** The MIME type a dragged row's key travels under. */
export const NAV_DRAG_TYPE = "text/x-dt-nav"
export const LAYER_KINDS = new Set(["layers", "layer", "layer-group", "layer-collection", "layer-note"])
export const ARRANGED = new Set(["folder", "namespace", "collection"])
/** The hint key of the empty area under the last row — the bottom of the top level as a drop. */
export const TAIL = "::tail"

const isContainer = (n: { kind: string }) => n.kind === "folder" || n.kind === "namespace"

/** Every node by key, the node each sits in, and the rows at depth 0 (the workspace node's children, and any other
 *  top node a host sends beside it — the workspace node is the toolbar's name, never a row). */
export interface NavIndex {
  nodes: NavNode[]
  byKey: Map<string, NavNode>
  parentOf: Map<string, NavNode>
  top: NavNode[]
  workspace: NavNode | null
}

export function navIndex(nodes: NavNode[]): NavIndex {
  const byKey = new Map<string, NavNode>()
  const parentOf = new Map<string, NavNode>()
  const walk = (list: NavNode[], parent?: NavNode) => {
    for (const n of list) {
      byKey.set(n.key, n)
      if (parent) parentOf.set(n.key, parent)
      if (n.children) walk(n.children, n)
    }
  }
  walk(nodes)
  return {
    nodes,
    byKey,
    parentOf,
    top: nodes.flatMap(n => (n.kind === "workspace" ? (n.children ?? []) : [n])),
    workspace: nodes.find(n => n.kind === "workspace") ?? null,
  }
}

/**
 * Where a pointer `at` (0 = the row's top edge, 1 = its bottom) drops. A folder or namespace row: `before` on its top
 * quarter, `into` on the middle half, `after` on its bottom quarter. Any other row: `before` on its upper half, `after`
 * on its lower. With no position (NaN), a container takes `into` and any other row `after`.
 */
export function dropWhere(node: { kind: string }, at: number): DropWhere {
  const container = isContainer(node)
  if (!Number.isFinite(at)) return container ? "into" : "after"
  if (!container) return at < 0.5 ? "before" : "after"
  return at < 0.25 ? "before" : at <= 0.75 ? "into" : "after"
}

/** The level a node is placed in: `into` its folder or namespace, nothing at the top level. */
function parentInto(ix: NavIndex, n: NavNode): { into?: NavTarget } {
  const p = ix.parentOf.get(n.key)
  return p && p.kind !== "workspace" && p.target ? { into: p.target } : {}
}

/** The arranged siblings of a node (layers and views are not), in drawn order. */
export function siblingsOf(ix: NavIndex, n: NavNode): NavNode[] {
  const p = ix.parentOf.get(n.key)
  return (p?.children ?? ix.nodes).filter(s => s.target && ARRANGED.has(s.kind))
}

/** An open folder or namespace whose arranged rows are drawn right under it. */
function opensOnto(n: NavNode, isOpen: (key: string) => boolean): boolean {
  return isOpen(n.key) && (n.children ?? []).some(c => c.target && ARRANGED.has(c.kind))
}

/** A drop of the dragged row onto `targetKey` as a move, or null when it means nothing (a layer, itself, no target). */
export function dropOp(
  ix: NavIndex,
  key: string | null,
  targetKey: string,
  where: DropWhere,
  isOpen: (key: string) => boolean
): NavOp | null {
  const dragged = key ? ix.byKey.get(key) : undefined
  let onto = ix.byKey.get(targetKey)
  if (!dragged?.target || !onto || LAYER_KINDS.has(onto.kind) || dragged.key === onto.key) return null
  if (onto.kind === "view") {
    onto = ix.parentOf.get(onto.key)
    where = "after"
  }
  if (!onto?.target) return null
  const container = isContainer(onto)
  if (where === "into" && container) return { op: "move", target: dragged.target, into: onto.target }
  // the lower edge of an OPEN folder is the top of its first row, so it means the top inside it — one place per line
  if (where === "after" && container && opensOnto(onto, isOpen))
    return { op: "move", target: dragged.target, into: onto.target, position: "top" }
  if (where === "before") {
    // before the first row of a level is the top of that level; before any other, right after the row above it
    const sibs = siblingsOf(ix, onto)
    const i = sibs.findIndex(s => s.key === onto!.key)
    if (i === 0) return { op: "move", target: dragged.target, ...parentInto(ix, onto), position: "top" }
    const above = i > 0 ? sibs[i - 1] : undefined
    if (!above?.target) return null
    if (above.key === dragged.key) return null // already right there
    return { op: "move", target: dragged.target, after: above.target }
  }
  return { op: "move", target: dragged.target, after: onto.target }
}

/** A drop on the empty area under the last row: the bottom of the top level — nothing when it is already there. */
export function tailOp(ix: NavIndex, key: string | null): NavOp | null {
  const dragged = key ? ix.byKey.get(key) : undefined
  if (!dragged?.target || !ARRANGED.has(dragged.kind)) return null
  const top = ix.top.filter(s => s.target && ARRANGED.has(s.kind))
  if (top[top.length - 1]?.key === dragged.key) return null
  return { op: "move", target: dragged.target, position: "bottom" }
}

/** Where the empty area's drop line draws: where `position: bottom` lands — after the last ARRANGED top-level row, so
 *  above a Layers folder drawn below it (as a line on that row's top edge), else on the empty area's own top edge. */
export function tailLine(ix: NavIndex): DropHint {
  let last = -1
  ix.top.forEach((n, i) => {
    if (n.target && ARRANGED.has(n.kind)) last = i
  })
  const below = ix.top[last + 1]
  return below ? { key: below.key, where: "before" } : { key: TAIL, where: "after" }
}

/** The line is drawn where the drop lands: none over a layer, after its collection over a view row. */
export function hoverHint(ix: NavIndex, h: DropHint): DropHint | null {
  const onto = ix.byKey.get(h.key)
  if (!onto || LAYER_KINDS.has(onto.kind)) return null
  if (onto.kind === "view") {
    const p = ix.parentOf.get(onto.key)
    return p ? { key: p.key, where: "after" } : null
  }
  return h
}

/** One entry of a nav menu. An entry that needs a value asks for it in place before it is picked. */
export interface NavMenuItem {
  id: string
  label: string
  disabled?: boolean
  /** The value the entry needs: a text (a label, a name) or an icon. */
  ask?: "text" | "icon"
  /** The text field's starting value and placeholder. */
  value?: string
  placeholder?: string
  /** Values offered beside the text field (Show hidden…: the names hidden last). */
  suggestions?: string[]
}

export interface NavMenu {
  items: NavMenuItem[]
  act(id: string, value?: string | null): NavOp | null
}

/** The toolbar's New folder and Show hidden… — the entries the root row's menu had. */
export function toolbarMenu(hiddenNames: string[]): NavMenu {
  return {
    items: [
      { id: "new-folder", label: "New folder…", ask: "text", placeholder: "Folder name" },
      {
        id: "show-hidden",
        label: "Show hidden…",
        ask: "text",
        placeholder: "A hidden collection or namespace",
        suggestions: hiddenNames,
      },
    ],
    act: (id, value) =>
      id === "new-folder" && value
        ? { op: "new-folder", label: value }
        : id === "show-hidden" && value
          ? { op: "show", target: { name: value } }
          : null,
  }
}

/** A row's menu and what each entry sends; null for a row that has none (a layer, a view). */
export function rowMenu(ix: NavIndex, key: string): NavMenu | null {
  const n = ix.byKey.get(key)
  if (!n?.target || !ARRANGED.has(n.kind)) return null
  const target = n.target
  const sibs = siblingsOf(ix, n)
  const i = sibs.findIndex(s => s.key === n.key)
  const items: NavMenuItem[] = [
    ...(isContainer(n)
      ? [{ id: "new-folder", label: "New folder…", ask: "text" as const, placeholder: "Folder name" }]
      : []),
    ...(n.kind === "folder"
      ? [
          { id: "rename", label: "Rename…", ask: "text" as const, value: n.label },
          { id: "dissolve", label: "Dissolve" },
        ]
      : []),
    { id: "move-up", label: "Move up", disabled: i <= 0 },
    { id: "move-down", label: "Move down", disabled: i < 0 || i >= sibs.length - 1 },
    { id: "move-top", label: "Move to top", disabled: i <= 0 },
    { id: "move-bottom", label: "Move to bottom", disabled: i < 0 || i >= sibs.length - 1 },
    { id: "icon", label: "Set icon…", ask: "icon", value: n.icon },
    { id: "hide", label: "Hide" },
  ]
  const act = (id: string, value?: string | null): NavOp | null => {
    switch (id) {
      case "new-folder":
        return value ? { op: "new-folder", label: value, into: target } : null
      case "rename":
        return value && "folder" in target ? { op: "rename", target, label: value } : null
      case "dissolve":
        return "folder" in target ? { op: "dissolve", target } : null
      // Move up: after the sibling two above, or to the top of the level when it is second
      case "move-up":
        return i === 1
          ? { op: "move", target, ...parentInto(ix, n), position: "top" }
          : i > 1
            ? { op: "move", target, after: sibs[i - 2]!.target! }
            : null
      case "move-down":
        return i >= 0 && i < sibs.length - 1 ? { op: "move", target, after: sibs[i + 1]!.target! } : null
      case "move-top":
        return { op: "move", target, ...parentInto(ix, n), position: "top" }
      case "move-bottom":
        return { op: "move", target, ...parentInto(ix, n), position: "bottom" }
      case "icon":
        return { op: "icon", target, icon: value ?? null }
      case "hide":
        return { op: "hide", target }
    }
    return null
  }
  return { items, act }
}

/** What Show hidden… offers from a written document: the names in `hidden`, then every namespace entry hidden in
 *  place (`hidden: true` — hide keeps a placed namespace's arrangement). */
export function hiddenIn(doc: { tree?: unknown; hidden?: unknown }): string[] {
  const out = Array.isArray(doc.hidden) ? doc.hidden.filter((h): h is string => typeof h === "string") : []
  const walk = (items: unknown) => {
    if (!Array.isArray(items)) return
    for (const e of items) {
      if (!e || typeof e !== "object") continue
      const entry = e as { namespace?: unknown; hidden?: unknown; items?: unknown }
      if (typeof entry.namespace === "string" && entry.hidden === true && !out.includes(entry.namespace))
        out.push(entry.namespace)
      walk(entry.items)
    }
  }
  walk(doc.tree)
  return out
}

/** The row of the current route: a row naming a query (a layer's `?filter=`) is active on exactly that route; any
 *  other on its path and below. */
export function rowActive(nodeRoute: string | undefined, route: string): boolean {
  if (nodeRoute === undefined) return false
  const here = nodeRoute.includes("?") ? route : route.split("?")[0]!
  return here === nodeRoute || here.startsWith(`${nodeRoute}/`)
}
