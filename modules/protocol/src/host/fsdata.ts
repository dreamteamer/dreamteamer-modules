// Ported from the dreamteamer VS Code extension's host side (src/fsdata.ts); PROTOCOL.md is the contract it answers.
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { GIT_SYNC } from "./gitExec.ts"
import * as yaml from "js-yaml"

export interface Descriptor {
  name: string
  [key: string]: any
}
export interface ViewDisplay {
  nav?: {
    title?: string
    icon?: string
    order?: number
  }
  list?: {
    layout?: string
    columns?: string[]
    sort?: string
    options?: Record<string, any>
  }
  record?: {
    layout?: string
    subtitle?: string
    badge?: string
    color_by?: string
    options?: Record<string, any>
  }
  form?: {
    sections?: Array<{
      title: string
      fields: string[]
    }>
  }
}
export interface UiView {
  id: string
  name?: string
  title?: string
  description?: string
  route: string
  scope: "record" | "collection" | "page"
  collection?: string
  filter?: Record<string, any>
  display?: ViewDisplay
  compiled?: {
    display?: ViewDisplay
  }
}
export interface RecordEntry {
  id: string
  file: string
  fields: Record<string, any>
}
export interface ModuleRecord {
  id: string
  name: string
  title?: string
  channel?: string
  path?: string
  location?: string
  dependencies?: string[]
  namespaces?: string[]
  collections?: string[]
}
export interface CollectionRoot {
  dir: string
  repo: string
}
export const EXT: Record<string, string> = { md: ".md", yaml: ".yaml", json: ".json" }
export const acc = () => engine().descriptor

export function viewLabel(v: UiView): string {
  return v.display?.nav?.title ?? v.title ?? v.name ?? v.id
}
export function navViewsOf(views: UiView[], collection: string): UiView[] {
  return views.filter(v => v.scope === "collection" && !!v.display?.nav && viewCollection(v) === collection)
}

export function viewCollection(v: UiView): string {
  return (v.collection ?? "").replace(/^collections\//, "")
}
export function findWorkspaceRoot(
  folders: readonly {
    fsPath: string
  }[]
): string | undefined {
  for (const f of folders) {
    if (fs.existsSync(path.join(f.fsPath, ".dreamteamer", "manifest.yaml"))) return f.fsPath
    const pkg = path.join(f.fsPath, "package.json")
    if (fs.existsSync(pkg)) {
      try {
        if (JSON.parse(fs.readFileSync(pkg, "utf8")).dreamteamer) return f.fsPath
      } catch {}
    }
  }
  return undefined
}
export function isRuntime(d: Descriptor): boolean {
  return acc().isRuntime(d)
}
export function isInternal(d: Descriptor): boolean {
  return acc().isInternal(d)
}

export function moduleDependencies(root: string): Map<string, string[]> {
  return new Map(
    loadModules(root)
      .filter(m => m.dependencies?.length)
      .map(m => [m.id, m.dependencies])
  )
}
export function moduleNamespaces(root: string): Map<string, string[]> {
  return new Map(
    loadModules(root)
      .filter(m => m.namespaces?.length)
      .map(m => [m.id, m.namespaces])
  )
}

export function loadDescriptors(root: string): Descriptor[] {
  const order = (d: Descriptor) => acc().displayOf(d).nav?.order ?? 999
  return [...(engine().loadDescriptors(root)?.values() ?? [])].sort((a, b) => order(a) - order(b))
}

export function collectionDir(root: string, d: Descriptor): string {
  return collectionRoots(root, d)[0].dir
}

export function isUnderRecordRoot(root: string, descriptors: Iterable<Descriptor>, abs: string): boolean {
  const target = path.resolve(abs)
  for (const d of descriptors) {
    if (isRuntime(d)) continue
    for (const r of collectionRoots(root, d)) {
      const dir = path.resolve(r.dir)
      if (target === dir || target.startsWith(dir + path.sep)) return true
    }
  }
  return false
}
export function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith(".")) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else yield p
  }
}
import { engine } from "./engine.ts"
import { collectionRoots } from "./fsdata/collectionRoots.ts"
import { loadModules } from "./fsdata/loadModules.ts"
import { systemDir } from "./fsdata/systemDir.ts"
export { collectionRoots } from "./fsdata/collectionRoots.ts"
export { fileToRecord } from "./fsdata/fileToRecord.ts"
export { listRecords } from "./fsdata/listRecords.ts"
export { loadModules } from "./fsdata/loadModules.ts"
export { loadUiViews } from "./fsdata/loadUiViews.ts"
export { parseRecord } from "./fsdata/parseRecord.ts"
export { recordFileFor } from "./fsdata/recordFileFor.ts"
export { recordRoots } from "./fsdata/recordRoots.ts"
export { repoOfPath } from "./fsdata/repoOfPath.ts"
export { systemDir } from "./fsdata/systemDir.ts"
export { viewDisplay, viewRow } from "./fsdata/viewRow.ts"
export { walkIds } from "./fsdata/walkIds.ts"
export { workspaceModule } from "./fsdata/workspaceModule.ts"
export { workspaceName } from "./fsdata/workspaceName.ts"
export function parseRecordText(text: string, d: Descriptor, bodyField?: string): Record<string, any> {
  return engine().parseRecordText(text, d, bodyField)
}
export function serializeRecord(d: Descriptor, fields: Record<string, any>): string {
  return engine().serialize(d, fields)
}
export function bodyFieldOf(d: Descriptor): string | undefined {
  return engine().bodyField(d)
}

export function recordTail(d: Descriptor): string {
  const { suffix, format } = acc().storageOf(d)
  return `.${suffix}${EXT[format] ?? ""}`
}
export function recordIdOf(rel: string, d: Descriptor) {
  const { suffix, format } = acc().storageOf(d)
  const slashed = rel.split(path.sep).join("/")
  if (format === "binary") {
    const m = slashed.match(new RegExp(`^(.+)\\.${(suffix ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[^./]+$`))
    return m ? m[1] : undefined
  }
  const tail = recordTail(d)
  return slashed.endsWith(tail) ? slashed.slice(0, -tail.length) : undefined
}

export function fieldVerbTargets(d: Descriptor): string[] {
  return Object.entries<any>(acc().fieldsOf(d))
    .filter(([, f]) => !f.virtual && !f.derived)
    .map(([k]) => k)
}
export function titleField(d: Descriptor): string | undefined {
  const fields = acc().fieldsOf(d)
  return ["title", "name", "subject"].find(f => f in fields && !fields[f].virtual)
}
export function recordLabel(d: Descriptor, r: RecordEntry): string {
  const tf = titleField(d)
  const v = tf ? r.fields[tf] : undefined
  return typeof v === "string" && v.trim() ? v : r.id
}
export function uiViewFile(root: string, v: UiView): string {
  return path.join(systemDir(root, "ui-views"), `${v.id}.ui-view.yaml`)
}

export function operatorId(root: string): string | null {
  try {
    const name = execFileSync("git", ["config", "user.name"], { cwd: root, ...GIT_SYNC })
      .toString()
      .trim()
    const s = name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
    if (s) return s
    let h = 0
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0
    return "x" + h.toString(36).padStart(7, "0")
  } catch {
    return null
  }
}
export function matchesFilter(fields: Record<string, any>, filter: Record<string, any>, me: string | null): boolean {
  const meRef = me ? `users/${me}` : null
  for (const [k, v] of Object.entries<any>(filter ?? {})) {
    if (k === "_and") {
      if (!v.every((f: Record<string, any>) => matchesFilter(fields, f, me))) return false
    } else if (k === "_or") {
      if (!v.some((f: Record<string, any>) => matchesFilter(fields, f, me))) return false
    } else if (v !== null && typeof v === "object") {
      const expected = "_eq" in v ? v._eq : undefined
      const resolved = expected === "@me" ? meRef : expected
      if ("_eq" in v && String(fields[k] ?? "") !== String(resolved ?? "")) return false
      if ("_neq" in v && String(fields[k] ?? "") === String(v._neq === "@me" ? meRef : v._neq)) return false
      if ("_contains" in v && !String(fields[k] ?? "").includes(String(v._contains))) return false
    } else {
      const resolved = v === "@me" ? meRef : v
      if (String(fields[k] ?? "") !== String(resolved ?? "")) return false
    }
  }
  return true
}
