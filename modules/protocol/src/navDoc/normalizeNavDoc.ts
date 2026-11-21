import type { NavDoc } from "../navDoc.ts"

/** An absent or partial document as a whole one, deep-copied: what every op starts from. */
export function normalizeNavDoc(doc: unknown): NavDoc {
  const d: any = doc && typeof doc === "object" ? structuredClone(doc) : {}
  return {
    tree: Array.isArray(d.tree) ? d.tree : [],
    hidden: Array.isArray(d.hidden) ? d.hidden.filter((h: any) => typeof h === "string") : [],
  }
}
