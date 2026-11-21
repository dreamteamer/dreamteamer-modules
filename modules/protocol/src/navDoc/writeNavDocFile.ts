import path from "node:path"
import fs from "node:fs"
import { NAV_FILE, type NavDoc } from "../navDoc.ts"
import { serializeNavDoc } from "./serializeNavDoc.ts"

/** The protocol's own writer, for an engine before 0.49: the whole document, atomically (a temp file renamed over
 *  the old one). False when the bytes were already there. */
export function writeNavDocFile(root: string, doc: NavDoc): boolean {
  const file = path.join(root, NAV_FILE)
  const text = serializeNavDoc(doc)
  try {
    if (fs.readFileSync(file, "utf8") === text) return false
  } catch {
    /* absent: written below */
  }
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
  return true
}
