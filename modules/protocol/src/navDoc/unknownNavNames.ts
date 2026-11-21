import { engineNav, isNamespace, type NavDoc, walk } from "../navDoc.ts"
import { collectionOf } from "./collectionOf.ts"

/** The names a document places that the workspace does not have — `unknown collection "x"`, `unknown namespace
 *  "y"` — through the engine's validateNavDoc when it has one, else the protocol's own check. A name listed twice
 *  is not refused: it draws at its first place. */
export function unknownNavNames(
  doc: NavDoc,
  { collections, namespaces }: { collections: Set<string> | Iterable<string>; namespaces: readonly string[] }
): string[] {
  const ctx = {
    collections: collections instanceof Set ? collections : new Set(collections),
    namespaces: [...namespaces],
  }
  const viaEngine = engineNav("validateNavDoc")
  if (viaEngine)
    return viaEngine(doc, ctx)
      .map((w: any) => w.warning)
      .filter((w: any) => /^unknown /.test(w))
  const out = []
  const declared = new Set(ctx.namespaces)
  for (const { entry } of walk(doc.tree)) {
    const c = collectionOf(entry)
    if (c !== undefined && !ctx.collections.has(c)) out.push(`unknown collection "${c}"`)
    else if (isNamespace(entry) && !declared.has(entry.namespace)) out.push(`unknown namespace "${entry.namespace}"`)
  }
  for (const h of doc.hidden) if (!ctx.collections.has(h) && !declared.has(h)) out.push(`unknown collection "${h}"`)
  return [...new Set(out)]
}
