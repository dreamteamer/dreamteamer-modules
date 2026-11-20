/**
 * ROUTES — the same paths the Vue ui answers, so a host's `dt:navigate` and a nav row's `route` mean the
 * same page in either app:
 *
 *   /content/<collection>          the collection's list
 *   /content/<collection>/<id>     one record (ids may hold `/`)
 *   /content/<collection>/+        a new record
 *
 * A collection name may hold `/` too (`lab/samples`), so the split is resolved against the collections the
 * workspace has, longest name first — `resolveContentPath`, copied from the Vue ui's lib/content-path.ts.
 *   /settings/schema[/<kind>[/<id>]]  the Schema tab (settings/SchemaTab.tsx): `/settings/data-model[/<name>]`
 *                                  folds into `/settings/schema/collections[/<name>]`, its query kept
 *   /settings/system/<collection>[/<id>|/+]  a list or record kept under the settings prefix
 *   /<a ui-view's route>           a collection-scope ui-view (`/projects-board`): the collection's browse,
 *                                  seeded from the view
 *
 *   /<a page ui-view's route>      a `scope: page` view of layout `page` or `activity` (pages/PageView.tsx);
 *                                  `?source=<name>` scopes it to one source
 *
 *   /a/<app>[/…]                   a module app (modules/host.tsx frames it); `<app>` is the id it registered
 *   /<any other page view's route> a `scope: page` view whose layout NAMES a module app: that app's page, or a
 *                                  "not registered" line when no loaded module registered it
 *
 * Any other path is a page this app does not draw. A query (`?filter=…`) rides on any of them and never changes
 * which page it is.
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
  | { kind: "list"; collection: string; base?: string }
  | { kind: "record"; collection: string; id: string; viewId?: string; base?: string }
  | { kind: "create"; collection: string; base?: string }
  | { kind: "settings"; tail: string }
  | { kind: "view"; id: string }
  | { kind: "page-view"; id: string; source?: string }
  | { kind: "app"; id: string }
  | { kind: "app-page"; id: string; layout: string }
  | { kind: "unknown-collection"; path: string }
  | { kind: "unsupported"; route: string }

/** What `pageOf` needs to know of a ui-view. */
export interface ViewRoute {
  id: string
  route: string
  scope: string
  /** `collections/<name>` — a record-scope view's records are this collection's. */
  collection?: string
  /** What a page view draws — compile's merge, else what it authored: `list.layout` picks the page kind. */
  compiled?: { display?: { list?: { layout?: string } } }
  display?: { list?: { layout?: string } }
}

/** The page layouts this app draws itself (pages/PageView.tsx); any other page layout is a module's app. */
export const SURFACE_PAGE_LAYOUTS: ReadonlySet<string> = new Set(["page", "activity"])
const pageLayoutOf = (v: ViewRoute) => (v.compiled?.display ?? v.display)?.list?.layout ?? ""

/** The page a route names, given the workspace's collection names and its ui-views. */
export function pageOf(route: string, collections: readonly string[], views: readonly ViewRoute[] = []): Page {
  const path = pathOf(route)
  if (path === "/" || path === "/content" || path === "/content/") return { kind: "home" }
  const settings = settingsPage(path, collections)
  if (settings) return settings
  if (!path.startsWith("/content/")) {
    const trimmed = path.replace(/\/+$/, "")
    const app = /^\/a\/([^/]+)(?:\/|$)/.exec(trimmed)
    if (app) return { kind: "app", id: decodeURIComponent(app[1]) }
    const view = views.find(v => v.scope === "collection" && v.route === trimmed)
    if (view) return { kind: "view", id: view.id }
    const page = views.find(v => v.scope === "page" && v.route === trimmed && SURFACE_PAGE_LAYOUTS.has(pageLayoutOf(v)))
    if (page) {
      const source = queryOf(route)["source"]
      return { kind: "page-view", id: page.id, ...(source ? { source } : {}) }
    }
    // any other page layout names a module's app (ui: `apps.get(layout)`, its index route)
    const appPage = views.find(v => v.scope === "page" && v.route === trimmed)
    if (appPage) return { kind: "app-page", id: appPage.id, layout: pageLayoutOf(appPage) }
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
  return contentPage(decodeURIComponent(path.slice("/content/".length)), collections)
}

function contentPage(rest: string, collections: readonly string[], base?: string): Page {
  const r = resolveContentPath(rest, collections)
  const at = base ? { base } : {}
  if (!r.collection) return { kind: "unknown-collection", path: rest }
  if (r.create) return { kind: "create", collection: r.collection, ...at }
  if (r.id) return { kind: "record", collection: r.collection, id: r.id, ...at }
  return { kind: "list", collection: r.collection, ...at }
}

/** The routes under `/settings`: the Schema tab, and the system browse that keeps its own prefix. */
export const SCHEMA_BASE = "/settings/schema"
export const SYSTEM_BASE = "/settings/system"

function settingsPage(path: string, collections: readonly string[]): Page | null {
  const trimmed = path.replace(/\/+$/, "")
  if (trimmed === "/settings" || trimmed === SCHEMA_BASE) return { kind: "settings", tail: "" }
  if (trimmed.startsWith(`${SCHEMA_BASE}/`))
    return { kind: "settings", tail: decodeURIComponent(trimmed.slice(SCHEMA_BASE.length + 1)) }
  if (trimmed.startsWith(`${SYSTEM_BASE}/`))
    return contentPage(decodeURIComponent(trimmed.slice(SYSTEM_BASE.length + 1)), collections, SYSTEM_BASE)
  return null
}

/**
 * `/settings/data-model[/<name>]` is the Schema tab's collections surface under its old address — ui keeps it as a
 * redirect so every link it ever wrote still lands. The route it stands for, its query carried (`?field=` is a deep
 * link into one field's drawer); null for any other route.
 */
export function settingsRedirect(route: string): string | null {
  const path = pathOf(route)
  const old = "/settings/data-model"
  if (path !== old && !path.startsWith(`${old}/`)) return null
  const q = route.indexOf("?")
  return `${SCHEMA_BASE}/collections${path.slice(old.length)}${q < 0 ? "" : route.slice(q)}`
}

/** `base` is where a list's records live in the route space: `/content` by default; the Schema tab's generic
 *  browse passes `/settings/schema`, so a row opened from it stays in the tab. */
export const CONTENT_BASE = "/content"
export const listRoute = (collection: string, base = CONTENT_BASE) => `${base}/${collection}`
export const recordRoute = (collection: string, id: string, base = CONTENT_BASE) => `${base}/${collection}/${id}`
export const createRoute = (collection: string, base = CONTENT_BASE) => `${base}/${collection}/+`

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
