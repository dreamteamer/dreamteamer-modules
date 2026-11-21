import { entryProblem, show, type NavDoc } from "../navDoc.ts"
import { normalizeNavDoc } from "./normalizeNavDoc.ts"

/**
 * What a document read from nav.yaml holds that is none of the four entry shapes — each problem a sentence naming
 * the entry and where it is (`null in ["Work"] is not a collection, a folder or a namespace`) — and the document
 * without those entries, which is what can still be drawn. A host draws `doc` with the problems on its notice, and
 * refuses a PATCH over them: a gesture never rewrites a hand-edited file around entries it cannot read.
 * @returns {{ doc: NavDoc, problems: string[] }}
 */
export function navDocProblems(input: unknown): { doc: NavDoc; problems: string[] } {
  const problems = []
  const d = normalizeNavDoc(input)
  const where = (path: any) => (path.length ? ` in ${show(path)}` : "")
  const level = (items: any, path: any) =>
    items.filter((e: any) => {
      const problem = entryProblem(e, path, where, { drawing: true })
      if (problem) {
        problems.push(problem)
        return false
      }
      if (e && typeof e === "object" && typeof e.folder === "string") e.items = level(e.items, [...path, e.folder])
      else if (e && typeof e === "object" && typeof e.namespace === "string" && Array.isArray(e.items))
        e.items = level(e.items, [...path, `ns:${e.namespace}`])
      return true
    })
  d.tree = level(d.tree, [])
  for (const h of Array.isArray((input as any)?.hidden) ? (input as any).hidden : [])
    if (typeof h !== "string" || !h) problems.push(`hidden holds ${show(h)}, which is not a name`)
  return { doc: d, problems }
}
