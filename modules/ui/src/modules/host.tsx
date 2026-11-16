/**
 * MODULE APPS (cr-modules-008) — ported from the Vue ui's modules.ts, the same frames, messages and checks. A module's
 * `ui/app.js` never runs in this page. Each module gets a hidden REGISTRY frame that loads its bundle and says
 * what it registered; the host registers a PROXY for each free id (D9) in this app's registries — a React
 * component that draws a SURFACE frame where the mount rule allows (D10), else the built-in. Every request,
 * intent, navigation and value a frame sends is checked here: requests by @dreamteamer/protocol's gate under the
 * module's scope (built from the compiled runtime and the person's grant), the rest by modules/policy.ts.
 *
 * The frame side is framework-free: the bridge's messages are the whole interface, and a module's components are
 * mount functions the guest calls (modules/guest/guest.ts), drawn with whatever the module bundles.
 *
 * Differences from ui, on purpose: a host that can frame nothing (no frames base, no guest URL — the playground)
 * loads no module rather than framing an error page; a frame's `--dt-*` tokens travel with the theme too.
 */
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react"
import { gate } from "@dreamteamer/protocol/gate"
import { matchRoute } from "@dreamteamer/protocol/routes"
import { reshape } from "@dreamteamer/protocol/reshape"
import { applyWrite } from "@dreamteamer/protocol/apply-write"
import { createFrameBridge } from "@dreamteamer/protocol/frame-bridge"
import { buildModuleScope } from "@dreamteamer/protocol/module-scope"
import { buildFrameDocument } from "@dreamteamer/protocol/frame-document"
import { encId, getInfo, request } from "../api/client.ts"
import { useApp, useSignal } from "../app-context.tsx"
import type { BrowseState } from "../browse/browse-state.ts"
import { hostInfo } from "../lib/host.ts"
import { pageOf, pathOf, queryOf } from "../lib/route.ts"
import { signal } from "../lib/signal.ts"
import { uiViews } from "../lib/ui-views.ts"
import { apps, edits, lists, panels, views, type ExtensionDefinition } from "../registry/index.ts"
import type { EditProps, ListProps, ViewProps } from "../registry/props.ts"
import { moduleKindDefault, resolveEdit, resolveView } from "../registry/resolve.ts"
import { canFrame, makeFrameSource } from "./frame-source.ts"
import {
  buildSnapshot,
  checkIntent,
  checkNavigate,
  createBounds,
  forwardKey,
  invalidationFor,
  sanitizeCellHtml,
} from "./policy.ts"
import { cx, listEmpty, notice, noticeError, noticeWarning } from "../styles/classes.ts"

type Scope = ReturnType<typeof buildModuleScope> & { ownViews?: string[]; ownApps?: string[] }
type Msg = { dt: 1; id: unknown; op: string; [k: string]: any }
type Descriptor = { name: string; fields?: Record<string, any>; runtime?: boolean }

const bridge = createFrameBridge<{ handle: (msg: Msg) => void }>()
const frameSource = makeFrameSource(buildFrameDocument)
let descriptors: Descriptor[] = []
const scopes = new Map<string, Scope>()
const registries = new Map<string, Window>()
const cellReplies = new Map<number, (cells: Array<{ key: string; html: string }>) => void>()
const liveFrames = new Map<Window, { scope: Scope; post: (m: Record<string, unknown>) => void }>()
/** Modules whose code may have changed since the page loaded — kept per module, so a remounted frame still says so (h8). */
const staleModules = signal<ReadonlySet<string>>(new Set())
const warn = (m: string) => console.warn(`[modules] ${m}`)

let listening = false
function listen() {
  if (listening) return
  listening = true
  window.addEventListener("message", ev => {
    const a = bridge.accept(ev)
    if (a) a.meta.handle(a.msg as Msg)
  })
  window.addEventListener("message", ev => {
    const d = ev.data as { type?: string; scope?: string; collections?: string[] } | null
    // the host's invalidation arrives from the page itself (dt web) or the webview channel; never trust a frame's
    if (
      d?.type !== "dt:invalidate" ||
      liveFrames.has(ev.source as Window) ||
      [...registries.values()].includes(ev.source as Window)
    )
      return
    const stale = new Set(staleModules.get())
    for (const [, frame] of liveFrames) {
      const out = invalidationFor(frame.scope, d as { scope: string; collections?: string[] })
      if (out) frame.post({ op: "invalidate", detail: out })
      if (d.scope === "schema") stale.add(frame.scope.module)
    }
    if (stale.size !== staleModules.get().size) staleModules.set(stale)
  })
}

async function makeFrame(module: string, kind: string, hidden = false): Promise<HTMLIFrameElement> {
  const f = document.createElement("iframe")
  f.setAttribute("sandbox", "allow-scripts")
  f.setAttribute("title", `module app ${module}`)
  f.style.cssText = hidden ? "display:none" : "border:0;width:100%;display:block;min-height:24px"
  const s = await frameSource(module, kind)
  if (s.src) f.src = s.src
  else f.srcdoc = s.srcdoc!
  return f
}

// ---- requests: the gate, then the transport, then reshape
async function answer(
  scope: Scope,
  bounds: ReturnType<typeof createBounds>,
  msg: Msg
): Promise<{ status: number; body: unknown }> {
  if (!(await bounds.acquire()))
    return {
      status: 429,
      body: { error: `module app ${scope.module} has too many requests waiting (4 in flight, 64 queued)` },
    }
  try {
    const [path, qs] = String(msg.path ?? "/").split("?")
    const decision = gate(scope, descriptors, String(msg.method), path, new URLSearchParams(qs ?? ""), msg.body)
    if (!decision.ok) {
      warn(decision.error)
      return { status: decision.status, body: { error: decision.error } }
    }
    const handle = (m: string, p: string, b?: unknown) =>
      request(m, p, b).then(
        body => ({ status: 200, body: body as any }),
        (e: { status?: number; message?: string }) => ({
          status: e?.status ?? 500,
          body: { error: e?.message ?? String(e) } as any,
        })
      )
    const call = decision.call
    if (call.method === "GET") {
      const q = new URLSearchParams(call.query).toString()
      const r = await handle("GET", q ? `${call.path}?${q}` : call.path)
      return r.status === 200 ? { status: 200, body: reshape(call.routeId, r.body, scope, call.collection) } : r
    }
    if (!bounds.write())
      return { status: 429, body: { error: `module app ${scope.module} writes too fast (60 a minute)` } }
    if (decision.needsSource === "home") {
      const params = (matchRoute(call.method, call.path) as { params?: Record<string, string> } | null)?.params
      const id = String(params?.["id"] ?? "")
      const rec = await handle("GET", `/collections/${encodeURIComponent(call.collection ?? "")}/records/${encId(id)}`)
      const src = rec.body?.fields?.$source ?? rec.body?.$source
      if (rec.status !== 200 || src !== scope.home) {
        const error = `module app ${scope.module} cannot write ${call.collection}/${id}: the record is held by ${src ?? "nobody"} — a module app writes only in ${scope.home}`
        warn(error)
        return { status: 403, body: { error } }
      }
    }
    return await applyWrite(handle, decision)
  } finally {
    bounds.end()
  }
}

function themeNow() {
  const vars: Record<string, string> = {}
  const cs = getComputedStyle(document.documentElement)
  for (let i = 0; i < cs.length; i++) {
    const n = cs[i]
    if (n.startsWith("--dt-") || n.startsWith("--vscode-") || n.startsWith("--dt-")) vars[n] = cs.getPropertyValue(n)
  }
  return { vars, scheme: document.body.className }
}

/** Plain, structured-clonable data: no functions, no class instances (a JSON round trip; undefined stays undefined). */
function plainData<T>(x: T): T {
  return x === undefined ? x : JSON.parse(JSON.stringify(x))
}

const stripCommit = (scope: Scope, collection: string, rec: unknown) =>
  rec && typeof rec === "object" && !scope.own.has(collection)
    ? reshape("record-read", { id: (rec as { id?: unknown }).id, fields: rec }, scope, collection)
    : rec

// ---- a surface frame, drawn where a proxy mounts

interface FrameProps {
  module: string
  kind: "edit" | "view" | "list" | "app"
  defId: string
  collection: string
  frameProps: Record<string, unknown>
  listState?: BrowseState
  onValue?: (value: unknown) => void
}

function listSnapshot(scope: Scope, collection: string, s: BrowseState) {
  const snap = buildSnapshot({
    scope,
    collection,
    rows: s.records,
    total: s.total,
    pk: "id",
    columns: s.columns.map(c => ({ field: c.field, title: c.title, type: c.type, editable: c.editable })),
    selected: s.selectedIds,
    sort: { field: s.sortField || null, desc: s.sortDesc },
    titleOf: r => s.recordTitleOf(r as never),
    titleRefs: {}, // no resolve: a reference renders as its raw id (D16)
    loading: s.loading,
    error: s.error ?? null,
  })
  return { snap, state: { ...snap, hasPrev: s.hasPrev, hasNext: s.hasNext, from: s.from, to: s.to } }
}

function ModuleFrame({ module, kind, defId, collection, frameProps, listState, onValue }: FrameProps) {
  const { route, navigate } = useApp()
  const host = useRef<HTMLDivElement>(null)
  const stale = useSignal(staleModules).has(module)
  const [stopped, setStopped] = useState("")
  const fills = kind === "list" || kind === "app"
  // the handler reads the newest props; the frame is built once per module/kind/def
  const latest = useRef({ frameProps, listState, route, navigate, onValue, collection })
  latest.current = { frameProps, listState, route, navigate, onValue, collection }
  const win = useRef<Window | null>(null)
  const posted = useRef(new Set<string>())
  const post = (m: Record<string, unknown>) => {
    if (!win.current) return
    try {
      bridge.post(win.current, plainData(m))
    } catch (e) {
      warn(`module app ${module}: could not send ${String(m["op"])}: ${String(e)}`)
    }
  }
  const postRef = useRef(post)
  postRef.current = post

  const appRoute = () => {
    const r = latest.current.route
    return { path: pathOf(r), fullPath: r, params: {}, query: queryOf(r) }
  }
  const fieldRoute = () => {
    const rec = latest.current.frameProps["record"] as { id?: string } | undefined
    const c = latest.current.collection
    return c
      ? {
          path: `/content/${c}${rec?.id ? `/${rec.id}` : ""}`,
          params: { path: rec?.id ? `${c}/${rec.id}` : c },
          query: {},
        }
      : { path: "/", params: {}, query: {} }
  }
  const snapshot = () => {
    const s = latest.current.listState
    const scope = scopes.get(module)
    if (!s || !scope) return null
    const { snap, state } = listSnapshot(scope, latest.current.collection, s)
    posted.current = new Set(snap.ids)
    return state
  }

  useEffect(() => {
    const scope = scopes.get(module)
    if (!scope) return
    const bounds = createBounds()
    let alive = true
    let frame: HTMLIFrameElement | null = null
    let rebuilds = 0
    const drop = () => {
      if (!win.current) return
      bridge.remove(win.current)
      liveFrames.delete(win.current)
      win.current = null
    }
    const reply = (msg: Msg, v: unknown) => win.current && bridge.reply(win.current, msg.id, v)
    const handle = async (msg: Msg) => {
      const now = latest.current
      switch (msg.op) {
        case "request":
          reply(msg, await answer(scope, bounds, msg))
          break
        case "emit":
          if (msg["event"] === "update:value" && kind === "edit" && scope.writes.has(now.collection))
            now.onValue?.(msg["args"]?.[0])
          else warn(`module app ${module} cannot change ${now.collection}: no write is granted`)
          break
        case "intent": {
          if (!bounds.intent()) {
            reply(msg, { ok: false, error: `module app ${module} sends intents too fast` })
            break
          }
          const s = now.listState
          const cols = (s?.columns ?? []).map(c => c.field)
          const c = checkIntent(scope, now.collection, posted.current, msg["name"], msg["args"] ?? [], cols)
          if (!c.ok || !s) {
            warn(c.error ?? `module app ${module}: no list here`)
            reply(msg, c)
            break
          }
          const id = msg["args"]?.[0]
          const run: Record<string, () => unknown> = {
            reload: () => s.reload(),
            setSort: () => s.toggleSort(String(id)),
            setSortValue: () => s.setSort(String(id ?? "")),
            openRecord: () => {
              const row = s.records.find(r => r.id === id)
              if (row) s.openRecord(row)
            },
            toggleSelect: () => s.toggleSelect(String(id)),
            toggleSelectAllVisible: () => s.toggleSelectAllVisible(),
            clearSelection: () => s.clearSelection(),
            prevPage: () => s.prevPage(),
            nextPage: () => s.nextPage(),
          }
          try {
            await run[msg["name"]]?.()
            reply(msg, { ok: true })
          } catch (e) {
            reply(msg, { ok: false, error: String(e) })
          }
          break
        }
        case "navigate": {
          const n = checkNavigate(scope, msg["to"])
          if (!n.ok) {
            warn(n.error!)
            reply(msg, n)
            break
          }
          now.navigate(n.to!) // ui keeps one history: a `replace` moves as a push does
          reply(msg, { ok: true })
          break
        }
        case "resize":
          if (frame && !fills) frame.style.height = `${Math.min(Number(msg["height"]) || 0, window.innerHeight)}px`
          break
        case "key":
          if (forwardKey(msg as never))
            for (const t of [document, window])
              t.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: msg["key"],
                  code: msg["code"],
                  metaKey: msg["metaKey"],
                  ctrlKey: msg["ctrlKey"],
                  shiftKey: msg["shiftKey"],
                  altKey: msg["altKey"],
                  bubbles: true,
                  cancelable: true,
                })
              )
          break
        case "error":
          warn(`module app ${module}: ${msg["message"]}`)
          break
      }
    }
    // a frame whose document is replaced (a module navigating itself) is dropped and rebuilt on its own document —
    // at most twice; then the module is stopped with a notice (h4)
    const build = async () => {
      const f = await makeFrame(module, kind)
      if (!alive) return
      if (fills) f.style.height = "100%"
      let loads = 0
      f.addEventListener("load", () => {
        if (!f.contentWindow || !alive) return
        if (++loads === 1) {
          win.current = f.contentWindow
          bridge.add(f.contentWindow, { handle: m => void handle(m) })
          liveFrames.set(f.contentWindow, { scope, post: m => postRef.current(m) })
        }
        bridge.loaded(f.contentWindow)
        if (loads === 1) {
          postRef.current({
            op: "init",
            surface: "surface",
            kind,
            defId,
            props: latest.current.frameProps,
            state: snapshot(),
            route: kind === "app" ? appRoute() : fieldRoute(),
            routes: [],
            theme: themeNow(),
          })
          return
        }
        drop()
        f.remove()
        warn(
          `module app ${module} navigated its own frame — ${rebuilds < 2 ? "rebuilt on its own document" : "stopped"}`
        )
        if (rebuilds++ < 2) void build()
        else setStopped(`module app ${module} stopped: it navigated its own frame`)
      })
      frame = f
      host.current?.appendChild(f)
    }
    void build().catch(e => warn(`module app ${module}: could not frame ${kind} '${defId}': ${String(e)}`))
    const onPaste = (e: ClipboardEvent) => {
      if (frame && document.activeElement === frame)
        postRef.current({ op: "paste", text: e.clipboardData?.getData("text/plain") ?? "" })
    }
    document.addEventListener("paste", onPaste, true)
    return () => {
      alive = false
      drop()
      frame?.remove()
      document.removeEventListener("paste", onPaste, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one frame per module, kind and definition
  }, [module, kind, defId])

  // what changed since init travels as its own message
  const propsKey = JSON.stringify(frameProps ?? null)
  useEffect(() => post({ op: "props", props: frameProps }), [propsKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const s = listState
  useEffect(() => {
    if (s) post({ op: "state", state: snapshot() })
  }, [s?.records, s?.selectedIds, s?.sort, s?.loading]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (kind === "app") post({ op: "route", route: appRoute() })
  }, [route]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={fills ? "flex flex-1 flex-col min-h-0 h-full" : undefined}>
      {stale && (
        <div className={cx(notice, noticeWarning)} role="status">
          module app updated — reload to use its new code ({module})
        </div>
      )}
      {stopped && (
        <div className={cx(notice, noticeError)} role="alert">
          {stopped}
        </div>
      )}
      <div ref={host} className={cx("[&_iframe]:[color-scheme:normal]", fills && "flex-1 min-h-0")} />
    </div>
  )
}

// ---- cells (D5): markup from the registry frame, sanitized here
let cellSeq = 0
function cellMarkup(module: string, viewId: string, cellProps: Record<string, unknown>): Promise<string> {
  const reg = registries.get(module)
  if (!reg) return Promise.resolve("")
  return new Promise(resolve => {
    const id = ++cellSeq
    cellReplies.set(id, cells => resolve(sanitizeCellHtml(cells[0]?.html ?? "")))
    bridge.post(reg, { op: "render-cells", id, viewId, cells: [{ key: "0", props: plainData(cellProps) }] })
    setTimeout(() => {
      if (cellReplies.delete(id)) resolve("")
    }, 3000)
  })
}

/** The collection the page is on — a field row may not name its own (ui: `collectionOfRoute`). */
function usePageCollection(): string | null {
  const { route, schema } = useApp()
  const views = useSignal(uiViews)
  const page = pageOf(route, schema.names, views ?? [])
  return "collection" in page ? page.collection : null
}

type FieldProxyProps = Partial<EditProps> & Partial<ViewProps> & { field: EditProps["field"]; value: unknown }

function fieldProxy(module: string, kind: "edit" | "view", defId: string): ComponentType<FieldProxyProps> {
  function ModuleFieldProxy(p: FieldProxyProps) {
    const scope = scopes.get(module)!
    const onPage = usePageCollection()
    const c = String(p.field.collection ?? onPage ?? "")
    const context = p.context ?? "cell"
    const [html, setHtml] = useState("")
    const inReads = scope.reads.has(c)
    const cell = kind === "view" && context === "cell"
    const cellKey = JSON.stringify({ value: p.value ?? null, field: p.field, options: p.options ?? null })
    useEffect(() => {
      if (!inReads || !cell) return
      let live = true
      void cellMarkup(module, defId, { value: p.value, field: p.field, options: p.options, context: "cell" }).then(
        x => live && setHtml(x)
      )
      return () => {
        live = false
      }
    }, [inReads, cell, cellKey]) // eslint-disable-line react-hooks/exhaustive-deps
    if (!inReads) {
      warn(`module app ${module} is not shown on ${c || "this field"}: it is outside the app's read scope`)
      const Fallback =
        kind === "edit"
          ? resolveEdit({ ...p.field, editor: undefined }).entry.component
          : resolveView({ ...p.field, viewer: undefined }, context).entry.component
      return <Fallback {...p} />
    }
    if (cell)
      return (
        <span
          className="align-bottom"
          style={{ contain: "paint", overflow: "hidden", display: "inline-block", maxWidth: "100%" }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )
    const frameProps = {
      value: p.value,
      field: p.field,
      options: p.options,
      context: kind === "view" ? context : undefined,
      disabled: kind === "edit" ? !scope.writes.has(c) : undefined,
      record: stripCommit(scope, c, p.record),
    }
    return (
      <ModuleFrame
        module={module}
        kind={kind}
        defId={defId}
        collection={c}
        frameProps={frameProps}
        onValue={v => p.onChange?.(v)}
      />
    )
  }
  return ModuleFieldProxy
}

function listProxy(module: string, defId: string): ComponentType<ListProps> {
  return function ModuleListProxy(p: ListProps) {
    const scope = scopes.get(module)!
    if (!scope.reads.has(p.collection)) {
      warn(`module app ${module} is not shown on ${p.collection}: it is outside the app's read scope`)
      const Table = lists.get("table")!.component
      return <Table {...p} />
    }
    return (
      <ModuleFrame
        module={module}
        kind="list"
        defId={defId}
        collection={p.collection}
        listState={p.state}
        frameProps={{ collection: p.collection, query: p.query, options: p.options }}
      />
    )
  }
}

function appProxy(module: string, defId: string): ComponentType<{ route: string }> {
  return function ModuleAppProxy() {
    return <ModuleFrame module={module} kind="app" defId={defId} collection="" frameProps={{}} />
  }
}

function held(kind: string, id: string): string | null {
  const reg = { edit: edits, view: views, list: lists, app: apps, panel: panels }[kind]
  const e = reg?.get(id)
  return e ? (e.module ? `module app ${e.module}` : "the editor") : null
}

/** One definition a registry frame reported, as the guest sends it. */
interface Registered {
  kind: string
  id: string
  name?: string
  types?: string[]
  scope?: "field" | "record"
  fillsHeight?: boolean
  summarizes?: boolean
  icon?: string
  label?: string
}

function register(module: string, d: Registered) {
  const holder = held(d.kind, d.id)
  if (holder) {
    warn(`module app ${module} cannot register ${d.kind} '${d.id}': the id belongs to ${holder}`)
    return
  }
  const base = { id: d.id, name: d.name ?? d.id, module }
  if (d.kind === "edit" || d.kind === "view")
    (d.kind === "edit" ? edits : views).register({
      ...base,
      types: d.types ?? [],
      ...(d.scope ? { scope: d.scope } : {}),
      component: fieldProxy(module, d.kind, d.id),
    } satisfies ExtensionDefinition)
  else if (d.kind === "list")
    lists.register({
      ...base,
      ...(d.fillsHeight ? { fillsHeight: true } : {}),
      ...(d.summarizes ? { summarizes: true } : {}),
      component: listProxy(module, d.id),
    })
  else if (d.kind === "panel")
    panels.register({ ...base, types: d.types ?? [], component: () => null }) // held; no panel surface yet
  else if (d.kind === "app") {
    const sc = scopes.get(module)
    if (sc) sc.ownApps = [...(sc.ownApps ?? []), d.id]
    apps.register({
      id: d.id,
      icon: d.icon ?? "extensions",
      label: d.label ?? d.name ?? d.id,
      prefix: `/a/${d.id}`,
      component: appProxy(module, d.id),
      module,
    })
  } else warn(`module app ${module} registered a ${d.kind}, which no surface draws`)
}

const kindDefaults: Array<{ module: string; kind: "edit" | "view"; type: string; id: string }> = []
moduleKindDefault.find = (kind, field) =>
  kindDefaults.find(
    k => k.kind === kind && k.type === field.type && scopes.get(k.module)?.own.has(String(field.collection ?? ""))
  )?.id

async function openRegistry(module: string): Promise<void> {
  const f = await makeFrame(module, "registry", true)
  const bounds = createBounds() // one per registry frame, like a surface frame's (D17)
  await new Promise<void>(resolve => {
    const done = setTimeout(() => {
      warn(`module app ${module} did not register within 10 s — skipped`)
      resolve()
    }, 10_000)
    const handle = (msg: Msg) => {
      if (msg.op === "registered") {
        clearTimeout(done)
        for (const d of (msg["definitions"] ?? []) as Registered[]) register(module, d)
        for (const k of (msg["kindDefaults"] ?? []) as Array<{ kind: string; type: string; id: string }>)
          if (k.kind === "edit" || k.kind === "view") kindDefaults.push({ module, ...k, kind: k.kind })
        resolve()
      } else if (msg.op === "cells") {
        const replyTo = msg["replyTo"] as number
        cellReplies.get(replyTo)?.(msg["cells"] ?? [])
        cellReplies.delete(replyTo)
      } else if (msg.op === "request") {
        // the registry frame reads too: same gate
        void answer(scopes.get(module)!, bounds, msg).then(r => bridge.reply(f.contentWindow!, msg.id, r))
      } else if (msg.op === "error") {
        warn(`module app ${module}: ${msg["message"]}`)
      }
    }
    let loads = 0
    f.addEventListener("load", () => {
      const w = f.contentWindow
      if (!w) return
      if (++loads === 1) {
        bridge.add(w, { handle })
        registries.set(module, w)
        bridge.loaded(w)
        bridge.post(w, { op: "init", surface: "registry", theme: themeNow() })
      } else {
        bridge.loaded(w)
        registries.delete(module)
      }
    })
    document.body.appendChild(f)
  })
}

/** Boot, before the first render: build each module's scope, open its registry frame, register its proxies.
 *  Never rejects — a failed read or a broken module is warned about and the app boots without it. */
export async function loadModules(): Promise<void> {
  try {
    const info = (await getInfo()) as { ui?: string[] }
    const names = info.ui ?? []
    if (!names.length) return
    if (!canFrame()) {
      warn(`this host serves no module frames — ${names.join(", ")} not loaded`)
      return
    }
    listen()
    const [schema, rows, sources] = await Promise.all([
      request("GET", "/schema") as Promise<Descriptor[]>,
      request("GET", "/collections/collections/records?limit=2000") as Promise<{ records?: any[] }>,
      (request("GET", "/sources") as Promise<any>).catch(() => ({})),
    ])
    descriptors = schema
    const uiViewRows =
      (
        (await request("GET", "/collections/ui-views/records?limit=2000").catch(() => ({ records: [] }))) as {
          records?: any[]
        }
      ).records ?? []
    // dt web answers the grant on GET /host (cr-modules-017); the editor still injects it
    const host = hostInfo.get()
    const grants =
      (host?.["moduleGrants"] as Record<string, { reads: string[]; writes: string[] }> | null | undefined) ??
      window.__DT_MODULE_GRANTS__ ??
      {}
    const problem = host ? host["moduleGrantProblem"] : window.__DT_MODULE_GRANT_PROBLEM__
    if (problem) warn(`the module-app grant could not be read (${String(problem)}) — no grant applies`)
    for (const name of names) {
      const home =
        (sources.layers ?? []).find((l: any) => l.name === name || (l.modules ?? []).includes?.(name))?.name ??
        sources.workspace?.name ??
        sources.workspace ??
        "."
      const scope = buildModuleScope({
        module: name,
        home,
        collectionsRows: (rows.records ?? []).map((r: any) => ({ id: r.id, $module: r.$module })),
        descriptors: schema,
        grant: grants,
      }) as Scope
      scope.ownViews = uiViewRows.filter((v: any) => v.$module === name && v.route).map((v: any) => v.route)
      scopes.set(name, scope)
      await openRegistry(name)
    }
  } catch (err) {
    warn(`could not load module apps — continuing without them: ${String(err)}`)
  }
}

/** A route under `/a/<id>`, or a page view whose layout names an app: the app's frame, or why there is none. */
export function AppPage({ id }: { id: string }): ReactNode {
  const { route } = useApp()
  const app = apps.get(id)
  if (!app)
    return (
      <div className={listEmpty}>
        <span className="codicon codicon-extensions" aria-hidden="true" />
        <p>Page '{id}' is not registered — is its module installed and loaded?</p>
      </div>
    )
  const Component = app.component
  return (
    <div className="h-full flex flex-col">
      <Component route={route} />
    </div>
  )
}
