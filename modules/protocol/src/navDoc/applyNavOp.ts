import {
  NavOpError,
  ensureNamespace,
  firstNamespace,
  isFolder,
  isNamespace,
  itemsOf,
  levelItems,
  materialiseNamespace,
  namespaceOf,
  parentNamespaceOf,
  show,
  type NavDoc,
  type NavOp,
  type NavOpContext,
  unplacedNamespacesOf,
  unplacedRowsOf,
  walk,
} from "../navDoc.ts"
import { collectionOf } from "./collectionOf.ts"
import { normalizeNavDoc } from "./normalizeNavDoc.ts"
import { placedNames } from "./placedNames.ts"

const OPS = new Set(["move", "new-folder", "rename", "dissolve", "icon", "hide", "show"])

const POSITIONS = new Set(["top", "bottom"])

function checkTarget(t: any, what: any) {
  if (!t || typeof t !== "object")
    throw new NavOpError(`${what} is missing — a NavTarget is { name } or { folder: [labels] }`)
  if (typeof t.name === "string" && t.name.trim()) return t
  if (Array.isArray(t.folder) && t.folder.length && t.folder.every((l: any) => typeof l === "string")) return t
  throw new NavOpError(`${what} ${show(t)} is not a NavTarget — { name: string } or { folder: [labels] }`)
}

/** A folder path to its entry (a folder or a namespace entry), first occurrence at each level. */
function resolvePath(doc: any, path: any) {
  let items = doc.tree
  let found
  const ancestors = []
  for (const el of path) {
    const ns = el.startsWith("ns:") ? el.slice(3) : null
    const i = items.findIndex(
      (e: any) => (ns !== null && isNamespace(e) && e.namespace === ns) || (isFolder(e) && e.folder === el)
    )
    if (i < 0) throw new NavOpError(`no folder ${show(path)} in nav.yaml — ${show(el)} is not there`)
    if (found) ancestors.push(found.entry)
    found = { entry: items[i], parent: items, index: i }
    items = Array.isArray(items[i].items) ? items[i].items : []
  }
  return { ...found, ancestors }
}

const firstCollection = (doc: any, name: any) => {
  for (const w of walk(doc.tree)) if (collectionOf(w.entry) === name) return w
  return undefined
}

/** Place, at the end of the level they draw in, the unplaced rows of that level that draw before `name` and `name`
 *  itself — the drawing of everything else is unchanged. */
function materialiseRow(doc: any, ctx: any, name: any) {
  const ns = namespaceOf(name, ctx.namespaces)
  const rows = unplacedRowsOf(doc, ctx, ns)
  const items = levelItems(doc, ctx, ns)
  // a row the document hides without placing draws nowhere; as an anchor it is placed at the end of its level
  for (const r of rows.includes(name) ? rows.slice(0, rows.indexOf(name) + 1) : [name]) items.push(r)
  return firstCollection(doc, name)
}

/** Place every unplaced tail of a level (its rows, then its namespaces), so what is appended next draws last. */
function materialiseTails(doc: any, ctx: any, ns: any) {
  const items = levelItems(doc, ctx, ns)
  for (const r of unplacedRowsOf(doc, ctx, ns)) items.push(r)
  for (const n of unplacedNamespacesOf(doc, ctx, ns)) items.push({ namespace: n })
}

const knows = (ctx: any, name: any) => ctx.collections.has(name) || ctx.namespaces.includes(name)

/**
 * A `{ name }` target as an entry: a placed collection (first occurrence), else an unplaced one the workspace has,
 * else a placed namespace entry, else an unplaced namespace. `unplaced` says the entry is not in the document yet.
 */
function resolveName(doc: any, ctx: any, name: any) {
  const c = firstCollection(doc, name)
  if (c) return { ...c, kind: "collection" }
  if (ctx.collections.has(name)) return { kind: "collection", unplaced: true, name }
  const n = firstNamespace(doc, name)
  if (n) return { ...n, kind: "namespace" }
  if (ctx.namespaces.includes(name)) return { kind: "namespace", unplaced: true, name }
  throw new NavOpError(`${show(name)} is neither a collection nor a namespace of this workspace`)
}

function resolveTarget(doc: any, ctx: any, t: any) {
  if (typeof t.name === "string") return resolveName(doc, ctx, t.name)
  const r = resolvePath(doc, t.folder)
  return { ...r, kind: isNamespace(r.entry) ? "namespace" : "folder" }
}

/** An `into` destination: a folder or a namespace entry. `{ name }` names a namespace (materialised when unplaced);
 *  a collection is never a destination. */
function resolveInto(doc: any, ctx: any, t: any) {
  if (typeof t.name === "string") {
    if (ctx.namespaces.includes(t.name) || firstNamespace(doc, t.name)) return ensureNamespace(doc, ctx, t.name)
    if (ctx.collections.has(t.name))
      throw new NavOpError(`cannot move into ${show(t.name)} — it is a row, not a folder or a namespace`)
    throw new NavOpError(`${show(t.name)} is neither a collection nor a namespace of this workspace`)
  }
  return resolvePath(doc, t.folder)
}

/** Take an entry out of its array. */
const detach = (w: any) => w.parent.splice(w.parent.indexOf(w.entry), 1)[0]

function validLabel(label: any, what = "label") {
  if (typeof label !== "string" || !label.trim()) throw new NavOpError(`the ${what} is empty — a folder needs a name`)
  if (label.startsWith("ns:"))
    throw new NavOpError(`the ${what} ${show(label)} starts with ns:, which names a namespace in a folder path`)
  return label
}

/**
 * The next document after one operation. Pure: `doc` is never touched; an absent document is `{ tree: [], hidden: [] }`.
 * `ctx.collections` iterates in drawn tail order (by title — what the host's `tailOrder()` gives) and
 * `ctx.namespaces` lists the workspace's namespaces in drawn order.
 * @param {import('./navDoc.ts').NavDoc | null | undefined} input
 * @param {import('./navDoc.ts').NavOp} op
 * @param {{ collections: Set<string>, namespaces: string[] }} ctx
 */
export function applyNavOp(input: NavDoc | null | undefined, op: NavOp, ctx: NavOpContext): NavDoc {
  if (!op || typeof op !== "object" || typeof op.op !== "string")
    throw new NavOpError(
      `not an op: ${show(op)} — { op: move | new-folder | rename | dissolve | icon | hide | show, … }`
    )
  if (!OPS.has(op.op)) throw new NavOpError(`unknown op ${show(op.op)} — one of ${[...OPS].join(", ")}`)
  const c = {
    collections: ctx?.collections instanceof Set ? ctx.collections : new Set(ctx?.collections ?? []),
    namespaces: [...(ctx?.namespaces ?? [])],
  }
  const doc = normalizeNavDoc(input)
  if (op.op === "hide" || op.op === "show") return visibility(doc, c, op)
  return onePlacement(
    applyPlacing(doc, c, op),
    op.op === "move" && typeof (op.target as { name?: string })?.name === "string"
      ? (op.target as { name: string }).name
      : undefined
  )
}

/** The ops that place: move, new-folder, rename, dissolve, icon. */
function applyPlacing(doc: any, c: any, op: any) {
  switch (op.op) {
    case "move":
      return move(doc, c, op)
    case "new-folder": {
      const label = validLabel(op.label)
      if (op.into !== undefined) checkTarget(op.into, "into")
      const items = op.into ? itemsOf(resolveInto(doc, c, op.into).entry) : doc.tree
      items.push({ folder: label, items: [] })
      return doc
    }
    case "rename": {
      const t = checkTarget(op.target, "target")
      if (!Array.isArray(t.folder)) throw new NavOpError(`rename takes { folder: [labels] }, not ${show(t)}`)
      const label = validLabel(op.label)
      const w = resolvePath(doc, t.folder)
      if (!isFolder(w.entry)) throw new NavOpError(`${show(t.folder)} is a namespace; its label is its module's title`)
      w.entry.folder = label
      return doc
    }
    case "dissolve": {
      const t = checkTarget(op.target, "target")
      if (!Array.isArray(t.folder)) throw new NavOpError(`dissolve takes { folder: [labels] }, not ${show(t)}`)
      const w = resolvePath(doc, t.folder)
      if (!isFolder(w.entry))
        throw new NavOpError(`${show(t.folder)} is a namespace, not a folder — only a folder dissolves`)
      w.parent.splice(w.index, 1, ...(w.entry.items ?? []))
      return doc
    }
    case "icon":
      return icon(doc, c, op)
  }
  return doc
}

/**
 * A name is placed once — in the tree, or in `hidden` — whatever an op placed on the way. A row listed in `hidden`
 * that the op placed in the tree: the moved row is shown where it was moved (taken out of `hidden`); one placed as a
 * side effect (an anchor, an icon) stays hidden and leaves the tree. A namespace listed in `hidden` that now has an
 * entry carries its hiding on the entry (`hidden: true`) instead.
 */
function onePlacement(doc: any, moved: any) {
  for (const name of [...doc.hidden]) {
    if (firstCollection(doc, name)) {
      if (name === moved) doc.hidden = doc.hidden.filter((h: any) => h !== name)
      else for (let w = firstCollection(doc, name); w; w = firstCollection(doc, name)) detach(w)
      continue
    }
    const ns = firstNamespace(doc, name)
    if (ns) {
      ns.entry.hidden = true
      doc.hidden = doc.hidden.filter((h: any) => h !== name)
    }
  }
  return doc
}

function move(doc: any, ctx: any, op: any) {
  const target = checkTarget(op.target, "target")
  if (op.into !== undefined && op.after !== undefined) throw new NavOpError("a move takes into or after, never both")
  if (op.position !== undefined && !POSITIONS.has(op.position))
    throw new NavOpError(`position ${show(op.position)} is not top or bottom`)
  if (op.position !== undefined && op.after !== undefined)
    throw new NavOpError("position places within into (or the top level), never beside after")
  if (op.into !== undefined) checkTarget(op.into, "into")
  if (op.after !== undefined) checkTarget(op.after, "after")
  // resolve the target once against the document as given, so an unknown name is refused before anything moves
  const first = resolveTarget(doc, ctx, target)
  const sameName =
    op.after && typeof op.after.name === "string" && typeof target.name === "string" && op.after.name === target.name
  if (sameName) return doc

  // the destination — anchors among unplaced rows are placed first, so nothing else moves on screen
  let dest // { items, index } — where the target is inserted
  if (op.after) {
    let anchor =
      typeof op.after.name === "string"
        ? resolveName(doc, ctx, op.after.name)
        : { ...resolvePath(doc, op.after.folder) }
    if (anchor.unplaced)
      anchor =
        anchor.kind === "collection"
          ? materialiseRow(doc, ctx, anchor.name)
          : materialiseNamespace(doc, ctx, anchor.name)
    dest = { anchor: anchor.entry }
  } else {
    const parent = op.into ? resolveInto(doc, ctx, op.into) : null
    const items = parent ? itemsOf(parent.entry) : doc.tree
    if (op.position === "top") dest = { items, top: true }
    else {
      // last: a level with unplaced tails (the top level, a namespace) places them first, so the target draws
      // after them; a folder has none
      if (!parent) materialiseTails(doc, ctx, "")
      else if (isNamespace(parent.entry)) materialiseTails(doc, ctx, parent.entry.namespace)
      dest = { items, top: false, parent: parent?.entry }
    }
  }

  // the target as it stands now (placing an anchor may have placed it too: Move down on an unplaced row)
  let t =
    typeof target.name === "string"
      ? resolveName(doc, ctx, target.name)
      : { ...resolvePath(doc, target.folder), kind: first.kind }
  let entry: any
  if (t.unplaced) entry = t.kind === "namespace" ? { namespace: t.name } : t.name
  else {
    entry = t.entry
    if (isFolder(entry) || isNamespace(entry)) {
      const within = (e: any) =>
        e === entry || [...walk(Array.isArray(entry.items) ? entry.items : [])].some(w => w.entry === e)
      const into = dest.anchor ? null : (dest.parent ?? (dest.items === doc.tree ? null : findOwner(doc, dest.items)))
      if (into && within(into))
        throw new NavOpError(`cannot move ${show(target.folder ?? target.name)} into itself or a folder inside it`)
      if (dest.anchor && dest.anchor !== entry && within(dest.anchor))
        throw new NavOpError(`cannot move ${show(target.folder ?? target.name)} after something inside it`)
      if (dest.anchor === entry) return doc
    }
    detach(t)
  }
  if (dest.anchor) {
    const w = locate(doc, dest.anchor)
    w.parent.splice(w.parent.indexOf(dest.anchor) + 1, 0, entry)
  } else if (dest.top) dest.items.unshift(entry)
  else dest.items.push(entry)
  return doc
}

/** The entry whose items array this is (undefined for the top level). */
function findOwner(doc: any, items: any) {
  for (const { entry } of walk(doc.tree)) if (entry && typeof entry === "object" && entry.items === items) return entry
  return undefined
}

/** Where an entry sits now. */
function locate(doc: any, entry: any) {
  for (const w of walk(doc.tree)) if (w.entry === entry) return w
  throw new NavOpError("internal: an anchor left the document")
}

function icon(doc: any, ctx: any, op: any) {
  const t = checkTarget(op.target, "target")
  if (op.icon !== null && (typeof op.icon !== "string" || !op.icon.trim()))
    throw new NavOpError(`icon ${show(op.icon)} is neither a codicon name nor null`)
  const r = resolveTarget(doc, ctx, t)
  if (r.unplaced) {
    if (op.icon === null) return doc // nothing to clear on a row the document does not hold
    if (r.kind === "collection")
      levelItems(doc, ctx, namespaceOf(r.name, ctx.namespaces)).push({ collection: r.name, icon: op.icon })
    else levelItems(doc, ctx, parentNamespaceOf(r.name, ctx.namespaces)).push({ namespace: r.name, icon: op.icon })
    return doc
  }
  if (r.kind === "collection") {
    const name = collectionOf(r.entry)
    r.parent[r.index] = op.icon === null ? name : { collection: name, icon: op.icon }
  } else if (op.icon === null) delete r.entry.icon
  else r.entry.icon = op.icon
  return doc
}

/**
 * Hide and show keep every name placed once — in the tree, or in `hidden`. Hide: a row leaves every place it has in
 * the tree and is listed in `hidden`; a folder (by path) and a namespace entry the document places get `hidden: true`
 * and keep their arrangement; an unplaced namespace is listed in `hidden`. Show: the reverse — a row listed in `hidden` and placed nowhere goes back at the end of its home level
 * (its namespace's entry, or the top level: the document does not record the folder it left); one also placed (an
 * older hide wrote both) is only un-hidden; a name the workspace no longer has is only taken out of `hidden`.
 */
function visibility(doc: any, ctx: any, op: any) {
  const t = checkTarget(op.target, "target")
  const hide = op.op === "hide"
  if (typeof t.name !== "string") {
    const w = resolvePath(doc, t.folder)
    if (hide) w.entry.hidden = true
    else delete w.entry.hidden
    return doc
  }
  const name = t.name
  // a name the document already holds may be hidden or shown even when its module is gone, so a stale entry can
  // be cleaned; any other name must be the workspace's
  if (!knows(ctx, name) && !placedNames(doc).has(name) && !firstNamespace(doc, name)) resolveName(doc, ctx, name)
  const isRow =
    ctx.collections.has(name) || (!ctx.namespaces.includes(name) && firstCollection(doc, name) !== undefined)
  if (hide) {
    if (isRow) {
      for (let w = firstCollection(doc, name); w; w = firstCollection(doc, name)) detach(w)
      if (!doc.hidden.includes(name)) doc.hidden.push(name)
      return doc
    }
    const ns = firstNamespace(doc, name)
    if (ns) ns.entry.hidden = true
    else if (!doc.hidden.includes(name)) doc.hidden.push(name)
    return doc
  }
  const wasHidden = doc.hidden.includes(name)
  doc.hidden = doc.hidden.filter((h: any) => h !== name)
  if (isRow) {
    if (wasHidden && ctx.collections.has(name) && !firstCollection(doc, name))
      levelItems(doc, ctx, namespaceOf(name, ctx.namespaces)).push(name)
    return doc
  }
  const ns = firstNamespace(doc, name)
  if (ns) delete ns.entry.hidden
  return doc
}
