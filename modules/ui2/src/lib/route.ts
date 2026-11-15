/**
 * ROUTES — the same paths @dreamteamer/ui answers, so a host's `dt:navigate` and a nav row's `route` mean the
 * same page in either app:
 *
 *   /content/<collection>          the collection's list
 *   /content/<collection>/<id>     one record (ids may hold `/`)
 *   /content/<collection>/+        a new record
 *
 * A collection name may hold `/` too (`lab/samples`), so the split is resolved against the collections the
 * workspace has, longest name first — `resolveContentPath`, copied from @dreamteamer/ui's lib/content-path.ts.
 *   /<a ui-view's route>           a collection-scope ui-view (`/projects-board`): the collection's browse,
 *                                  seeded from the view
 *
 * Any other path (record and page views, settings, module apps) is a page this app does not draw yet. A query
 * (`?filter=…`) rides on any of them and never changes which page it is.
 */

export interface ResolvedContentPath {
  collection: string | null
  id: string | null
  create: boolean
}

export function resolveContentPath(rawPath: string, collections: readonly string[]): ResolvedContentPath {
  const registered = new Set(collections)
  const segments = rawPath
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
  for (let take = segments.length; take >= 1; take--) {
    const candidate = segments.slice(0, take).join("/")
    if (!registered.has(candidate)) continue
    const remainder = segments.slice(take)
    if (remainder.length === 0) return { collection: candidate, id: null, create: false }
    if (remainder.length === 1 && remainder[0] === "+") return { collection: candidate, id: null, create: true }
    return { collection: candidate, id: remainder.join("/"), create: false }
  }
  return { collection: null, id: null, create: false }
}

export type Page =
  | { kind: "home" }
  | { kind: "list"; collection: string }
  | { kind: "record"; collection: string; id: string; viewId?: string }
  | { kind: "create"; collection: string }
  | { kind: "view"; id: string }
  | { kind: "unknown-collection"; path: string }
  | { kind: "unsupported"; route: string }

/** What `pageOf` needs to know of a ui-view. */
export interface ViewRoute {
  id: string
  route: string
  scope: string
  /** `collections/<name>` — a record-scope view's records are this collection's. */
  collection?: string
}

/** The page a route names, given the workspace's collection names and its ui-views. */
export function pageOf(route: string, collections: readonly string[], views: readonly ViewRoute[] = []): Page {
  const path = pathOf(route)
  if (path === "/" || path === "/content" || path === "/content/") return { kind: "home" }
  if (!path.startsWith("/content/")) {
    const trimmed = path.replace(/\/+$/, "")
    const view = views.find(v => v.scope === "collection" && v.route === trimmed)
    if (view) return { kind: "view", id: view.id }
    // a record-scope view answers `<route>/<id>`: its collection's record, drawn by the view's `display.record`
    const recordView = views.find(
      v =>
        v.scope === "record" && v.collection && trimmed.startsWith(`${v.route}/`) && trimmed.length > v.route.length + 1
    )
    if (recordView && collections.includes(recordView.collection!.replace(/^collections\//, "")))
      return {
        kind: "record",
        collection: recordView.collection!.replace(/^collections\//, ""),
        id: decodeURIComponent(trimmed.slice(recordView.route.length + 1)),
        viewId: recordView.id,
      }
    return { kind: "unsupported", route }
  }
  const rest = decodeURIComponent(path.slice("/content/".length))
  const r = resolveContentPath(rest, collections)
  if (!r.collection) return { kind: "unknown-collection", path: rest }
  if (r.create) return { kind: "create", collection: r.collection }
  if (r.id) return { kind: "record", collection: r.collection, id: r.id }
  return { kind: "list", collection: r.collection }
}

export const listRoute = (collection: string) => `/content/${collection}`
export const recordRoute = (collection: string, id: string) => `/content/${collection}/${id}`
export const createRoute = (collection: string) => `/content/${collection}/+`

/** The path of a route, without its query. */
export const pathOf = (route: string): string => route.split("?")[0] || "/"

/** A route's query as plain pairs (`?filter=…&layout=table`). */
export function queryOf(route: string): Record<string, string> {
  const i = route.indexOf("?")
  if (i < 0) return {}
  return Object.fromEntries(new URLSearchParams(route.slice(i + 1)))
}

/** `path` with `query`'s non-empty pairs, in a stable order. */
export function withQuery(path: string, query: Record<string, string | undefined | null>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `${path}?${s}` : path
}
