/**
 * A COLLECTION'S LIST — `/content/<collection>`: the browse over the collection's own `display.list` (its layout,
 * columns, sort and layout options), with search, filters, grouping and saved views (`browse/Browse.tsx`).
 *
 * Keyed on what the browse consumed when it started — the collection, its list block and the sources it reads —
 * so a display saved, compiled or a layer installed after the page opened reaches the screen by a remount.
 */
import { useApp } from "../app-context.tsx"
import { Browse } from "../browse/Browse.tsx"
import { sourcesKey } from "../lib/sources.ts"

export function ListPage({ collection }: { collection: string }) {
  const { schema } = useApp()
  const row = schema.collection(collection)
  return (
    <Browse key={`${collection}::${JSON.stringify(row?.list ?? null)}::${sourcesKey(row)}`} collection={collection} />
  )
}
