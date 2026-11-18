/**
 * A PAGE ui-view (ported from the Vue ui's pages/UiPageView.vue) — a `scope: page` view this app draws itself:
 * layout `page`, which NESTS other ui-views as panels (dashboards are nested ui-views, not a panel vocabulary), or
 * `activity`, a module's feed. Reached at the view's own route (`lib/createRoute.ts` → `{ kind: "page-view" }`), and from
 * the Schema tab as a module's page when a page view names that module (`modulePageView`).
 *
 * What it draws is decided by lib/pageView.ts (pure): one panel per entry of `display.list.options.views`, in a
 * grid of `options.grid_columns` (1 or 2). Each panel IS the child view — a collection view through the embedded
 * browse in its own layout (table, board, cards, counts…), an activity view through ActivityPane, a nested PAGE as
 * a grid of its own panels with no frame. A framed panel's title links to the child's full view. A reference to no
 * view, a cycle, or a child a panel cannot draw is refused IN ITS PANEL, by its reference — never a blank page,
 * never its siblings taken down.
 *
 * `source` (`?source=`) scopes the whole page to one record layer: every collection panel is narrowed by
 * `$source is <layer>` as SCOPE (no removable rule), the activity reads only that layer, and every link out carries
 * the scope as an ordinary rule (`PageSource`, read by the counts layout).
 *
 * The view is looked up LIVE by id, and each embedded browse is keyed on its child's fingerprint: a browse reads its
 * config once, so an edited child reaches the screen through a remount.
 */
import { useSignal } from "../AppContext.tsx"
import { Browse } from "../browse/Browse.tsx"
import { Icon } from "../components/Icon.tsx"
import { Link } from "../components/Link.tsx"
import { SourceMark } from "../components/SourceMark.tsx"
import {
  ACTIVITY_LAYOUT,
  gridColumns,
  listLayout,
  listOptionsOf,
  pageOrigin,
  pagePanels,
  panelLink,
  scopedFilter,
  type PanelPlan,
} from "../lib/pageView.ts"
import {
  collectionOf,
  drawnDisplay,
  uiViewFingerprint,
  uiViews,
  viewLabel,
  viewToConfig,
  type UiViewRecord,
} from "../lib/uiViews.ts"
import { ActivityPane } from "../settings/ActivityPane.tsx"
import { useModules } from "../settings/useModules.ts"
import { PageSource } from "./PageSource.ts"
import { cx, listEmpty, page, pageHead, pageHeadSpace, subtle } from "../styles/classes.ts"

/** A panel's title: plain text, or a link that reads as one until hovered. (was dt-panel-title) */
const panelTitle = "font-semibold text-fg no-underline"

export function PageView({
  viewId,
  source,
  nested = false,
  ancestry = [],
}: {
  viewId: string
  /** A record layer the page is scoped to — `$source is <layer>` on every panel. */
  source?: string | undefined
  /** Drawn inside another page: no heading, no page padding — the grid alone. */
  nested?: boolean
  /** The ids of the pages above this one, outermost first — what a cycle is detected against. */
  ancestry?: string[]
}) {
  const views = useSignal(uiViews) ?? []
  const { modules } = useModules()
  const view = views.find(v => v.id === viewId)
  if (!view)
    return (
      <div className={listEmpty}>
        <Icon name="dashboard" />
        <p>ui-view {viewId} no longer exists.</p>
      </div>
    )
  const layout = listLayout(view)
  if (layout === ACTIVITY_LAYOUT && !nested) {
    const m = listOptionsOf(view)["module"]
    const module = typeof m === "string" && m ? m : undefined
    // the module's own title — "Commits to Northwind CRM", never the view's title
    const title = modules.find(x => x.id === module)?.title || module
    return (
      <ActivityPane
        {...(module ? { module } : {})}
        {...(title ? { moduleTitle: title } : {})}
        {...(source ? { source } : {})}
      />
    )
  }
  const panels = pagePanels(view, views, ancestry)
  const columns = gridColumns(view)

  const grid = !panels.length ? (
    <p className={subtle}>
      This page nests no views yet — list them in <code>display.list.options.views</code>.
    </p>
  ) : (
    <div
      className="grid gap-4 items-start"
      data-columns={columns}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {panels.map((p, i) =>
        p.kind === "page" ? (
          <div key={`${i}:${p.ref}`} className="min-w-0">
            <PageView viewId={p.view.id} source={source} nested ancestry={[...ancestry, view.id]} />
          </div>
        ) : (
          <Panel key={`${i}:${p.ref}`} plan={p} source={source} />
        )
      )}
    </div>
  )

  return (
    <PageSource.Provider value={source}>
      {nested ? (
        grid
      ) : (
        <div className={cx(page, "overflow-y-auto")} data-view={view.id}>
          <header className={cx(pageHead, pageHeadSpace.page)}>
            <div>
              <h1>{viewLabel(view)}</h1>
              {view.description && <p className={subtle}>{view.description}</p>}
              {source && (
                <p className={subtle}>
                  Records from <SourceMark name={source} />
                </p>
              )}
              <p
                className={subtle}
                title="The page view drawn here — the nearest one naming this module wins: the workspace's own, then a layer's, then a package's"
              >
                {pageOrigin(view)}
              </p>
            </div>
          </header>
          {grid}
        </div>
      )}
    </PageSource.Provider>
  )
}

function Panel({ plan, source }: { plan: Exclude<PanelPlan, { kind: "page" }>; source: string | undefined }) {
  return (
    <section
      className="min-w-0 flex flex-col gap-2 p-3 border border-border rounded"
      data-ref={plan.ref}
      data-kind={plan.kind}
    >
      <header className="flex items-center gap-2">
        {plan.kind === "refused" ? (
          <span className={panelTitle}>{plan.ref}</span>
        ) : (
          <Link
            to={panelLink(plan.view, source)}
            className={cx(panelTitle, "hover:text-link hover:underline")}
            title={`Open ${viewLabel(plan.view)}`}
          >
            {viewLabel(plan.view)}
          </Link>
        )}
      </header>
      {plan.kind === "refused" ? (
        <p className="m-0 flex items-center gap-1.5 text-warning">
          <Icon name="warning" /> {plan.reason}
        </p>
      ) : plan.kind === "activity" ? (
        <ActivityPane {...(plan.module ? { module: plan.module } : {})} source={source} embedded />
      ) : (
        <PanelBrowse view={plan.view} source={source} />
      )}
    </section>
  )
}

/** A collection child, as the embedded browse needs it — the page's scope applied under its own filter. */
function PanelBrowse({ view, source }: { view: UiViewRecord; source: string | undefined }) {
  const config = viewToConfig(view)
  const collection = collectionOf(view)
  const baseFilter = scopedFilter(view.filter, source)
  return (
    <Browse
      key={`${uiViewFingerprint(view)}::${source ?? ""}`}
      collection={collection}
      config={{ ...config, embedded: true, ...(baseFilter ? { baseFilter } : {}) }}
      title={viewLabel(view)}
      viewOptions={drawnDisplay(view).list?.options}
    />
  )
}
