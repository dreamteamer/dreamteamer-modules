import { NavOpError, entryProblem, show, type NavDoc } from "../navDoc.ts"
import { normalizeNavDoc } from "./normalizeNavDoc.ts"

/** A PUT body checked for shape: every entry one of the four forms, a folder label neither empty nor `ns:…`, an
 *  icon a string, `hidden` a list of names. Returns the document as a whole one; throws NavOpError naming the
 *  first problem. */
export function checkNavDoc(input: unknown): NavDoc {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new NavOpError(`not a NavDoc: ${show(input)} — { tree: [entries], hidden?: [names] }`)
  if (!Array.isArray((input as any).tree))
    throw new NavOpError(`tree ${show((input as any).tree)} is not a list of entries`)
  if (
    (input as any).hidden !== undefined &&
    (!Array.isArray((input as any).hidden) || !(input as any).hidden.every((h: any) => typeof h === "string" && h))
  )
    throw new NavOpError(`hidden ${show((input as any).hidden)} is not a list of names`)
  const where = (path: any) => (path.length ? ` in ${show(path)}` : "")
  const level = (items: any, path: any) => {
    for (const e of items) {
      const problem = entryProblem(e, path, where)
      if (problem) throw new NavOpError(problem)
      if (typeof e === "string" || typeof e.collection === "string") continue
      if (typeof e.folder === "string") level(e.items, [...path, e.folder])
      else level(e.items ?? [], [...path, `ns:${e.namespace}`])
    }
  }
  level((input as any).tree, [])
  return normalizeNavDoc(input)
}
