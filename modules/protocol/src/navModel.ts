// THE NAV AS DATA — what the VS Code extension draws as its Collections tree (its `tree.ts`), computed
// by the same decisions (`host/nav.js`, `host/sources.js`, `host/fsdata.js`) and returned as plain
// nodes, so a host with no native tree (dt web) draws the same folders, rows and order.
// `GET /nav` answers it. Each node is { kind, key, label, icon?, description?, tooltip?, route?, marks?,
// target?, children? }; `kind` is the tree item's contextValue (workspace · folder · namespace · collection ·
// view · layers · layer · layer-group · layer-collection · layer-note · message). Every folder, namespace and
// collection node carries `target`, the NavTarget a host sends back in a PATCH /nav op.
//
// Three cases (cr-dt-008): a workspace with nav.yaml draws it (`buildTree`); with no nav.yaml and none of the old
// settings (navGroups · navOrder · navHidden), the flat tree (`buildTree` with no document); with no nav.yaml and an
// old setting, the legacy tree it drew before (`legacyTree`) until the settings are migrated into nav.yaml. An
// unreadable nav.yaml draws the flat tree with the message on the workspace node's `notice`. The layers folder
// draws after the tree and its tails. A record layer is drawn the same way from its own clone (design §3 rule 9):
// by the nav.yaml in git_modules/<key> through `layerTree`, else the legacy drawing from its own settings; an
// unreadable one draws the layer flat with the message on the layer node's `notice`.
import fs from "node:fs"
import path from "node:path"
import { engine, engineLoaded } from "./host/engine.ts"
import {
  isRuntime,
  loadDescriptors,
  loadModules,
  loadUiViews,
  moduleDependencies,
  moduleNamespaces,
  navViewsOf,
  viewRow,
  workspaceModule,
} from "./host/fsdata.ts"
import {
  WORKSPACE_ROUTE,
  buildTree,
  collectionRow,
  folderModule,
  folderPresentation,
  groupLabel,
  hasNavSettings,
  layerTree,
  legacyTree,
  moduleIcon,
  navGroupsOf,
  navOrderOf,
  navPathKey,
  rowMarks,
  groupedLayerFolders,
  layerEntries,
  layerNote,
  moduleLabel,
  routeFor,
  shouldFoldOutOfRecordTree,
  tailOrder,
} from "./host/nav.ts"
import { navDocProblems, navProblemsSentence, readNavDoc } from "./navDoc.ts"
import { collectionSources, layerTitle, sourcesContext, sourcesStack } from "./host/sources.ts"
import { codiconFor } from "./host/codiconFor.ts"

import type { NavTarget, NavDoc } from "./navDoc.ts"
import type { Descriptor, UiView } from "./host/fsdata.ts"

export interface NavSettings {
  navGroups?: unknown
  navOrder?: unknown
  navHidden?: unknown
  layersFolder?: unknown
}
export interface NavNode {
  kind:
    | "workspace"
    | "folder"
    | "namespace"
    | "collection"
    | "view"
    | "layers"
    | "layer"
    | "layer-group"
    | "layer-collection"
    | "layer-note"
    | "message"
  key: string
  label: string
  icon?: string
  description?: string
  tooltip?: string
  route?: string
  marks?: string
  /** On folder, namespace and collection nodes: what a host sends back in a PATCH /nav op. */
  target?: NavTarget
  /** On the workspace node: a message to draw once above the tree (an unreadable nav.yaml). */
  notice?: string
  children?: NavNode[]
}

/** The four nav settings, read from a workspace's `.vscode/settings.json` (JSON with comments) — what
 *  http and web hosts use; the extension passes VS Code's merged configuration instead. */
export function workspaceNavSettings(root: string): NavSettings {
  try {
    const text = fs.readFileSync(path.join(root, ".vscode", "settings.json"), "utf8")
    const raw = JSON.parse(stripJsonComments(text))
    return {
      navGroups: raw["dreamteamer.navGroups"],
      navOrder: raw["dreamteamer.navOrder"],
      navHidden: raw["dreamteamer.navHidden"],
      layersFolder: raw["dreamteamer.layersFolder"],
    }
  } catch {
    return {}
  }
}

/** Comments and trailing commas out of a JSONC text, strings left alone. */
function stripJsonComments(text: string): string {
  let out = ""
  for (let i = 0, inStr = false; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      out += c
      if (c === "\\") {
        out += text[++i] ?? ""
      } else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
      continue
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++
      out += "\n"
      continue
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
      i++
      continue
    }
    out += c
  }
  return out.replace(/,(\s*[}\]])/g, "$1")
}

const groupsOf = navGroupsOf
const orderOf = navOrderOf

export { readNavDoc }

/** A document as read, without the entries of no valid shape; `say` gets the sentence naming them, when any. */
function drawable(doc: NavDoc | null, say: (sentence: string) => void): NavDoc | null {
  if (!doc) return doc
  const { doc: clean, problems } = navDocProblems(doc)
  if (!problems.length) return doc
  say(navProblemsSentence(problems))
  return clean
}

/** What a nav write is checked against: the rows the tree can draw (`collections`, in drawn tail order — what
 *  applyNavOp places unplaced rows by), every compiled collection (`known`, what a PUT may name: an internal
 *  collection is not drawn but is not unknown) and the declared namespaces. */
export function navOpContext(root: string): {
  collections: Set<string>
  known: Set<string>
  namespaces: string[]
} {
  const descriptors = loadDescriptors(root)
  const { titleOf } = engine().descriptor
  return {
    collections: tailOrder(
      descriptors.filter(d => !shouldFoldOutOfRecordTree(d)),
      titleOf
    ),
    known: new Set(descriptors.map(d => d.name)),
    namespaces: [...(engineLoaded() ? engine().namespaces : [])],
  }
}
const layerSettings = (root: string, key: string): Record<string, any> => {
  try {
    const raw = JSON.parse(
      stripJsonComments(fs.readFileSync(path.join(root, "git_modules", key, ".vscode", "settings.json"), "utf8"))
    )
    return raw && typeof raw === "object" ? raw : {}
  } catch {
    return {}
  }
}

/** The tree, top to bottom: one `workspace` node whose children are the top level. */
export function navModel({
  root,
  settings = workspaceNavSettings(root),
}: {
  root: string
  settings?: NavSettings
}): NavNode[] {
  const descriptors = loadDescriptors(root)
  const modules = loadModules(root)
  const titleOf = new Map(modules.map(m => [m.id, m.title]))
  const byName = new Map(descriptors.map(d => [d.name, d]))
  const declared = engineLoaded() ? engine().namespaces : []
  let srcCtx: ReturnType<typeof sourcesContext> | null = null
  const ctx = () => (srcCtx ??= sourcesContext(root, descriptors))
  const sourcesOf = (d: Descriptor) => {
    try {
      return collectionSources(root, d, ctx())
    } catch {
      return undefined
    }
  }

  const present = (node: NavNode, row: string, module: string | undefined, about: string | undefined, opts: any) => {
    const p = folderPresentation(module, about, opts)
    node.icon = codiconFor(p.icon)
    if (p.tooltip) node.tooltip = p.tooltip
    if (p.marks) node.marks = p.marks
    if (p.route) node.route = p.route
    return node
  }
  const folderLook = (module: string | undefined, collections?: Descriptor[]) => {
    const { displayOf } = engine().descriptor
    const iconName = module
      ? moduleIcon(
          modules.find(m => m.id === module),
          c => {
            const d = byName.get(c)
            return d
              ? { icon: displayOf(d).nav?.icon, order: displayOf(d).nav?.order, runtime: isRuntime(d) }
              : undefined
          }
        )
      : undefined
    const shared = collections?.some((d: Descriptor) => collectionRow(d, sourcesOf(d)).shared) ?? false
    return { ...(iconName ? { icon: iconName } : {}), ...(shared ? { shared } : {}) }
  }
  const viewNode = (v: UiView): NavNode => {
    const r = viewRow(v)
    return {
      kind: "view",
      key: `v/${v.id}`,
      label: r.label,
      icon: codiconFor(r.icon),
      ...(r.description ? { description: r.description } : {}),
      tooltip: r.tooltip,
      ...(v.route ? { route: v.route } : {}),
    }
  }
  const views = loadUiViews(root)
  const collectionNode = (d: Descriptor): NavNode => {
    const row = collectionRow(d, sourcesOf(d))
    const marks = rowMarks({ shared: row.shared })
    const kids = navViewsOf(views, d.name).map(viewNode)
    return {
      kind: "collection",
      key: `c/${d.name}`,
      label: row.label,
      icon: codiconFor(row.icon),
      tooltip: row.tooltip,
      route: routeFor(d),
      target: { name: d.name },
      ...(row.count !== undefined ? { description: String(row.count) } : {}),
      ...(marks ? { marks } : {}),
      ...(kids.length ? { children: kids } : {}),
    }
  }
  // the legacy tree's folders, keyed and targeted as the folders migrateNavSettings writes for them: a module or
  // group folder is { folder: <label as drawn> }, a namespace folder { namespace } — so a host's node keeps its
  // key across the migration
  const groupNode = (f: any, label: string, path: string[] = []): NavNode => {
    const module = folderModule(f, modules)
    const look = folderLook(module, f.collections)
    const ns = f.key.startsWith("ns:") ? f.key.slice(3) : null
    const drawn = moduleLabel(f.key, label)
    const p = [...path, ns ? `ns:${ns}` : drawn]
    const node = present(
      {
        kind: ns ? "namespace" : "folder",
        key: navPathKey(ns ? "n" : "f", p),
        label: drawn,
        target: ns ? { name: ns } : { folder: p },
      },
      "",
      module,
      undefined,
      look
    )
    node.children = [
      ...f.collections.map(collectionNode),
      ...f.children.map((c: any) => groupNode(c, groupLabel(c.key, titleOf, f.key), p)),
    ]
    return node
  }
  const layerEntriesOf = (layer: any) => {
    const s = layerSettings(root, layer.key)
    return layerEntries(layer.rows, descriptors, {
      declared,
      workspaceModule: workspaceModule(path.join(root, "git_modules", layer.key)),
      dependsOn: moduleDependencies(root),
      namespacesOf: moduleNamespaces(root),
      navGroups: groupsOf(s["dreamteamer.navGroups"]),
      navOrder: orderOf(s["dreamteamer.navOrder"]),
      titleOf,
    })
  }
  const layerRowNode = (layer: any, row: any): NavNode => ({
    kind: "layer-collection",
    key: `l/${layer}/c/${row.collection}`,
    label: row.title,
    icon: codiconFor(row.icon),
    description: String(row.count),
    tooltip: `${row.title} — ${row.count} record${row.count === 1 ? "" : "s"} from ${layer}`,
    route: row.route,
  })
  const layerNodes = (layer: any, entries: any[]): NavNode[] =>
    entries.map((e: any) => {
      if (e.kind === "row") return layerRowNode(layer, e.row)
      const module = folderModule(e.folder, modules)
      const node = present(
        { kind: "layer-group", key: `l/${layer}/${e.folder.key}`, label: e.label },
        "",
        module,
        undefined,
        { icon: folderLook(module).icon, source: layer }
      )
      node.children = layerNodes(layer, e.entries)
      return node
    })
  // buildTree's nodes as layer nodes: keys prefixed with the layer, a folder or namespace a layer-group (no module
  // look: a nav.yaml folder is the person's), a row the layer's row with the entry's icon when it names one
  const layerDocNodes = (layer: any, nodes: any[]): NavNode[] =>
    nodes.map((n: any): NavNode => {
      if (n.kind === "collection") return { ...layerRowNode(layer, n.row), ...(n.icon ? { icon: n.icon } : {}) }
      return {
        kind: "layer-group",
        key: `l/${layer}/${n.key}`,
        label: n.label,
        icon: n.icon,
        children: layerDocNodes(layer, n.children ?? []),
      }
    })
  const layerChildren = (l: any, node: NavNode) => {
    let doc: NavDoc | null = null
    try {
      doc = drawable(readNavDoc(path.join(root, "git_modules", l.key)), (problem: string) => {
        node.notice = problem
      })
    } catch (e) {
      node.notice = String(e?.message ?? e)
      if (!/nav\.yaml/.test(node.notice)) node.notice = `nav.yaml: ${node.notice}`
      doc = { tree: [], hidden: [] }
    }
    if (doc === null) return layerNodes(l.key, layerEntriesOf(l))
    const { titleOf: title } = engine().descriptor
    return layerDocNodes(
      l.key,
      layerTree({
        rows: l.rows,
        descriptors,
        doc,
        namespaces: declared,
        titleOf: title,
        icon: codiconFor,
        namespaceTitle: (ns: string, parent?: string) =>
          groupLabel(`ns:${ns}`, titleOf, parent ? `ns:${parent}` : undefined),
      })
    )
  }
  const layerNode = (l: any): NavNode => {
    const module = folderModule({ layer: l.key }, modules)
    const node = present(
      { kind: "layer", key: `l/${l.key}`, label: l.label },
      "",
      module,
      `${l.key} — git_modules/${l.key}${l.installed ? "" : " (not installed)"}`,
      { icon: folderLook(module).icon, shared: true, source: l.key }
    )
    const note = layerNote(l)
    node.children = note
      ? [{ kind: "layer-note", key: `l/${l.key}/note`, label: "", description: note }]
      : layerChildren(l, node)
    return node
  }

  let top: NavNode[]
  let notice
  if (!descriptors.length) {
    top = [{ kind: "message", key: "message", label: "no compiled collections — run: npm run compile", icon: "info" }]
  } else {
    let layerGroups: { label: string; layers: any[] }[] = []
    try {
      const { layers } = sourcesStack(root, descriptors, ctx())
      layerGroups = groupedLayerFolders(
        layers,
        descriptors,
        settings.layersFolder,
        new Map(layers.map(l => [l.name, layerTitle(root, l.name)]))
      )
    } catch {
      /* a nav without the layers folder beats no nav */
    }
    const layersEntries = layerGroups.map(g => ({ kind: "layers" as const, label: g.label, layers: g.layers }))
    const layersNode = (e: { label: string; layers: any[] }): NavNode => ({
      kind: "layers",
      key: `layers/${e.label}`,
      label: e.label,
      icon: "layers",
      children: e.layers.map(layerNode),
    })
    let doc: NavDoc | null = null
    let absent = false
    try {
      doc = drawable(readNavDoc(root), (problem: string) => {
        notice = problem
      })
      absent = doc === null
    } catch (e) {
      notice = String(e?.message ?? e)
      if (!/nav\.yaml/.test(notice)) notice = `nav.yaml: ${notice}`
    }
    if (absent && hasNavSettings(settings)) {
      // the tree the person had, until the settings are migrated into nav.yaml (dt-nav migrate, or a host's first open)
      top = legacyTree(descriptors, settings, {
        declared,
        workspaceModule: workspaceModule(root),
        dependsOn: moduleDependencies(root),
        namespacesOf: moduleNamespaces(root),
        titleOf,
        layers: layersEntries,
      }).map(e =>
        e.kind === "collection"
          ? collectionNode(e.descriptor)
          : e.kind === "layers"
            ? layersNode(e)
            : groupNode(e.folder, groupLabel(e.folder.key, titleOf))
      )
    } else {
      const { titleOf: title } = engine().descriptor
      top = [
        ...buildTree({
          descriptors,
          doc,
          namespaces: declared,
          titleOf: title,
          nodeOf: collectionNode,
          icon: codiconFor,
          internal: shouldFoldOutOfRecordTree,
          namespaceTitle: (ns: string, parent?: string) =>
            groupLabel(`ns:${ns}`, titleOf, parent ? `ns:${parent}` : undefined),
        }),
        ...layersEntries.map(layersNode),
      ]
    }
  }
  return [
    {
      kind: "workspace",
      key: "workspace",
      label: path.basename(root),
      icon: "root-folder",
      route: WORKSPACE_ROUTE,
      ...(notice ? { notice } : {}),
      children: top,
    },
  ]
}
