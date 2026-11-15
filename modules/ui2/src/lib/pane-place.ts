/**
 * Where the page is, in the four shapes the server stores (cr-modules-017 §5): `{ collection }`, `{ collection, id }`,
 * `{ uiView }` — and `{ other: true }` for everything else (home, a module app, settings), so a page outside the three
 * view shapes still reports that it is somewhere. Ported from @dreamteamer/ui's lib/pane-place.ts, over ui2's `Page`
 * (lib/route.ts `pageOf`) instead of a vue-router route: pageOf already split the path at the LONGEST registered
 * collection, so a namespaced collection (`rnd/change-requests`) and an id with slashes (`2026/11/standup`) arrive
 * whole.
 */
import type { Page } from "./route.ts"
import { signal } from "./signal.ts"

/** The place a page reports — copied from @dreamteamer/protocol `pane.d.ts` (ui2 takes no protocol dependency). */
export type PaneView =
  { collection: string } | { collection: string; id: string } | { uiView: string } | { other: true }

/** The browse on screen writes its ticked rows here; the reporter sends them. */
export const pageSelection = signal<{ collection: string; ids: string[] } | null>(null)
/** The chat's push (`dt:select`), held until the list of its collection applies it. */
export const pushedSelection = signal<{ refs: string[]; at: number } | null>(null)

/** `{ collection, id }` of a reference, split at the end of the longest registered collection; null when none. */
export function splitPaneRef(ref: string, collections: readonly string[]): { collection: string; id: string } | null {
  const norm = ref.replace(/^\/+/, "")
  for (const c of [...collections].sort((a, b) => b.length - a.length)) {
    if (norm.startsWith(c + "/") && norm.length > c.length + 1) return { collection: c, id: norm.slice(c.length + 1) }
  }
  return null
}

export function placeOf(page: Page): PaneView {
  switch (page.kind) {
    case "list":
    case "create": // the create page is the collection
      return { collection: page.collection }
    case "record":
      // a record-scope ui-view's page is the view, as ui's `ui-view:<id>` route names it
      return page.viewId ? { uiView: page.viewId } : { collection: page.collection, id: page.id }
    case "view":
      return { uiView: page.id }
    default:
      return { other: true }
  }
}

/** The ids of `collection` among pushed refs: null when the push is for another collection (leave it held), `[]`
 *  for a push that clears. */
export function pushedIds(push: { refs: string[] }, collection: string): string[] | null {
  const prefix = collection + "/"
  const mine = push.refs.filter(r => r.startsWith(prefix)).map(r => r.slice(prefix.length))
  return push.refs.length && !mine.length ? null : mine
}
