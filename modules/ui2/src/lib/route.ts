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
 * Any other path (ui-views, settings, module apps) is a page this app does not draw yet.
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
  | { kind: "record"; collection: string; id: string }
  | { kind: "create"; collection: string }
  | { kind: "unknown-collection"; path: string }
  | { kind: "unsupported"; route: string }

/** The page a route names, given the workspace's collection names. */
export function pageOf(route: string, collections: readonly string[]): Page {
  const path = route.split("?")[0] || "/"
  if (path === "/" || path === "/content" || path === "/content/") return { kind: "home" }
  if (!path.startsWith("/content/")) return { kind: "unsupported", route }
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
