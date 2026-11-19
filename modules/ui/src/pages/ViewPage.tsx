/**
 * A NAMED UI-VIEW — a `scope: collection` view at its own route (`/projects-board`): the collection's browse seeded
 * from the view's `display.list` as compile merged it (layout, columns, sort, layout options), its filter
 * decompiled into editable conditions, and its nav title as the page title (ported from the Vue ui's
 * UiViewPage.vue). Save in Layout options writes back to this record.
 *
 * The view is looked up LIVE in the view table, and the browse is keyed on a fingerprint of it: the browse reads
 * its config once, so a record edited or compiled after the page opened reaches the screen through a remount.
 */
import { useApp, useSignal } from "../AppContext.tsx"
import { Browse } from "../browse/Browse.tsx"
import { sourcesKey } from "../lib/sources.ts"
import { collectionOf, drawnDisplay, uiViewFingerprint, uiViews, viewLabel, viewToConfig } from "../lib/uiViews.ts"
import { cx, error, page, subtle } from "../styles/classes.ts"

export function ViewPage({ id }: { id: string }) {
  const { schema } = useApp()
  const view = (useSignal(uiViews) ?? []).find(v => v.id === id)
  if (!view) return <p className={cx(page, subtle)}>ui-view {id} no longer exists.</p>
  const collection = collectionOf(view)
  if (!collection || !schema.collection(collection))
    return <p className={error}>ui-view {id} names no collection of this workspace.</p>
  const config = viewToConfig(view)
  return (
    <Browse
      key={`${uiViewFingerprint(view)}::${sourcesKey(schema.collection(collection))}`}
      collection={collection}
      config={{ ...config, baseFilter: config.filter }}
      title={viewLabel(view)}
      viewOptions={drawnDisplay(view).list?.options}
    />
  )
}
