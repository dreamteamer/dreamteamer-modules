import { isNamespace, type NavDoc, walk } from "../navDoc.ts"
import { collectionOf } from "./collectionOf.ts"

/** The names the document places: every collection entry, every namespace entry, and every hidden name. */
export function placedNames(doc: NavDoc): Set<string> {
  const out = new Set(doc.hidden)
  for (const { entry } of walk(doc.tree)) {
    const c = collectionOf(entry)
    if (c !== undefined) out.add(c)
    else if (isNamespace(entry)) out.add(`ns:${entry.namespace}`)
  }
  return out
}
