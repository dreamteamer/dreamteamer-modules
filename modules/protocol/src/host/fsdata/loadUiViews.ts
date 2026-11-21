import * as fs from "node:fs"
import * as yaml from "js-yaml"
import * as path from "node:path"
import type { UiView } from "../fsdata.ts"
import { systemDir } from "./systemDir.ts"

export function loadUiViews(root: string): UiView[] {
  const dir = systemDir(root, "ui-views")
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".ui-view.yaml")) continue
    try {
      const v: any = yaml.load(fs.readFileSync(path.join(dir, f), "utf8"))
      v.id = f.slice(0, -".ui-view.yaml".length)
      out.push(v)
    } catch {}
  }
  return out.sort((a, b) => (a.display?.nav?.order ?? 999) - (b.display?.nav?.order ?? 999))
}
