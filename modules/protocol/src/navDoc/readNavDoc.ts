import { NavDocError, engineNav, show, type NavDoc } from "../navDoc.ts"
import { readNavDocFile } from "./readNavDocFile.ts"

/** `<root>/nav.yaml` through the engine's reader when it has one (0.49), else the protocol's own. Null when absent;
 *  throws NavDocError when unreadable. */
export function readNavDoc(root: string): NavDoc | null {
  const viaEngine = engineNav("readNavDoc")
  let doc
  if (!viaEngine) doc = readNavDocFile(root)
  else {
    try {
      doc = viaEngine(root)
    } catch (e) {
      // the engine's NavDocError is its own class: carried over as the protocol's, so a host tells it by one name
      if (e?.name === "NavDocError" && !(e instanceof NavDocError)) throw new NavDocError(e.message)
      throw e
    }
  }
  if (doc) refuseLoops(doc)
  return doc
}

/** A YAML alias can make a folder contain itself; every walk of such a tree recurses forever, so the read refuses
 *  it as unreadable. An alias that does not loop (the same folder written twice) is two equal entries. */
function refuseLoops(doc: any) {
  const open = new Set()
  const visit = (v: any) => {
    if (!v || typeof v !== "object") return
    if (open.has(v)) {
      const label =
        typeof v.folder === "string"
          ? `folder ${show(v.folder)}`
          : typeof v.namespace === "string"
            ? `namespace ${show(v.namespace)}`
            : "an entry"
      throw new NavDocError(
        `nav.yaml: ${label} contains itself (a YAML alias loops back to it) — fix the file by hand, or PUT a whole document`
      )
    }
    open.add(v)
    for (const child of Array.isArray(v) ? v : Object.values(v)) visit(child)
    open.delete(v)
  }
  visit(doc.tree)
  visit(doc.hidden)
}
