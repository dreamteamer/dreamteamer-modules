// The person's grant to module apps (cr-modules-008 D12): read from the workspace root's OWN
// .vscode/settings.json and nowhere else — never user settings, a .code-workspace file or a layer's folder.
// Host-side only (node:fs); the page receives the result as __DT_MODULE_GRANTS__.
import { readFileSync } from "node:fs"
import { join } from "node:path"

/** JSON with comments and trailing commas → JSON, leaving strings untouched. */
export function stripJsonc(text: string): string {
  let out = "",
    i = 0,
    inString = false
  while (i < text.length) {
    const c = text[i],
      n = text[i + 1]
    if (inString) {
      out += c
      if (c === "\\") {
        out += n ?? ""
        i += 2
        continue
      }
      if (c === '"') inString = false
      i++
      continue
    }
    if (c === '"') {
      inString = true
      out += c
      i++
      continue
    }
    if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") i++
      continue
    }
    if (c === "/" && n === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
      i += 2
      continue
    }
    out += c
    i++
  }
  return out.replace(/,(\s*[}\]])/g, "$1")
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(x => typeof x === "string") : [])

/** The grant and, when it could not be read, why — an absent file or key is no problem, just no grant. */
/** A module's grant: the collections it may read and write. */
export type ModuleGrant = Record<string, { reads: string[]; writes: string[] }>

export function readModuleGrantResult(root: string): { grant: ModuleGrant; problem: string | null } {
  let text
  try {
    text = readFileSync(join(root, ".vscode", "settings.json"), "utf8")
  } catch {
    return { grant: {}, problem: null }
  }
  let parsed
  try {
    parsed = JSON.parse(stripJsonc(text))
  } catch {
    return { grant: {}, problem: ".vscode/settings.json is not valid JSON" }
  }
  if (!parsed || !("dreamteamer.moduleApps" in parsed)) return { grant: {}, problem: null }
  const block = parsed["dreamteamer.moduleApps"]
  if (!block || typeof block !== "object" || Array.isArray(block))
    return { grant: {}, problem: '"dreamteamer.moduleApps" in .vscode/settings.json is not an object of modules' }
  return {
    grant: Object.fromEntries(
      Object.entries<any>(block).map(([m, g]) => [m, { reads: strings(g?.reads), writes: strings(g?.writes) }])
    ),
    problem: null,
  }
}

export function readModuleGrant(root: string): ModuleGrant {
  return readModuleGrantResult(root).grant
}
