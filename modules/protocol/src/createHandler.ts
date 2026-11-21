// THE SHARED HANDLER — what every host answers, in one place.
//
// The extension's in-process host side (its `api.ts` and the modules it calls, none of which import the
// editor) is ported into `host/`, and this file puts the protocol's route table in front of it: a request
// whose method and path `ROUTES` does not name is answered 404 `unhandled request …` here and never
// reaches the host, so an undocumented route cannot exist (the router is the table).
//
// The engine is the WORKSPACE's own — `initEngine(root)` loads `<root>/node_modules/dreamteamer`'s public
// API (its package.json `exports`) the way the extension always has, and every compile-gated write re-opens the
// workspace first (`refreshWorkspace`), refusing with 409 when it will not open (review R5's fix).
import { ROUTES } from "./routes.ts"
import { initEngine } from "./host/engine.ts"
import { refreshWorkspace } from "./host/engine/refreshWorkspace.ts"
import { WorkspaceApi } from "./host/api.ts"
import { workspaceNavSettings } from "./workspaceNavSettings.ts"
import { type PaneStore } from "./pane.ts"
import { route } from "./route.ts"
export { NAV_UNMIGRATED, route } from "./route.ts"
export { unreadableDryRun } from "./unreadableDryRun.ts"

export interface Handler {
  handle(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }>
  readonly api: WorkspaceApi
  reopen(): Promise<void>
}

/** `settings` answers the four nav settings (default: the workspace's .vscode/settings.json); `pane` the store the
 *  five pane routes answer from (default: one in memory, at admin). */
export async function createHandler({
  root,
  onSystemWrite,
  settings = () => workspaceNavSettings(root),
  pane,
}: {
  root: string
  onSystemWrite?: (result: unknown) => void
  settings?: () => object
  /** The store the five pane routes answer from; absent, one in memory at admin. */
  pane?: PaneStore
}): Promise<Handler> {
  if (!root) throw new Error("createHandler: no workspace root")
  await initEngine(root)
  const api = new WorkspaceApi(root)
  if (onSystemWrite) api.onSystemWrite = onSystemWrite
  return {
    api,
    reopen: () => refreshWorkspace(),
    handle: (method: string, path: string, body?: unknown) =>
      route(api, method, path, body, {
        root,
        settings,
        host: (m: string, p: string, b?: unknown) => api.handle(m, p, b),
        pane,
      }),
  }
}

/** The first segment of every route whose second is the collection: where a split name can arrive. */
const COLLECTION_HEADS = new Set(
  ROUTES.filter(r => r.pattern.split("/")[2] === ":collection").map(r => r.pattern.split("/")[1])
)

/** A collection name with a slash sent unencoded splits into extra segments and matches no route: say which
 *  collection the caller meant, and why, rather than only "unhandled". */
export function unencodedHint(api: { descriptors(): unknown }, path: string): string | null {
  const seg = String(path)
    .split("?")[0]
    .replace(/^\/+/, "")
    .split("/")
    .map(s => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    })
  if (!COLLECTION_HEADS.has(seg[0]) || seg.length < 3) return null
  let names
  try {
    names = api.descriptors() as Map<string, unknown>
  } catch {
    return null
  }
  if (names.has(seg[1])) return null
  for (let take = seg.length; take > 2; take--) {
    const candidate = seg.slice(1, take).join("/")
    if (names.has(candidate)) {
      return (
        `unknown collection "${seg[1]}" — did you mean "${candidate}"? a collection name containing "/" must be percent-encoded ` +
        `in the URL (encodeURIComponent("${candidate}")), or it splits into extra path segments.`
      )
    }
  }
  return null
}
