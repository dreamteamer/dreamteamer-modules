/**
 * LEAVING A PAGE WITH UNSAVED CHANGES — the record page registers a guard while its draft is dirty, and the app
 * asks it before it moves to another path (an in-app link, the nav, the host's `dt:navigate`); the browser's own
 * `beforeunload` covers closing the tab. the Vue ui's record page does the same with vue-router's `onBeforeRouteLeave`.
 *
 * One guard at a time: there is one page. A change of query alone (`?filter=` on a browse) is not leaving.
 */
import { pathOf } from "./createRoute.ts"

type Guard = () => boolean

let current: Guard | null = null

/** Install `guard` (true = may leave); returns the uninstall, which removes only this guard. */
export function setLeaveGuard(guard: Guard): () => void {
  current = guard
  return () => {
    if (current === guard) current = null
  }
}

/** Whether the app may move from `from` to `to`: a query-only move always may; otherwise the guard decides. */
export function mayLeave(from: string, to: string): boolean {
  if (pathOf(from) === pathOf(to)) return true
  return current ? current() : true
}
