import type { ModuleRecord } from "../fsdata.ts"
import { moduleFolderAccess, type SourceEntry, type SourcesContext } from "../sources.ts"

export function moduleSource(
  mod: Pick<ModuleRecord, "id" | "path"> | undefined,
  ctx: SourcesContext
): Omit<SourceEntry, "count"> {
  const p = mod?.path?.replace(/\/+$/, "") ?? ""
  if (!mod || !p.split("/").includes("node_modules"))
    return { name: ctx.workspace, kind: "own", repo: ".", path: p || ".", installed: true, via: "own", access: "write" }
  return {
    name: mod.id,
    kind: "module",
    repo: ".",
    path: p,
    installed: true,
    ...moduleFolderAccess(mod.id, p, ctx.root),
  }
}
