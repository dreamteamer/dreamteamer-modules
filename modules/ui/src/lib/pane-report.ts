/**
 * THE PAGE'S REPORT TO THE CHAT (cr-modules-017 §5) — on a pane host only (reading 3). 200 ms after the last place or
 * selection change, one `PUT /selection { view, refs }`: the place in one of the four shapes and the ticked rows as
 * `<collection>/<id>`, at most 50 (a larger selection sends the first 50). Sent at every level — a Read pane reports
 * too. A refusal (a 400 for a record deleted between the tick and the put) is dropped silently: the next change
 * reports again.
 *
 * And the chat's push back: `dt:select { refs }` ticks those rows — App calls `receiveSelect`, which holds the refs
 * for the list of their collection and, when that collection is not the one on screen, goes there first.
 *
 * Ported from the Vue ui's composables/pane-report.ts; Vue's `watch` is a signal subscription, so it runs in
 * Node's test runner as is.
 */
import type { Signal } from "./signal.ts"
import { listRoute } from "./createRoute.ts"
import { pageSelection, pushedSelection, splitPaneRef, type PaneView } from "./pane-place.ts"

export const MAX_REPORTED = 50

type Request = (method: string, path: string, body?: unknown) => Promise<unknown>

export function startPaneReport(o: {
  /** The page's place; App sets it on every route change. */
  place: Signal<PaneView>
  request: Request
  selection?: Signal<{ collection: string; ids: string[] } | null>
  debounceMs?: number
}): () => void {
  const selection = o.selection ?? pageSelection
  const delay = o.debounceMs ?? 200
  let timer: ReturnType<typeof setTimeout> | null = null
  const send = (): void => {
    timer = null
    const sel = selection.get()
    const refs = sel ? sel.ids.slice(0, MAX_REPORTED).map(id => `${sel.collection}/${id}`) : []
    o.request("PUT", "/selection", { view: o.place.get(), refs }).catch(() => {
      /* a 400 is dropped */
    })
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(send, delay)
  }
  const offPlace = o.place.subscribe(schedule)
  const offSelection = selection.subscribe(schedule)
  schedule()
  return () => {
    offPlace()
    offSelection()
    if (timer) clearTimeout(timer)
    timer = null
  }
}

/** `dt:select { refs }` from the server: hold them for the list of their collection; go there first when it is not
 *  the one on screen. `[]` clears whatever is ticked. */
export function receiveSelect(
  refs: unknown,
  o: { collections: readonly string[]; here: PaneView; navigate: (route: string) => void }
): void {
  const list = Array.isArray(refs) ? refs.filter((r): r is string => typeof r === "string") : []
  pushedSelection.set({ refs: list, at: Date.now() })
  if (!list.length) return
  const target = splitPaneRef(list[0]!, o.collections)?.collection
  if (!target) return
  if ("collection" in o.here && o.here.collection === target && !("id" in o.here)) return
  o.navigate(listRoute(target))
}
