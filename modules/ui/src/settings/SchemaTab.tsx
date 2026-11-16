/**
 * THE SCHEMA TAB (ported from the Vue ui's pages/SchemaTab.vue) — `/settings/schema[/<kind>[/<id>]]`: the
 * workspace's schema as a place you go. Left, the RAIL: Activity, every internal collection the engine marks
 * (`lib/schemaRail.ts` — derived, never listed; modules and collections pinned first), Sources. Right, the kind's
 * list, or the one row picked.
 *
 * ⚠ SELECTION IS ROUTE STATE: `/settings/schema/<kind>/<id>` is deep-linkable and reachable from a host
 * `dt:navigate`. The kind is one segment; the id may hold slashes (`lab/samples`, a slash-path record id).
 *
 * Surfaces: `collections` → the data model list, or one collection's designer (`?field=` opens a field's drawer);
 * `modules` → the module list, or the module's ordinary record page with New collection… under it; Activity and
 * Sources are pages, no collection; every other kind is the ordinary browse and record page, kept inside the tab
 * (`RouteBase`), a ui-view's record page carrying its module picker.
 *
 * THE MODULE SCOPE (`?module=<id>`, `lib/module-scope.ts`): every count and list narrowed to `$module is <id>`, a
 * banner says so and its ✕ widens back. Sticky across a row opened from a narrowed list — the page remounts on
 * every path, so the scope lives in a module-level signal rather than component state.
 */
import { useEffect, useMemo } from "react"
import { listRecords } from "../api/client.ts"
import { RouteBase, useApp, useAsync, useSignal } from "../AppContext.tsx"
import { Browse } from "../browse/Browse.tsx"
import { Icon } from "../components/Icon.tsx"
import { moduleScopeFilter, nextModuleScope, withModuleScope } from "../lib/module-scope.ts"
import { queryOf, SCHEMA_BASE } from "../lib/route.ts"
import { schemaRail, splitSchemaRoute } from "../lib/schemaRail.ts"
import { signal } from "../lib/signal.ts"
import { sourcesKey } from "../lib/sources.ts"
import { schemaKindContext } from "../lib/vscode-context.ts"
import { RecordPage } from "../pages/RecordPage.tsx"
import { modulePageView } from "../lib/page-view.ts"
import { uiViews } from "../lib/uiViews.ts"
import { PageView } from "../pages/PageView.tsx"
import { ActivityPane } from "./ActivityPane.tsx"
import { DataModelDetail } from "./DataModelDetail.tsx"
import { DataModelList } from "./DataModelList.tsx"
import { ModuleCollections } from "./ModuleCollections.tsx"
import { ModuleList } from "./ModuleList.tsx"
import { SourcesPane } from "./SourcesPane.tsx"
import { useModules } from "./useModules.ts"
import { ViewModulePanel } from "./ViewModulePanel.tsx"
import { cx, error, iconButton } from "../styles/classes.ts"

/** One line of the rail: icon, label, count. (was dt-schema-kind, dt-schema-kind-label, dt-schema-kind-count) */
const kindRow =
  "flex items-center gap-2 px-2 py-[5px] border-0 rounded font-[inherit] text-[length:inherit] leading-[inherit] text-left cursor-pointer [&_.codicon]:text-fg-subtle"
const label = "flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap max-[640px]:hidden"

const ACTIVITY = "activity"
const SOURCES = "sources"
/** The rows that are pages, not collections: no count, no schema gesture. */
const PAGE_KINDS = new Set([ACTIVITY, SOURCES])

/** The scope survives the remount a navigation inside the tab causes. */
const scopeMemory = signal<string | undefined>(undefined)

export function SchemaTab({ tail }: { tail: string }) {
  const { schema, route, navigate, version } = useApp()
  const query = queryOf(route)
  const selection = splitSchemaRoute(tail)
  const scope = nextModuleScope(scopeMemory.get(), query["module"], selection.id !== null)
  useEffect(() => scopeMemory.set(scope), [scope])
  const { modules } = useModules()
  const scopeTitle = modules.find(m => m.id === scope)?.title ?? scope
  const scopeFilter = useMemo(() => (scope ? moduleScopeFilter(scope) : undefined), [scope])

  const kinds = useMemo(
    () => [
      { kind: ACTIVITY, title: "Activity", icon: "history" },
      ...schemaRail(schema.collections),
      { kind: SOURCES, title: "Sources", icon: "layers" },
    ],
    [schema.collections]
  )
  const countKinds = kinds.filter(k => !PAGE_KINDS.has(k.kind)).map(k => k.kind)
  /** One cheap `limit=1` read per kind — the total rides on the list answer; an unreadable kind shows nothing. */
  const counts = useAsync(async () => {
    const pairs = await Promise.all(
      countKinds.map(async kind => {
        try {
          return [
            kind,
            (await listRecords(kind, { limit: 1, ...(scopeFilter ? { filter: scopeFilter } : {}) })).total,
          ] as const
        } catch {
          return [kind, -1] as const
        }
      })
    )
    return Object.fromEntries(pairs.filter(([, n]) => n >= 0)) as Record<string, number>
  }, [countKinds.join("\u0000"), scope, version])
  /** The ids a narrowed `collections` / `modules` list shows — those two are hand-drawn lists, not the browse. */
  const scoped = useAsync(async () => {
    if (!scope) return null
    const ids = async (kind: string) =>
      (
        await listRecords(kind, { limit: 1000, filter: moduleScopeFilter(scope) }).catch(() => ({ records: [] }))
      ).records.map(r => String(r.id))
    return { collections: await ids("collections"), modules: await ids("modules") }
  }, [scope, version])

  const select = (kind: string) => navigate(withModuleScope(`${SCHEMA_BASE}/${kind}`, scope))

  return (
    <div className="grid grid-cols-[minmax(170px,210px)_1fr] min-h-full max-[640px]:grid-cols-[40px_1fr]">
      <nav className="flex flex-col gap-px py-2.5 px-1.5 border-r border-border bg-bg-subtle" aria-label="Schema kinds">
        {scope && (
          <div
            className="flex items-center gap-1.5 mb-1.5 py-1 pr-1 pl-2 rounded-dt bg-bg-active"
            title={`Showing only what belongs to ${scope}`}
          >
            <Icon name="filter" />
            <span className={cx(label, "font-semibold")}>{scopeTitle}</span>
            <button
              type="button"
              className={iconButton}
              title="Show the whole schema"
              onClick={() => {
                scopeMemory.set(undefined)
                navigate(`${SCHEMA_BASE}/${selection.kind}`)
              }}
            >
              <Icon name="close" />
            </button>
          </div>
        )}
        {kinds.map(row => (
          <button
            key={row.kind}
            type="button"
            className={cx(
              kindRow,
              row.kind === selection.kind
                ? "bg-bg-active text-fg-active font-semibold"
                : "bg-transparent text-fg hover:bg-bg-hover"
            )}
            data-kind={row.kind}
            data-vscode-context={schemaKindContext(row.kind)}
            title={row.title}
            onClick={() => select(row.kind)}
          >
            <Icon name={row.icon} />
            <span className={label}>{row.title}</span>
            {counts.data?.[row.kind] !== undefined && (
              <span className="text-fg-subtle tabular-nums text-small max-[640px]:hidden">{counts.data[row.kind]}</span>
            )}
          </button>
        ))}
      </nav>
      <section
        className="min-w-0"
        data-vscode-context={PAGE_KINDS.has(selection.kind) ? undefined : schemaKindContext(selection.kind)}
      >
        <RouteBase.Provider value={SCHEMA_BASE}>
          <Pane
            kind={selection.kind}
            id={selection.id}
            scope={scope}
            scopeTitle={scopeTitle}
            scopeFilter={scopeFilter}
            only={scoped.data ?? null}
            field={query["field"]}
            source={query["source"]}
          />
        </RouteBase.Provider>
      </section>
    </div>
  )
}

function Pane({
  kind,
  id,
  scope,
  scopeTitle,
  scopeFilter,
  only,
  field,
  source,
}: {
  kind: string
  id: string | null
  scope?: string
  scopeTitle?: string
  scopeFilter?: Record<string, unknown>
  only: { collections: string[]; modules: string[] } | null
  field?: string
  source?: string
}) {
  const { schema } = useApp()
  const views = useSignal(uiViews) ?? []
  if (kind === ACTIVITY) {
    // a module's page: the page view naming it when one does (the nearest wins), else its Activity
    const page = scope ? modulePageView(views, scope) : undefined
    if (page) return <PageView key={`${page.id}:${source ?? ""}`} viewId={page.id} source={source} />
    return (
      <ActivityPane key={`${scope ?? ""}:${source ?? ""}`} module={scope} moduleTitle={scopeTitle} source={source} />
    )
  }
  if (kind === SOURCES) return <SourcesPane />
  if (kind === "collections") {
    if (id) return <DataModelDetail key={id} collection={id} openField={field} />
    return <DataModelList only={scope ? (only?.collections ?? []) : null} />
  }
  if (kind === "modules" && !id) return <ModuleList only={scope ? (only?.modules ?? []) : null} />
  const row = schema.collection(kind)
  if (!row) return <p className={error}>No schema kind {kind} in this workspace.</p>
  if (id === "+") return <RecordPage key={`${kind}:+`} collection={kind} id={null} />
  if (id)
    return (
      <RecordPage
        key={`${kind}:${id}`}
        collection={kind}
        id={id}
        after={
          kind === "modules" ? (
            <ModuleCollections moduleId={id} />
          ) : kind === "ui-views" ? (
            <ViewModulePanel viewId={id} />
          ) : undefined
        }
      />
    )
  return (
    <Browse
      key={`${kind}::${scope ?? ""}::${JSON.stringify(row.list)}::${sourcesKey(row)}`}
      collection={kind}
      config={scopeFilter ? { scopeFilter } : {}}
    />
  )
}
