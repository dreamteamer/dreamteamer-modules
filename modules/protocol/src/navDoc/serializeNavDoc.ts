import yaml from "js-yaml"
import type { NavDoc } from "../navDoc.ts"
import { normalizeNavDoc } from "./normalizeNavDoc.ts"

export const NAV_HEADER = "# The left nav of this workspace. Drag and drop writes this file; so may you."

/** A NavDoc as the text of a nav.yaml: the header line, `tree`, and `hidden` only when it holds a name. */
export function serializeNavDoc(doc: NavDoc): string {
  const d = normalizeNavDoc(doc)
  const body: Record<string, any> = { tree: d.tree }
  if (d.hidden.length) body.hidden = d.hidden
  return `${NAV_HEADER}\n${yaml.dump(body, { lineWidth: 120 }).replace(/\n+$/, "")}\n`
}
