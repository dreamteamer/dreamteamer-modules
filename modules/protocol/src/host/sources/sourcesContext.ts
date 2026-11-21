import { loadModules } from "../fsdata/loadModules.ts"
import { workspaceName } from "../fsdata/workspaceName.ts"
import type { SourcesContext } from "../sources.ts"

export function sourcesContext(root: string): SourcesContext {
  return { root, workspace: workspaceName(root), modules: loadModules(root) }
}
