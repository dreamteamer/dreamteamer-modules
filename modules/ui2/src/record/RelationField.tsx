/**
 * A RELATION FIELD ON A RECORD PAGE, DRAWN AS THE TARGET COLLECTION'S OWN VIEW (ported from @dreamteamer/ui's
 * RelationField.vue): a project's 52 tasks as the tasks TABLE — the same columns, sort, layout and page size
 * the tasks browse draws — scoped to exactly those records, instead of 52 comma-separated links.
 *
 * It renders the real Browse, embedded (`BrowseConfig.embedded`): the layout registry, the column resolution,
 * grouping and server-side paging all run, so a view pinned to the board draws a board. The ids are SCOPE, not
 * a filter: applied under everything, never an editable rule. A named view's own filter is dropped on purpose —
 * the relation already narrows (`lib/relation-view.ts`).
 *
 * Keyed on the view record and the set of ids: the browse reads its config once, so a relation that gains a
 * member while the page is open reaches the screen through a remount; an unchanged one re-renders nothing.
 */
import { Browse } from "../browse/Browse.tsx"
import type { EmbeddedRelationPlan } from "../lib/relation-view.ts"
import { drawnDisplay, uiViewFingerprint, viewToConfig } from "../lib/ui-views.ts"

export function RelationField({ plan }: { plan: EmbeddedRelationPlan }) {
  const config = plan.view ? viewToConfig(plan.view) : undefined
  const key = JSON.stringify([plan.view ? uiViewFingerprint(plan.view) : null, plan.ids])
  return (
    <Browse
      key={key}
      collection={plan.collection}
      config={{
        layout: config?.layout,
        columns: config?.columns,
        sort: config?.sort,
        listOptions: config?.listOptions,
        viewId: plan.view?.id,
        baseFilter: plan.filter,
        embedded: true,
      }}
      viewOptions={plan.view ? drawnDisplay(plan.view).list?.options : undefined}
    />
  )
}
