import fs from "node:fs"
import path from "node:path"
import { stripJsonComments, type NavSettings } from "./navModel.ts"

/** The four nav settings, read from a workspace's `.vscode/settings.json` (JSON with comments) — what
 *  http and web hosts use; the extension passes VS Code's merged configuration instead. */
export function workspaceNavSettings(root: string): NavSettings {
  try {
    const text = fs.readFileSync(path.join(root, ".vscode", "settings.json"), "utf8")
    const raw = JSON.parse(stripJsonComments(text))
    return {
      navGroups: raw["dreamteamer.navGroups"],
      navOrder: raw["dreamteamer.navOrder"],
      navHidden: raw["dreamteamer.navHidden"],
    }
  } catch {
    return {}
  }
}
