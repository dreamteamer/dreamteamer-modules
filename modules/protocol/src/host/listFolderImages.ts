// Ported from the dreamteamer VS Code extension's host side (src/folder-images.ts); PROTOCOL.md is the contract it answers.
import * as fs from "node:fs"
import * as path from "node:path"
import { naturalCompare } from "./naturalCompare.ts"
export { naturalCompare } from "./naturalCompare.ts"

export interface EnvRoot {
  name: string
  path: string
}
export const IMAGE_EXTS: Set<string> = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"])
export function isImageFile(name: string): boolean {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase()
  return name.includes(".") && IMAGE_EXTS.has(ext)
}

export function listFolderImages(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && isImageFile(e.name) && !e.name.startsWith("."))
      .map(e => e.name)
      .sort(naturalCompare)
  } catch {
    return []
  }
}
export function envRoots(declared: string[], render: (template: string) => string): EnvRoot[] {
  const out = []
  for (const name of declared) {
    let value
    try {
      value = render(`\${env:${name}}`)
    } catch {
      continue
    }
    if (!value || value.includes("${")) continue
    try {
      if (fs.statSync(value).isDirectory()) out.push({ name, path: path.resolve(value) })
    } catch {}
  }
  return out
}
