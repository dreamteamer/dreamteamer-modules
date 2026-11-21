import { engine } from "../engine.ts"
import * as fs from "node:fs"
import type { Descriptor } from "../fsdata.ts"

export function parseRecord(file: string, d: Descriptor): Record<string, any> {
  try {
    return engine().parseRecordText(fs.readFileSync(file, "utf8"), d)
  } catch {
    return {}
  }
}
