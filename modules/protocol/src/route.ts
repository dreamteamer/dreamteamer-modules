import { type PaneStore, PANE_ROUTES, answerPane, defaultPane } from "./pane.ts"
import { matchRoute } from "./routes.ts"
import { navModel } from "./navModel.ts"
import { navOpContext } from "./navOpContext.ts"
import fs from "node:fs"
import { join as pathJoin } from "node:path"
import { NAV_FILE, navProblemsSentence, type NavOp, writeNavDoc, NavOpError, NavDocError } from "./navDoc.ts"
import { unknownNavNames } from "./navDoc/unknownNavNames.ts"
import { checkNavDoc } from "./navDoc/checkNavDoc.ts"
import { applyNavOp } from "./navDoc/applyNavOp.ts"
import { navDocProblems } from "./navDoc/navDocProblems.ts"
import { readNavDoc } from "./navDoc/readNavDoc.ts"
import { hasNavSettings } from "./host/nav/hasNavSettings.ts"
import { unencodedHint } from "./createHandler.ts"
import { unreadableDryRun } from "./unreadableDryRun.ts"

/**
 * One request through the protocol's router in front of a host that is already open — what createHandler
 * answers with, and what a host that opened the workspace itself (the VS Code extension) calls directly: an
 * unnamed method and path is 404 `unhandled request`, an unreadable `?dry-run` is 400, `GET /nav` is the nav
 * model, `PATCH /nav` and `PUT /nav` write nav.yaml, the five pane routes answer from `pane` (a memory store per
 * api when absent), and everything else is the host's.
 */
export async function route(
  api: { descriptors(): unknown },
  method: string,
  path: string,
  body: unknown,
  {
    root,
    settings,
    host,
    pane,
  }: {
    root: string
    settings: () => object
    host: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: unknown }>
    pane?: PaneStore
  }
): Promise<{ status: number; body: unknown }> {
  const m = String(method).toUpperCase()
  const hit = matchRoute(m, path)
  if (!hit) {
    const hint = unencodedHint(api, path)
    return { status: 404, body: { error: `unhandled request ${m} ${path}${hint ? ` — ${hint}` : ""}` } }
  }
  const refused = unreadableDryRun(m, path)
  if (refused) return { status: 400, body: { error: refused } }
  // the one route the editor's host never needed: its tree IS the nav
  if (hit.route.id === "nav") {
    try {
      api.descriptors()
      return { status: 200, body: navModel({ root, settings: settings() ?? {} }) }
    } catch (e) {
      return { status: 400, body: { error: String(e?.message ?? e) } }
    }
  }
  if (hit.route.id === "nav-patch" || hit.route.id === "nav-put")
    return navWrite(api, hit.route.id, body, { root, settings })
  if (PANE_ROUTES.has(hit.route.id)) {
    const reader = {
      descriptors: () => api.descriptors() as Map<string, unknown>,
      handle: (m2: string, p2: string) => host(m2, p2) as Promise<{ status: number; body?: any }>,
    }
    return answerPane(hit.route.id, body, { pane: pane ?? defaultPane(api, host), reader })
  }
  const res = (await host(m, path, body)) as { status: number; body: any }
  // a greedy route (history) hands the split name to the host, which refuses the first half: say why
  if (res?.status >= 400 && !/percent-encoded/.test(String(res.body?.error ?? ""))) {
    const hint = unencodedHint(api, path)
    if (hint) return { ...res, body: { ...res.body, error: `${res.body?.error ?? "refused"} — ${hint}` } }
  }
  return res
}

export const NAV_UNMIGRATED =
  "your nav settings are not in nav.yaml yet — run: npx -p @dreamteamer/protocol@0.3 dt-nav migrate"

/**
 * `PATCH /nav` (one NavOp) and `PUT /nav` (a whole NavDoc): checked, applied, written through the engine's writer
 * when it has one, answered `200 { doc }`. Nothing is written on any refusal: a malformed op or document, an unknown
 * name, a folder path that resolves to nothing (400, the sentence naming the input); a nav.yaml that cannot be read,
 * under a PATCH (400 naming the file — a gesture never starts over from an empty document; PUT replaces it); and no
 * nav.yaml while an old nav setting is still set (409 naming the migration, so the first write never strands them).
 */
async function navWrite(
  api: { descriptors(): unknown },
  id: string,
  body: unknown,
  { root, settings }: { root: string; settings: () => object }
) {
  try {
    try {
      api.descriptors()
    } catch (e) {
      return { status: 400, body: { error: String(e?.message ?? e) } }
    }
    if (!fs.existsSync(pathJoin(root, NAV_FILE)) && hasNavSettings(settings() ?? {}))
      return { status: 409, body: { error: NAV_UNMIGRATED } }
    const ctx = navOpContext(root)
    let doc
    const file = pathJoin(root, NAV_FILE)
    if (id === "nav-patch") {
      const current = readNavDoc(root)
      const { problems } = navDocProblems(current)
      if (current && problems.length)
        return {
          status: 400,
          body: {
            error: `${navProblemsSentence(problems)} — fix them by hand, or PUT a whole document; nothing was written`,
          },
        }
      doc = applyNavOp(current, body as NavOp, ctx)
    } else {
      doc = checkNavDoc(body)
      const unknown = unknownNavNames(doc, { collections: ctx.known, namespaces: ctx.namespaces })
      if (unknown.length)
        return {
          status: 400,
          body: {
            error: `nav.yaml would name what this workspace does not have: ${unknown.join(", ")} — nothing was written`,
          },
        }
      // a nav.yaml that is a directory: PUT replaces an empty one, and never deletes what one holds
      if (isDirectory(file)) {
        if (fs.readdirSync(file).length)
          return {
            status: 400,
            body: {
              error: `nav.yaml is a directory with files in it — move it aside and PUT again; nothing was written`,
            },
          }
        fs.rmdirSync(file)
      }
    }
    writeNavDoc(root, doc)
    return { status: 200, body: { doc } }
  } catch (e) {
    if (e instanceof NavOpError || e instanceof NavDocError || e?.name === "NavDocError")
      return { status: 400, body: { error: String(e.message) } }
    return { status: 500, body: { error: String(e?.message ?? e) } }
  }
}

const isDirectory = (file: string) => {
  try {
    return fs.statSync(file).isDirectory()
  } catch {
    return false
  }
}
