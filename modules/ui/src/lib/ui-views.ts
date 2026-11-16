/**
 * THE WORKSPACE'S UI-VIEWS — the compiled `ui-views` records, read once per invalidation, and what a browse
 * needs to know about one (ported from the Vue ui's ui-views.ts and composables/collection-views.ts).
 *
 * A collection's DEFAULT view is its own `display.list`, which a bare `/content/<collection>` renders; a
 * `ui-view` record is a NAMED variant carrying the same block at its own `route` (`/projects-board`), which
 * compile merges over the collection's (`compiled.display`). So a view page is the collection's browse seeded
 * from the view: its layout, columns, sort, layout options and filter — `viewToConfig` is the one place that
 * splits a view's `display.list` into those, so the view page and anything embedding a view cannot disagree.
 *
 * Unlike ui, nothing here registers routes: `lib/route.ts#pageOf` is handed the views and resolves a path to
 * one. the Vue ui's `@me` resolution is gone with the `users` collection (compile refuses a filter holding it).
 */
import { request } from "../api/client.ts"
import { signal } from "./signal.ts"

/** A view's `display` — the collection's sub-blocks, with `nav.title` because a view has no descriptor title of
 *  its own. */
export interface ViewDisplay {
  nav?: { title?: string; icon?: string; order?: number }
  list?: { layout?: string; columns?: string[]; sort?: string; options?: Record<string, unknown> }
  record?: { layout?: string; subtitle?: string; badge?: string; color_by?: string; options?: Record<string, unknown> }
  form?: { sections?: Array<{ title: string; fields: string[] }> }
}

export interface UiViewRecord {
  id: string
  name?: string
  title?: string
  description?: string
  /** The path the view renders at, starting with /. */
  route: string
  scope: "record" | "collection" | "page"
  /** Qualified ref `collections/<name>`; a page may omit it. */
  collection?: string
  filter?: Record<string, unknown>
  /** What the view changes from its collection's display — what a write sends back. */
  display?: ViewDisplay
  /** Compile's: the view's display merged over its collection's — what a surface draws. */
  compiled?: { display?: ViewDisplay }
  $module?: string
  "$source-kind"?: string
}

/** Everything a browse needs in order to render a view. */
export interface ViewConfig {
  /** The record this came from — what Save writes back to. */
  viewId?: string
  layout?: string
  columns?: string[]
  sort?: string
  filter?: Record<string, unknown>
  /** Per-layout declared options, keyed by list id. */
  listOptions?: Record<string, Record<string, unknown>>
}

/** What a view draws: compile's merge, else what it authored (a view read before a compile). */
export function drawnDisplay(view: UiViewRecord): ViewDisplay {
  return view.compiled?.display ?? view.display ?? {}
}

/** What a view is called wherever it is listed: its nav title, else its own title, else its id. */
export function viewLabel(view: UiViewRecord): string {
  return view.display?.nav?.title ?? drawnDisplay(view).nav?.title ?? view.title ?? view.name ?? view.id
}

/** Strip the qualified `collections/` prefix off a view's collection ref. */
export function collectionOf(view: UiViewRecord): string {
  return (view.collection ?? "").replace(/^collections\//, "")
}

/**
 * A view key that must be a list of strings (`display.list.columns`). A comma string is split and honoured;
 * any other unusable shape is ignored with a warning naming the view and the key — answering `undefined`
 * silently would read exactly like "this view configures no columns".
 */
function stringArray(raw: unknown, viewId: string, key: string): string[] | undefined {
  const where = `[ui-views] view '${viewId}': display.list.${key}`
  if (Array.isArray(raw)) {
    const strings = raw.filter((c): c is string => typeof c === "string")
    if (strings.length !== raw.length) console.warn(`${where} has entries that are not strings — ignoring them.`)
    return strings
  }
  if (typeof raw === "string") {
    const split = raw
      .split(",")
      .map(c => c.trim())
      .filter(Boolean)
    console.warn(`${where} is a comma string, not a list — reading it as ${JSON.stringify(split)}.`)
    return split.length ? split : undefined
  }
  if (raw !== undefined && raw !== null) console.warn(`${where} is a ${typeof raw}, not a list — ignoring it.`)
  return undefined
}

/**
 * A view's `display.list` — as compile merged it over its collection's — split into what the browse consumes.
 * A view pins ONE layout, so its `options` are that layout's. `sort: ''` is kept: it means explicitly unsorted.
 */
export function viewToConfig(view: UiViewRecord): ViewConfig {
  const { layout, columns, sort, options } = (drawnDisplay(view).list ?? {}) as Record<string, unknown>
  // a present-but-unusable sort reads exactly like an absent one, so it says so rather than vanishing
  if (typeof sort !== "string" && sort !== undefined && sort !== null)
    console.warn(`[ui-views] view '${view.id}': display.list.sort is a ${typeof sort}, not a string — ignoring it.`)
  const pinned = typeof layout === "string" && layout ? layout : undefined
  const opts =
    options && typeof options === "object" && !Array.isArray(options) ? (options as Record<string, unknown>) : {}
  return {
    viewId: view.id,
    layout: pinned,
    columns: stringArray(columns, view.id, "columns"),
    sort: typeof sort === "string" ? sort : undefined,
    filter: view.filter,
    listOptions: pinned && Object.keys(opts).length ? { [pinned]: { ...opts } } : {},
  }
}

/**
 * Everything about a view that a mounted browse consumed when it started — the browse reads its config once, so
 * a changed record reaches the screen only through a remount, and this string is the key that forces one (and,
 * stable by value, forces none for an unchanged record).
 */
export function uiViewFingerprint(view: UiViewRecord | undefined): string {
  return view ? JSON.stringify([view.id, drawnDisplay(view), view.filter ?? null]) : "none"
}

/** The collection-scope view a path names, or undefined. A trailing slash is not a different view. */
export function viewAt(views: readonly UiViewRecord[], path: string): UiViewRecord | undefined {
  const p = path.replace(/\/+$/, "") || "/"
  return views.find(v => v.scope === "collection" && typeof v.route === "string" && v.route === p)
}

// ---- the table, shared ----------------------------------------------------------------------------------

/** The compiled view table; null until the first read answers. */
export const uiViews = signal<UiViewRecord[] | null>(null)

let lastSignature = ""

/** Read the view table. An unchanged table leaves the signal alone, so nothing re-renders; a failed read keeps
 *  what was there (or an empty table on the first read) — a broken view table never blanks the app. */
export async function loadUiViews(): Promise<void> {
  try {
    const json = (await request("GET", "/collections/ui-views/records?limit=200")) as { records?: UiViewRecord[] }
    const views = Array.isArray(json?.records) ? json.records : []
    const signature = JSON.stringify(views)
    if (signature === lastSignature && uiViews.get() !== null) return
    lastSignature = signature
    uiViews.set(views)
  } catch (err) {
    console.warn("[ui-views] could not read ui-views — continuing without them", err)
    if (uiViews.get() === null) uiViews.set([])
  }
}
