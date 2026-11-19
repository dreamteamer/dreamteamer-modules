/**
 * The workspace's modules, read once per invalidation (`lib/modules.ts` merges the records with `/info`'s
 * manifest) — what the Modules list, a module's page, the Schema tab's scope banner and every module picker share.
 */
import { getInfo, listRecords } from "../api/client.ts"
import { useApp, useAsync } from "../AppContext.tsx"
import { moduleEntries, type ModuleEntry } from "../lib/modules.ts"

export interface Modules {
  modules: ModuleEntry[]
  /** The module a write with no `?module=` lands in (`/info`'s `workspace_module`); null when unknown. */
  workspaceModule: string | null
  loading: boolean
  error?: string
}

export function useModules(): Modules {
  const { version } = useApp()
  const read = useAsync(async () => {
    const [page, info] = await Promise.all([
      listRecords("modules", { limit: 200 }),
      // tolerated: without it the list has no location/path to fill — a poorer table, not a broken one
      getInfo().catch(() => null),
    ])
    return { modules: moduleEntries(page.records, info), workspaceModule: info?.workspace_module ?? null }
  }, [version])
  return {
    modules: read.data?.modules ?? [],
    workspaceModule: read.data?.workspaceModule ?? null,
    loading: read.loading,
    ...(read.error ? { error: read.error } : {}),
  }
}
