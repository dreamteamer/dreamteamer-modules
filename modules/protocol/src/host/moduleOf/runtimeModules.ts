import type { ModuleRecord } from "../fsdata.ts"
import { moduleOfSource } from "./moduleOfSource.ts"

export function runtimeModules(
  entries:
    | Record<
        string,
        | {
            sources?: Array<{
              path?: string
            }>
          }
        | undefined
      >
    | undefined,
  modules: ReadonlyArray<Pick<ModuleRecord, "id" | "path">>
): Map<string, string> {
  const out = new Map()
  for (const [file, entry] of Object.entries<any>(entries ?? {})) {
    const source = entry?.sources?.[0]?.path
    const id = source ? moduleOfSource(source, modules) : undefined
    if (id) out.set(file, id)
  }
  return out
}
