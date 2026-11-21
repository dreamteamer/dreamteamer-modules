import type { ModuleRecord } from "../fsdata.ts"
import type { ActivityScope } from "../activity.ts"
import { repoOf } from "./repoOf.ts"

export function moduleScope(
  root: string,
  module: Pick<ModuleRecord, "id" | "path" | "location">,
  workspaceModule: string | undefined,
  recordDirsOf: (module: string) => string[]
): ActivityScope | undefined {
  const rel = module.path?.replace(/\/+$/, "")
  if (!rel || module.location === "node_modules" || rel.split("/").includes("node_modules")) return undefined
  const repo = repoOf(root, rel)
  if (repo !== "." || module.id === workspaceModule) return { repo, paths: [] }
  const paths = [rel, ...recordDirsOf(module.id).filter(d => repoOf(root, d) === ".")]
  return { repo, paths: [...new Set(paths)] }
}
