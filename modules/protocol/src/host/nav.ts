// Ported from the dreamteamer VS Code extension's host side (src/nav.ts); PROTOCOL.md is the contract it answers.
import { engine } from "./engine.ts"
import { isInternal, isRuntime, loadDescriptors, moduleDependencies, moduleNamespaces } from "./fsdata.ts"
import { workspaceModule } from "./fsdata/workspaceModule.ts"
import { loadModules } from "./fsdata/loadModules.ts"
import type { Descriptor, ModuleRecord } from "./fsdata.ts"
import { folderModule } from "./nav/folderModule.ts"
import { moduleIcon } from "./nav/moduleIcon.ts"
export { buildTree } from "./nav/buildTree.ts"
export { collectionRow } from "./nav/collectionRow.ts"
export { compareChildren } from "./nav/compareChildren.ts"
export { folderModule } from "./nav/folderModule.ts"
export { folderPresentation, moduleRoute } from "./nav/folderPresentation.ts"
export { foldSameLabel } from "./nav/foldSameLabel.ts"
export { groupLabel } from "./nav/groupLabel.ts"
export { groupTopLevel } from "./nav/groupTopLevel.ts"
export { hasNavSettings } from "./nav/hasNavSettings.ts"
export { legacyTree, withoutHidden } from "./nav/legacyTree.ts"
export { moduleIcon } from "./nav/moduleIcon.ts"
export { moduleLabel } from "./nav/moduleLabel.ts"
export { navGroupsOf } from "./nav/navGroupsOf.ts"
export { navKey } from "./nav/navKey.ts"
export { orderTopLevel } from "./nav/orderTopLevel.ts"
export { tailOrder } from "./nav/tailOrder.ts"
export type NavFolder = {
  key: string
  collections: Descriptor[]
  children: NavFolder[]
}
export type NavEntry =
  | {
      kind: "collection"
      descriptor: Descriptor
    }
  | {
      kind: "folder"
      folder: NavFolder
    }
export function keepsRuntimeRecords(d: Descriptor): boolean {
  return engine().descriptor.overlaidByOf(d).length > 0
}
export function shouldFoldOutOfRecordTree(d: Descriptor): boolean {
  return isInternal(d) && !keepsRuntimeRecords(d)
}
export function routeFor(d: Descriptor): string {
  return isInternal(d) ? `/settings/system/${d.name}` : `/content/${d.name}`
}

export const MODULE_ICON = "deployed_code"
export const PLAIN_FOLDER_ICON = "folder-compact"
export const MODULE_MARK = "•"
export const SHARED_MARK = "⚭"
export function rowMarks(marks: { module?: boolean; shared?: boolean }): string | undefined {
  return marks.module ? MODULE_MARK : marks.shared ? SHARED_MARK : undefined
}

export const WORKSPACE_ROUTE = "/settings/schema/activity"

export function navHiddenOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(n => typeof n === "string" && n.trim() !== "").map(n => n.trim().toLowerCase())
}

// ── nav.yaml (cr-dt-008) ─────────────────────────────────────────────────────────────────────────────────────
// The left nav is a document the person arranges (nav.yaml at the workspace root, navDoc.js). `buildTree` draws
// it by the design's rules; `legacyTree` is the grouping above (module folders, sections, navGroups/navOrder/
// navHidden), kept under one name for exactly two uses: the lossless migration of old settings into nav.yaml, and
// a workspace that still has those settings and no nav.yaml.
/** A node key: the kind's letter, then each path element URI-encoded and joined by "/" — a label `Sales/CRM` is
 *  `f/Sales%2FCRM`, never `f/Sales/CRM`. */
export const navPathKey = (letter: "f" | "n", path: string[]): string =>
  `${letter}/${path.map(el => encodeURIComponent(el)).join("/")}`
/** `dreamteamer.navOrder` as a list of names. */
export const navOrderOf = (raw: any) => (Array.isArray(raw) ? raw.filter(n => typeof n === "string") : [])

/** The icon a legacy folder draws (an authored name, before codiconFor): its module's look — the first shipped
 *  collection's icon by nav order — else the module icon; undefined for a folder no module owns (a plain folder). */
export function legacyFolderIcon(
  folder: NavFolder,
  modules: ReadonlyArray<ModuleRecord>,
  byName: Map<string, Descriptor>
): string | undefined {
  const module = folderModule(folder, modules)
  if (!module) return undefined
  const { displayOf } = engine().descriptor
  return (
    moduleIcon(
      modules.find(m => m.id === module),
      c => {
        const d = byName.get(c)
        return d ? { icon: displayOf(d).nav?.icon, order: displayOf(d).nav?.order, runtime: isRuntime(d) } : undefined
      }
    ) ?? MODULE_ICON
  )
}
/** What `legacyTree` and `legacyDoc` need of a workspace, read from its compiled runtime: the declared namespaces,
 *  its own module, the module graph, module titles, and each legacy folder's icon. */
export function legacyContext(root: string): {
  declared: string[]
  workspaceModule: string | undefined
  dependsOn: Map<string, string[]>
  namespacesOf: Map<string, string[]>
  titleOf: Map<string, string | undefined>
  iconOf: (folder: NavFolder) => string | undefined
} {
  const modules = loadModules(root)
  const byName = new Map(loadDescriptors(root).map(d => [d.name, d]))
  return {
    declared: engine().namespaces,
    workspaceModule: workspaceModule(root),
    dependsOn: moduleDependencies(root),
    namespacesOf: moduleNamespaces(root),
    titleOf: new Map(modules.map(m => [m.id, m.title])),
    iconOf: folder => legacyFolderIcon(folder, modules, byName),
  }
}
