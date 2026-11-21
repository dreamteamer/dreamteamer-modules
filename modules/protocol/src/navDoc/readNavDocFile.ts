import path from "node:path"
import fs from "node:fs"
import yaml from "js-yaml"
import { NavDocError, type NavDoc } from "../navDoc.ts"

/** The protocol's own reader of `<root>/nav.yaml`, for an engine before 0.49 (which has no `readNavDoc`): null when
 *  the file is absent; a NavDocError when it is not YAML, not a mapping, or its `tree` or `hidden` is not a list. */
export function readNavDocFile(root: string): NavDoc | null {
  const file = path.join(root, "nav.yaml")
  let text
  try {
    text = fs.readFileSync(file, "utf8")
  } catch (e) {
    if (e.code === "ENOENT") return null
    throw new NavDocError(`nav.yaml cannot be read: ${e.message}`)
  }
  let raw: any
  try {
    raw = yaml.load(text)
  } catch (e) {
    throw new NavDocError(`nav.yaml is not valid YAML: ${String(e.message).split("\n")[0]}`)
  }
  if (raw === undefined || raw === null) return { tree: [], hidden: [] }
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new NavDocError("nav.yaml is not a mapping — it holds `tree:` and `hidden:`")
  if (raw.tree !== undefined && raw.tree !== null && !Array.isArray(raw.tree))
    throw new NavDocError("nav.yaml: `tree` is not a list")
  if (raw.hidden !== undefined && raw.hidden !== null && !Array.isArray(raw.hidden))
    throw new NavDocError("nav.yaml: `hidden` is not a list")
  return { tree: raw.tree ?? [], hidden: (raw.hidden ?? []).filter((h: any) => typeof h === "string") }
}
