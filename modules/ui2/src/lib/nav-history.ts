/**
 * BACK AND FORWARD for the app's own history (ported from @dreamteamer/ui's composables/nav-history.ts, the
 * operator's 2026-07-29 ask: Obsidian's ← → in the header). The app owns its route — there is no address bar in a
 * webview, and a browser tab's hash belongs to the host — so the arrows are ours, and so is knowing whether they
 * are live.
 *
 * A browser's rule: a new place truncates whatever was ahead. ONE difference from ui: a move that keeps the PATH
 * and changes only the query (the browse writes `?filter=`/`?search=` back as they change) REPLACES the entry
 * rather than adding one — ui's router.replace did the same — so Back leaves the list, not the last keystroke, and
 * comes back to the list as it was left.
 */
import { signal } from "./signal.ts"

export interface HistoryState {
  entries: string[]
  at: number
}

const pathOf = (route: string) => route.split("?")[0]!

/** The history after visiting `route` from the current entry. */
export function visit(h: HistoryState, route: string): HistoryState {
  const here = h.entries[h.at]
  if (here === route) return h
  if (here !== undefined && pathOf(here) === pathOf(route)) {
    const entries = [...h.entries]
    entries[h.at] = route
    return { entries, at: h.at }
  }
  const entries = [...h.entries.slice(0, h.at + 1), route]
  return { entries, at: entries.length - 1 }
}

/** The route `delta` steps away (−1 back, +1 forward), or null when there is none. */
export function peek(h: HistoryState, delta: number): string | null {
  return h.entries[h.at + delta] ?? null
}

/** The history moved `delta` steps — only where `peek` found an entry. */
export function step(h: HistoryState, delta: number): HistoryState {
  return peek(h, delta) === null ? h : { entries: h.entries, at: h.at + delta }
}

export const canBack = (h: HistoryState) => h.at > 0
export const canForward = (h: HistoryState) => h.at < h.entries.length - 1

/** The app's one history; App writes it, the nav toolbar's arrows read it. */
export const navHistory = signal<HistoryState>({ entries: [], at: -1 })
