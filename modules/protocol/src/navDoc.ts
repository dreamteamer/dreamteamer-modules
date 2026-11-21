// THE NAV DOCUMENT — nav.yaml at a workspace's root, the left nav a person arranges (cr-dt-008). This file is
// the protocol's half of the cross-repo contract: the types every host speaks (NavDoc, NavTarget, NavOp)
// and `applyNavOp`, the one pure function every gesture goes through — a drop, a menu entry, a
// PATCH /nav. The engine reads, validates and writes the file (dreamteamer 0.49); a host turns a gesture into one
// NavOp, applies it here and writes the result.
//
//   NavDoc    = { tree: Entry[], hidden: string[] }
//   Entry     = string | { collection, icon? } | { folder, icon?, hidden?, items } | { namespace, icon?, hidden?, items? }
//   NavTarget = { name } | { folder: string[] }   — a folder path from the top level; a namespace entry is the
//               path element `ns:<name>`; labels match exactly and are never joined into one string
//
// What the document does not place still exists: a collection it does not name trails its parent (the top level,
// or its namespace) in drawn order, and a namespace it does not name draws after the top level's unplaced rows.
// Such a name is a valid target and a valid anchor. Placing one never moves anything else on screen: an anchor
// among unplaced rows first places, in drawn order, the rows of its parent that draw before it and itself — and an
// unplaced namespace a gesture reaches into (a move into it, a row placed in it) is placed the same way.

import fs from "node:fs"
import path from "node:path"
import { engine, engineLoaded } from "./host/engine.ts"
import { loadDescriptors } from "./host/fsdata.ts"
import { legacyContext, navHiddenOf } from "./host/nav.ts"
import { navKey } from "./host/nav/navKey.ts"
import { legacyTree } from "./host/nav/legacyTree.ts"
import { hasNavSettings } from "./host/nav/hasNavSettings.ts"
import { groupLabel } from "./host/nav/groupLabel.ts"
import { normalizeNavDoc } from "./navDoc/normalizeNavDoc.ts"
import { placedNames } from "./navDoc/placedNames.ts"
import { writeNavDocFile } from "./navDoc/writeNavDocFile.ts"
export { applyNavOp } from "./navDoc/applyNavOp.ts"
export { checkNavDoc } from "./navDoc/checkNavDoc.ts"
export { collectionOf } from "./navDoc/collectionOf.ts"
export { navDocProblems } from "./navDoc/navDocProblems.ts"
export { normalizeNavDoc } from "./navDoc/normalizeNavDoc.ts"
export { placedNames } from "./navDoc/placedNames.ts"
export { readNavDoc } from "./navDoc/readNavDoc.ts"
export { readNavDocFile } from "./navDoc/readNavDocFile.ts"
export { NAV_HEADER, serializeNavDoc } from "./navDoc/serializeNavDoc.ts"
export { unknownNavNames } from "./navDoc/unknownNavNames.ts"
export { writeNavDocFile } from "./navDoc/writeNavDocFile.ts"

/** One entry of nav.yaml: a collection by name (or its long form, to override the icon), a folder, a namespace. */
export type Entry =
  | string
  | { collection: string; icon?: string }
  | { folder: string; icon?: string; hidden?: boolean; items: Entry[] }
  | { namespace: string; icon?: string; hidden?: boolean; items?: Entry[] }
/** nav.yaml: the tree, top to bottom, and the names that are not drawn. */
export interface NavDoc {
  tree: Entry[]
  hidden: string[]
}
/** What an op addresses. `name` is a collection or a namespace exactly as nav.yaml writes it; `folder` is the label
 *  path from the top level, where a namespace entry is the element `ns:<name>` — `{ folder: ['ns:rnd', 'Product'] }`.
 *  Labels match exactly; the path is an array, never a joined string. */
export type NavTarget = { name: string } | { folder: string[] }
/** One gesture. `into` is a folder or a namespace (`{ name: 'rnd' }` is the namespace entry); `position` is within
 *  `into`, or the top level when `into` is absent; `after` places right after that sibling in its parent. */
export type NavOp =
  | { op: "move"; target: NavTarget; into?: NavTarget; after?: NavTarget; position?: "top" | "bottom" }
  | { op: "new-folder"; label: string; into?: NavTarget }
  | { op: "rename"; target: { folder: string[] }; label: string }
  | { op: "dissolve"; target: { folder: string[] } }
  | { op: "icon"; target: NavTarget; icon: string | null }
  | { op: "hide"; target: NavTarget }
  | { op: "show"; target: NavTarget }
/** What applyNavOp needs of the workspace: its collections in drawn tail order (by title — `tailOrder()`), and its
 *  namespaces in drawn order. */
export interface NavOpContext {
  collections: Set<string>
  namespaces: string[]
}

/** A refused op: the message names the input. A host answers it 400. */
export class NavOpError extends Error {
  constructor(message: any) {
    super(message)
    this.name = "NavOpError"
  }
}

/** nav.yaml exists and cannot be read as a document: the message names the problem. A host draws the flat tree and
 *  shows the message; it never answers 500. */
export class NavDocError extends Error {
  constructor(message: any) {
    super(message)
    this.name = "NavDocError"
  }
}

export const show = (v: any) => JSON.stringify(v)
export const isFolder = (e: any) => e && typeof e === "object" && typeof e.folder === "string"
export const isNamespace = (e: any) => e && typeof e === "object" && typeof e.namespace === "string"
/** The items array of a folder or a namespace entry, created on a namespace entry that has none. */
export const itemsOf = (e: any) => (Array.isArray(e.items) ? e.items : (e.items = []))

/** The namespace a collection draws in: the longest declared namespace its name starts with (`rnd/issues` → rnd). */
export function namespaceOf(name: string, namespaces: readonly string[]): string {
  let best = ""
  for (const ns of namespaces) if (name.startsWith(`${ns}/`) && ns.length > best.length) best = ns
  return best
}

/** Every entry in document order (depth first), with the array that holds it and its ancestors. */
export function* walk(items: any, ancestors: any = []): Generator<any> {
  for (let i = 0; i < items.length; i++) {
    const e = items[i]
    yield { entry: e, parent: items, index: i, ancestors }
    if ((isFolder(e) || isNamespace(e)) && Array.isArray(e.items)) yield* walk(e.items, [...ancestors, e])
  }
}

const isPlacedCollection = (placed: any, name: any) => placed.has(name)
const isPlacedNamespace = (placed: any, ns: any, doc: any) => placed.has(`ns:${ns}`) || doc.hidden.includes(ns)
export const firstNamespace = (doc: any, ns: any) => {
  for (const w of walk(doc.tree)) if (isNamespace(w.entry) && w.entry.namespace === ns) return w
  return undefined
}

/** The drawn tail order of a level: the unplaced collections whose parent is that level, in `collections` order. */
export const unplacedRowsOf = (doc: any, ctx: any, ns: any) => {
  const placed = placedNames(doc)
  return [...ctx.collections].filter(c => !isPlacedCollection(placed, c) && namespaceOf(c, ctx.namespaces) === ns)
}
/** The parent namespace of a namespace (`rnd/lab` → rnd), '' at the top. */
export const parentNamespaceOf = (ns: any, namespaces: any) =>
  namespaceOf(
    ns,
    namespaces.filter((n: any) => n !== ns)
  )
/** The unplaced namespaces drawn inside a level, in `namespaces` order. */
export const unplacedNamespacesOf = (doc: any, ctx: any, parentNs: any) =>
  ctx.namespaces.filter(
    (n: any) => !isPlacedNamespace(placedNames(doc), n, doc) && parentNamespaceOf(n, ctx.namespaces) === parentNs
  )

/** The items array a level's unplaced tails draw in: the top level, or the namespace's entry — placed first, where
 *  it draws, when the document does not name it yet. */
export function levelItems(doc: any, ctx: any, ns: any): any[] {
  if (!ns) return doc.tree
  return itemsOf(ensureNamespace(doc, ctx, ns).entry)
}

/** The namespace entry. One the document does not place is placed the way an anchor is (materialiseNamespace): its
 *  level's unplaced rows and the unplaced namespaces drawn before it go first, so a gesture inside it — a move into
 *  it, a row placed in it — never lifts it above them. One drawn nowhere (hidden without a place) goes at the end of
 *  its level, and nothing else is placed. */
export function ensureNamespace(doc: any, ctx: any, ns: any): any {
  const at = firstNamespace(doc, ns)
  if (at) return at
  const parentNs = parentNamespaceOf(ns, ctx.namespaces)
  if (unplacedNamespacesOf(doc, ctx, parentNs).includes(ns)) return materialiseNamespace(doc, ctx, ns)
  const parent = levelItems(doc, ctx, parentNs)
  parent.push({ namespace: ns })
  return { entry: parent.at(-1), parent, index: parent.length - 1 }
}

/** An unplaced namespace used as an anchor: its level's unplaced rows and the namespaces drawn before it, then it. */
export function materialiseNamespace(doc: any, ctx: any, ns: any) {
  const parentNs = parentNamespaceOf(ns, ctx.namespaces)
  const items = levelItems(doc, ctx, parentNs)
  for (const r of unplacedRowsOf(doc, ctx, parentNs)) items.push(r)
  const before = unplacedNamespacesOf(doc, ctx, parentNs)
  for (const n of before.slice(0, before.indexOf(ns) + 1)) items.push({ namespace: n })
  return firstNamespace(doc, ns)
}

// ── reading and writing the file ────────────────────────────────────────────────────────────────────────────
// The engine owns the file from 0.49 (readNavDoc · validateNavDoc · writeNavDoc); on an older engine the protocol's
// own reader, name check and writer stand in, with the same header and the same bytes for the same document.

export const NAV_FILE = "nav.yaml"
/** The loaded engine's nav member, when the workspace's engine has one. */
export const engineNav = (name: string) => {
  const fn = engineLoaded() ? (engine() as unknown as Record<string, unknown>)[name] : undefined
  return typeof fn === "function" ? fn : undefined
}

/** The sentence for an entry of none of the four shapes, or undefined for a good one (its items checked apart).
 *  `drawing`: what a read must refuse to draw — the shape only; a label, an icon or a hidden flag a writer would
 *  refuse (a hand-written folder `ns:rnd`) still draws. */
export function entryProblem(e: any, path: any, where: any, { drawing = false } = {}) {
  if (typeof e === "string") return e ? undefined : `an empty name${where(path)}`
  if (!e || typeof e !== "object" || Array.isArray(e))
    return `${show(e)}${where(path)} is not a collection, a folder or a namespace`
  if (!drawing && e.icon !== undefined && (typeof e.icon !== "string" || !e.icon))
    return `icon ${show(e.icon)}${where(path)} is not a codicon name`
  if (!drawing && e.hidden !== undefined && typeof e.hidden !== "boolean")
    return `hidden ${show(e.hidden)}${where(path)} is not true or false`
  if (typeof e.collection === "string" && e.collection) return undefined
  if (typeof e.folder === "string") {
    if (drawing) return Array.isArray(e.items) ? undefined : `folder ${show(e.folder)}${where(path)} has no items list`
    if (!e.folder.trim()) return `the folder label${where(path)} is empty — a folder needs a name`
    if (e.folder.startsWith("ns:"))
      return `the folder label ${show(e.folder)}${where(path)} starts with ns:, which names a namespace in a folder path`
    if (!Array.isArray(e.items)) return `folder ${show(e.folder)}${where(path)} has no items list`
    return undefined
  }
  if (typeof e.namespace === "string" && e.namespace) {
    if (e.items !== undefined && !Array.isArray(e.items))
      return `namespace ${show(e.namespace)}${where(path)}: items is not a list`
    return undefined
  }
  return `${show(e)}${where(path)} is not a collection, a folder or a namespace`
}

/** The notice (or the refusal) for a document's problems: names nav.yaml and every entry. */
export const navProblemsSentence = (problems: string[]): string =>
  `nav.yaml holds ${problems.length === 1 ? "an entry" : `${problems.length} entries`} of no valid shape — ${problems.join("; ")}`

/** Write `<root>/nav.yaml`: the engine's writer when the loaded engine exports it, else the protocol's own. */
export function writeNavDoc(root: string, doc: NavDoc): boolean {
  const viaEngine = engineNav("writeNavDoc")
  return viaEngine ? viaEngine(root, normalizeNavDoc(doc)) : writeNavDocFile(root, doc)
}

// ── the migration from the old settings ─────────────────────────────────────────────────────────────────────
// Before nav.yaml, three settings in .vscode/settings.json arranged the nav: navOrder (the top level's order),
// navGroups (modules gathered into a named folder), navHidden (top-level names not drawn). The migration writes the
// tree they drew as a document, once, so the drawing does not change: every folder keeps its label, nesting, order
// and icon; a hidden top-level folder is kept with `hidden: true`, a hidden top-level row goes to `hidden`.

/**
 * The legacy tree's entries (legacyTree, BEFORE navHidden is applied) as a NavDoc. A top-level row is its name; a
 * module or group folder `{ folder: <label as drawn>, icon?, items }`; a namespace folder `{ namespace, icon?, items }`;
 * a folder's rows come before its subfolders, as the legacy tree draws them. A navHidden name matching a top-level
 * row puts it in `hidden`; matching a top-level folder, that entry gets `hidden: true` — the legacy tree hid nothing
 * deeper, so nothing deeper is hidden.
 * @param {Array} entries  legacyTree's top level, computed with no navHidden
 * @param {{ navHidden?: unknown }} settings
 * @param {{ titleOf?: Map<string, string|undefined>, iconOf?: (folder) => string|undefined }} ctx
 */
export function legacyDoc(
  entries: ReadonlyArray<unknown>,
  settings: { navHidden?: unknown } = {},
  {
    titleOf = new Map(),
    iconOf = (_f: any): string | undefined => undefined,
  }: { titleOf?: Map<string, string | undefined>; iconOf?: (folder: any) => string | undefined } = {}
): NavDoc {
  const hidden = new Set(navHiddenOf(settings?.navHidden))
  const folderEntry = (f: any, parentKey?: any): Record<string, any> => {
    const icon = iconOf(f)
    const items = [...f.collections.map((d: any) => d.name), ...f.children.map((c: any) => folderEntry(c, f.key))]
    return f.key.startsWith("ns:")
      ? { namespace: f.key.slice(3), ...(icon ? { icon } : {}), items }
      : { folder: groupLabel(f.key, titleOf, parentKey), ...(icon ? { icon } : {}), items }
  }
  const doc = { tree: [] as any[], hidden: [] as string[] }
  for (const e of entries as any[]) {
    if (e.kind === "collection") {
      ;(hidden.has(navKey(e).toLowerCase()) ? doc.hidden : doc.tree).push(e.descriptor.name)
    } else if (e.kind === "folder") {
      const entry = folderEntry(e.folder)
      if (hidden.has(navKey(e).toLowerCase())) entry.hidden = true
      doc.tree.push(entry)
    }
  }
  return doc
}

/**
 * Write a workspace's old nav settings into nav.yaml — once: only when nav.yaml is absent and one of navGroups,
 * navOrder, navHidden holds something. Then, on an engine that merges module fragments (0.49), apply them (they place
 * only what the document does not). `{ written, fragments }`; the engine must be loaded for `root`.
 * @param {string} root
 * @param {{ navGroups?: unknown, navOrder?: unknown, navHidden?: unknown }} settings
 */
export function migrateNavSettings(
  root: string,
  settings: { navGroups?: unknown; navOrder?: unknown; navHidden?: unknown } = {}
): { written: boolean; fragments: boolean } {
  if (fs.existsSync(path.join(root, NAV_FILE)) || !hasNavSettings(settings)) return { written: false, fragments: false }
  const ctx = legacyContext(root)
  const entries = legacyTree(loadDescriptors(root), { ...settings, navHidden: [] }, ctx)
  writeNavDoc(root, legacyDoc(entries, settings, ctx))
  const apply = engineNav("applyNavFragments")
  if (apply) apply(root)
  return { written: true, fragments: Boolean(apply) }
}
