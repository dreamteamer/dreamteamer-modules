// Ported from the dreamteamer VS Code extension's host side (src/sources.ts); PROTOCOL.md is the contract it answers.
import * as path from "node:path"
import type { ModuleRecord } from "./fsdata.ts"
import { isInstalledPackage } from "./sources/isInstalledPackage.ts"
export { collectionSources } from "./sources/collectionSources.ts"
export { describeSources } from "./sources/describeSources.ts"
export { isInstalledPackage } from "./sources/isInstalledPackage.ts"
export { moduleSource } from "./sources/moduleSource.ts"
export { runtimeSources } from "./sources/runtimeSources.ts"
export { sourceOfFile } from "./sources/sourceOfFile.ts"
export { sourcesContext } from "./sources/sourcesContext.ts"
export { sourcesStack } from "./sources/sourcesStack.ts"
export { withoutSourceClauses } from "./sources/withoutSourceClauses.ts"

export type SourceKind = "own" | "module"
export type SourceVia = "own" | "clone" | "package"
export type SourceAccess = "write" | "edit" | "read"
export interface SourceEntry {
  name: string
  kind: SourceKind
  repo: string
  path: string
  installed: boolean
  count: number
  via: SourceVia
  access: SourceAccess
  note?: string
}
export interface SourcesContext {
  root?: string
  workspace: string
  modules: ModuleRecord[]
}
export interface SourceStackEntry extends Omit<SourceEntry, "count" | "path"> {
  collections: Array<{
    collection: string
    path: string
    count: number
  }>
}

export function moduleFolderAccess(
  id: string,
  rel: string,
  root: string | undefined
): { via: SourceVia; access: SourceAccess; note?: string } {
  return isInstalledPackage(rel, root)
    ? {
        via: "package",
        access: "read",
        note: `${id} is an installed package — nothing is written to it from this workspace; change it in the package's own repo`,
      }
    : { via: "clone", access: "write" }
}
