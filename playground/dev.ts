#!/usr/bin/env node
// THE UI IN A BROWSER, FROM SOURCE — a dev harness, not a host: no sign-in, no levels, no file serving.
//
//   node playground/dev.ts                  serve modules/ui/src (the React app) with Vite (hot reload) on http://localhost:5173
//   node playground/dev.ts --app=ui-legacy  serve modules/ui-legacy/src instead (the Vue app), same API
//   node playground/dev.ts --fresh    build a new sample workspace first
//   node playground/dev.ts --port=n   another port
//
// `/api/*` is answered by @dreamteamer/protocol's shared handler, the same router dt web puts in front
// of a workspace, over the contract's sample workspace (Northwind: projects, tasks, lab/samples, a
// ui-view, a layer). It is built once with the engine in node_modules/dreamteamer, under
// playground/.workspaces/, and reused until --fresh. Every request is answered at admin, so edits
// in the page write the sample workspace's files.
//
// Both sides run this repo's .ts sources directly: the handler through Node's type stripping, the page
// through Vite, with `@dreamteamer/protocol/<x>` aliased to modules/protocol/src/<x>.ts, because the
// package's `exports` still name the .js files from before the rename.
import fs from "node:fs"
import path from "node:path"
import type { IncomingMessage, ServerResponse } from "node:http"
import { fileURLToPath } from "node:url"
import { createServer, type Plugin } from "vite"
import vue from "@vitejs/plugin-vue"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { makeFixture } from "../modules/protocol/lib/contract/fixture.ts"
import { createHandler } from "../modules/protocol/src/createHandler.ts"

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PROTOCOL_SRC = path.join(REPO, "modules", "protocol", "src")
const ENGINE = path.join(REPO, "node_modules", "dreamteamer")
const WORKSPACES = path.join(REPO, "playground", ".workspaces")

const args = process.argv.slice(2)
const fresh = args.includes("--fresh")
const port = Number(args.find(a => a.startsWith("--port="))?.split("=")[1] ?? 5173)
const app = args.find(a => a.startsWith("--app="))?.split("=")[1] ?? "ui"
if (app !== "ui" && app !== "ui-legacy") throw new Error(`--app=${app}: expected ui or ui-legacy`)
const UI_SRC = path.join(REPO, "modules", app, "src")

/** The newest sample workspace under playground/.workspaces, or a new one. */
function workspace(): string {
  fs.mkdirSync(WORKSPACES, { recursive: true })
  if (!fresh) {
    const newest = fs
      .readdirSync(WORKSPACES)
      .map(n => path.join(WORKSPACES, n))
      .filter(d => fs.existsSync(path.join(d, ".dreamteamer")))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
    if (newest) return newest
  }
  console.log("building the sample workspace (dt init, compile, a few records)…")
  return makeFixture({ engineDir: ENGINE, tmp: WORKSPACES }).root
}

const root = workspace()
const handler = await createHandler({ root })
const events = new Set<ServerResponse>()

const readBody = (req: IncomingMessage) =>
  new Promise<unknown>((resolve, reject) => {
    let text = ""
    req.on("data", c => (text += c))
    req.on("end", () => {
      try {
        resolve(text ? JSON.parse(text) : undefined)
      } catch (e) {
        reject(e)
      }
    })
    req.on("error", reject)
  })

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body ?? null))
}

/** `/api/*` → the shared handler; `/api/events` an event stream that says "re-fetch" when the workspace changes. */
const api: Plugin = {
  name: "dt-playground-api",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      // the UI has a src/api/ folder of its own: a path that names a source file is Vite's
      if (!req.url?.startsWith("/api/") || fs.existsSync(path.join(UI_SRC, req.url.split("?")[0]))) return next()
      const apiPath = req.url.slice(4)
      if (req.method === "GET" && apiPath === "/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        })
        res.write(": open\n\n")
        events.add(res)
        req.on("close", () => events.delete(res))
        return
      }
      try {
        const out = await handler.handle(req.method, apiPath, await readBody(req))
        send(res, out.status, out.body)
      } catch (e) {
        send(res, 500, { error: String(e?.message ?? e) })
      }
    })
  },
}

// a change on disk (a `dt add` in a terminal, an edit in the page) redraws every open page, debounced
let timer: NodeJS.Timeout | null = null
fs.watch(root, { recursive: true }, (_type, file) => {
  // any .git folder, a layer's included: a git command's lock files are not a change to the workspace
  const parts = file ? file.split(path.sep) : []
  if (!file || parts.includes(".git") || parts.includes("node_modules")) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    await handler.reopen().catch(() => {})
    for (const res of events) res.write(`data: ${JSON.stringify({ type: "dt:invalidate", scope: "schema" })}\n\n`)
  }, 300)
})

const server = await createServer({
  configFile: false,
  root: UI_SRC,
  plugins: app === "ui" ? [react(), tailwindcss(), api] : [vue(), api],
  resolve: { alias: [{ find: /^@dreamteamer\/protocol\/(.*)$/, replacement: `${PROTOCOL_SRC}/$1.ts` }] },
  server: { port, strictPort: true, fs: { allow: [REPO] } },
})
await server.listen()
console.log(`app: @dreamteamer/${app}\nworkspace: ${root}`)
server.printUrls()
