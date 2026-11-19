/**
 * THE GUEST (cr-modules-008 §2, D6) — runs inside a module frame. It gives a module bundle its contract (the
 * register API, a router, fetch('/api/…')) and talks only to window.parent: every /api call, intent and navigation is
 * a message the host checks. It imports the bundle from the document's JSON data block as a blob: module.
 *
 * FRAMEWORK-FREE. A module draws with whatever it bundles — plain DOM, React, Vue, anything — because a component
 * is only a mount function:
 *
 *   component = { mount(el, props, ctx) } | (el, props, ctx) => …    // returns, or resolves to:
 *   handle    = { update?(props), unmount?() } | void
 *
 * `ctx` is { emit(event, ...args), router }. An Edit says a new value with `ctx.emit("update:value", v)` (or the
 * `onChange(v)` prop it is also handed); a List gets `props.state` (the browse's snapshot plus its intents) and a new
 * `update` whenever the host sends a new one; an app's `routes` are `{ path, component }`, and the route component is
 * handed `props.route`. Through @dreamteamer/ui 0.3 the guest carried Vue and components were Vue components; the
 * frame is the module's world, so the host's own framework never reaches it.
 */
type Msg = { dt: 1; id: number; op?: string; reply?: any; [k: string]: any }
;(function guest() {
  // the round-4 remedy: after this script, no inline handler or inline script runs (dt web); blob: stays for the bundle
  const lock = document.createElement("meta")
  lock.httpEquiv = "Content-Security-Policy"
  lock.content = "script-src blob:"
  document.head.appendChild(lock)

  let seq = 0
  const pending = new Map<number, (r: any) => void>()
  const post = (op: string, payload: Record<string, unknown> = {}) =>
    parent.postMessage({ dt: 1, id: ++seq, op, ...payload }, "*")
  const ask = (op: string, payload: Record<string, unknown> = {}) =>
    new Promise<any>(resolve => {
      const id = ++seq
      pending.set(id, resolve)
      parent.postMessage({ dt: 1, id, op, ...payload }, "*")
    })

  // ---- fetch('/api/…') over the bridge; anything else is the browser's, which the frame policy refuses
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    if (url === "/api" || url.startsWith("/api/")) {
      let body: unknown
      if (typeof init.body === "string" && init.body.length) {
        try {
          body = JSON.parse(init.body)
        } catch {
          body = init.body
        }
      }
      const r = await ask("request", {
        method: String(init.method ?? "GET").toUpperCase(),
        path: url.slice(4) || "/",
        body,
      })
      return new Response(JSON.stringify(r?.body ?? null), {
        status: r?.status ?? 500,
        headers: { "Content-Type": "application/json" },
      })
    }
    return realFetch(input, init)
  }

  // ---- the register API and the router proxy
  const defs: Record<string, Map<string, any>> = {
    edit: new Map(),
    view: new Map(),
    list: new Map(),
    app: new Map(),
    panel: new Map(),
  }
  const kindDefaults: Array<{ kind: string; type: string; id: string }> = []
  let route: any = { path: "/", fullPath: "/", params: {}, query: {} }
  const routeListeners = new Set<(r: any) => void>()
  let routes: Array<{ path: string; name?: string }> = []
  const guards: Array<(to: any, from: any) => unknown> = []
  const toPath = (to: any): string => {
    if (typeof to === "string") return to
    const q = to?.query
      ? new URLSearchParams(
          Object.entries(to.query)
            .filter(([, v]) => v != null)
            .map(([k, v]) => [k, String(v)])
        ).toString()
      : ""
    return `${to?.path ?? route.path}${q ? `?${q}` : ""}`
  }
  const go = (to: any, replace: boolean) =>
    ask("navigate", { to: toPath(to), replace }).then(r => {
      if (!r?.ok) throw new Error(r?.error ?? "navigation refused")
    })
  const router = {
    /** The current route, `{ path, fullPath, params, query }`. */
    get currentRoute() {
      return route
    },
    /** Called with each new route; returns the unsubscribe. */
    onChange: (cb: (r: any) => void) => {
      routeListeners.add(cb)
      return () => routeListeners.delete(cb)
    },
    push: (to: any) => go(to, false),
    replace: (to: any) => go(to, true),
    resolve: (to: any) => {
      const p = toPath(to)
      return { href: `#${p}`, fullPath: p, path: p.split("?")[0] }
    },
    getRoutes: () => routes,
    beforeEach: (g: any) => {
      guards.push(g)
      return () => guards.splice(guards.indexOf(g), 1)
    },
    afterEach: () => () => undefined,
    isReady: () => Promise.resolve(),
  }
  const api = {
    registerEdit: (d: any) => defs.edit.set(d.id, d),
    registerView: (d: any) => defs.view.set(d.id, d),
    registerList: (d: any) => defs.list.set(d.id, d),
    registerApp: (d: any) => defs.app.set(d.id, d),
    registerPanel: (d: any) => defs.panel.set(d.id, d),
    registerKindDefault: (kind: string, type: string, id: string) => kindDefaults.push({ kind, type, id }),
    router,
  }

  const text = JSON.parse(document.getElementById("dt-bundle")?.textContent ?? '""')
  const ready: Promise<unknown> = import(
    /* @vite-ignore */ URL.createObjectURL(new Blob([text], { type: "text/javascript" }))
  )
    .then((m: any) =>
      typeof m.default === "function"
        ? m.default(api)
        : Promise.reject(new Error("the module app has no default export"))
    )
    .catch((e: unknown) => {
      post("error", { message: String(e) })
    })

  // ---- keys, links, size
  document.addEventListener(
    "keydown",
    e => {
      const chrome =
        e.key === "Escape" || ((e.metaKey || e.ctrlKey) && !e.altKey && ["p", "b", "j"].includes(e.key.toLowerCase()))
      if (chrome)
        post("key", {
          key: e.key,
          code: e.code,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
        })
    },
    true
  )
  document.addEventListener(
    "click",
    e => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
      if (!a) return
      const href = a.getAttribute("href") ?? ""
      if (href.startsWith("#/") || (href.startsWith("/") && !href.startsWith("//"))) {
        e.preventDefault()
        void go(href.replace(/^#/, ""), false).catch(() => undefined)
      }
    },
    true
  )
  if (typeof ResizeObserver === "function")
    new ResizeObserver(() => post("resize", { height: document.documentElement.scrollHeight })).observe(
      document.documentElement
    )

  // ---- the list state the host's browse-state offers, rebuilt from snapshots; methods are intents
  const intent = (name: string, ...args: unknown[]) =>
    ask("intent", { name, args }).then(r => {
      if (!r?.ok) throw new Error(r?.error ?? `${name} refused`)
      return r.value
    })
  /** The list state a List is handed: the browse's last snapshot as plain values, and its methods as intents. */
  function listStateOf(snap: any) {
    const pk = snap?.pk ?? "id"
    const pkOf = (row: any) => String(row?.[pk] ?? row?.id ?? "")
    const selected = new Set<string>((snap?.selected ?? []).map(String))
    const items: any[] = snap?.items ?? []
    const idOf = (x: any) => (typeof x === "string" ? x : pkOf(x))
    return {
      collection: snap?.collection ?? "",
      columns: snap?.columns ?? [],
      items,
      loading: !!snap?.loading,
      error: snap?.error ?? null,
      total: snap?.total ?? 0,
      selectedIds: selected,
      sortField: snap?.sort?.field ?? null,
      sortDesc: !!snap?.sort?.desc,
      hasPrev: !!snap?.hasPrev,
      hasNext: !!snap?.hasNext,
      from: snap?.from ?? 0,
      to: snap?.to ?? 0,
      titleField: snap?.titleField ?? null,
      colorBy: snap?.colorBy ?? null,
      imageField: snap?.imageField ?? null,
      subtitleFields: snap?.subtitleFields ?? [],
      allVisibleSelected: items.length > 0 && items.every(row => selected.has(pkOf(row))),
      pkOf,
      isSelected: (x: any) => selected.has(idOf(x)),
      sortIndicator: (f: string) => ((snap?.sort?.field ?? null) === f ? (snap?.sort?.desc ? "desc" : "asc") : null),
      recordTitleOf: (row: any) => snap?.titles?.[pkOf(row)] ?? pkOf(row),
      tintOf: (row: any) => snap?.tints?.[pkOf(row)],
      reload: () => intent("reload"),
      setSort: (f: string) => intent("setSort", f),
      openRecord: (x: any) => intent("openRecord", idOf(x)),
      toggleSelect: (x: any) => intent("toggleSelect", idOf(x)),
      toggleSelectAllVisible: () => intent("toggleSelectAllVisible"),
      clearSelection: () => intent("clearSelection"),
      setSortValue: (v: unknown) => intent("setSortValue", v),
      prevPage: () => intent("prevPage"),
      nextPage: () => intent("nextPage"),
    }
  }

  // ---- surfaces: a component is a mount function; the guest keeps its handle and calls update on new props
  type Handle = { update?(props: any): void; unmount?(): void } | void | null | undefined
  const mountOf = (c: any) => (typeof c === "function" ? c : typeof c?.mount === "function" ? c.mount.bind(c) : null)
  const ctx = { emit: (event: string, ...args: unknown[]) => post("emit", { event, args }), router }
  async function mountInto(component: any, el: HTMLElement, p: any): Promise<Handle> {
    const m = mountOf(component)
    if (!m) throw new Error("a component is { mount(el, props, ctx) } or a function (el, props, ctx)")
    return await m(el, p, ctx)
  }

  let props: Record<string, unknown> = {}
  let kind = ""
  let snapshot: any = null
  let handle: Handle = null
  let root: HTMLElement | null = null
  let appDef: any = null
  let appRoute: any = null
  const surfaceProps = () =>
    kind === "list"
      ? { ...props, state: listStateOf(snapshot) }
      : kind === "app"
        ? { ...props, route }
        : { ...props, onChange: (v: unknown) => ctx.emit("update:value", v) }
  /** The app's route component for the current route, or null. */
  function appRouteOf(def: any) {
    const below = route.path.replace(new RegExp(`^/a/${def.id}/?`), "")
    return (
      (def.routes ?? []).find((x: any) => (x.path ?? "").replace(/^\//, "") === below) ??
      (def.routes ?? []).find((x: any) => !x.path) ??
      null
    )
  }
  async function draw() {
    if (!root) return
    try {
      if (kind === "app") {
        const hit = appRouteOf(appDef)
        if (hit !== appRoute) {
          if (handle && typeof handle === "object") handle.unmount?.()
          handle = null
          root.replaceChildren()
          appRoute = hit
          if (!hit?.component) {
            const p = document.createElement("p")
            p.textContent = `no route ${route.path}`
            root.appendChild(p)
            return
          }
          handle = await mountInto(hit.component, root, surfaceProps())
          return
        }
      }
      if (handle && typeof handle === "object" && handle.update) handle.update(surfaceProps())
    } catch (e) {
      post("error", { message: String(e) })
    }
  }
  async function mount(d: Msg) {
    const def = defs[d.kind]?.get(d.defId)
    if (!def) {
      post("error", { message: `the module registered no ${d.kind} '${d.defId}'` })
      return
    }
    routes = d.routes ?? []
    route = d.route ?? route
    props = { ...(d.props ?? {}) }
    kind = d.kind
    snapshot = d.state ?? null
    root = document.createElement("div")
    document.body.appendChild(root)
    try {
      if (kind === "app") {
        appDef = def
        appRoute = undefined
        await draw()
      } else handle = await mountInto(def.component, root, surfaceProps())
    } catch (e) {
      post("error", { message: String(e) })
    }
  }
  /** A View drawn into a detached element per cell, read back as markup, and unmounted. A renderer that draws
   *  asynchronously (React's root, Vue's scheduler) has a task to finish before the markup is read. */
  async function renderCells(d: Msg) {
    const def = defs.view.get(d.viewId)
    const cells: Array<{ key: string; html: string }> = []
    for (const c of d.cells ?? []) {
      const el = document.createElement("div")
      try {
        const h = await mountInto(def?.component, el, c.props ?? {})
        await new Promise(r => setTimeout(r, 0))
        cells.push({ key: c.key, html: el.innerHTML })
        if (h && typeof h === "object") h.unmount?.()
      } catch {
        cells.push({ key: c.key, html: "" })
      }
    }
    parent.postMessage({ dt: 1, id: ++seq, op: "cells", replyTo: d.id, cells }, "*")
  }
  function paste(textIn: string) {
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
    if (!el) return
    const data = new DataTransfer()
    data.setData("text/plain", textIn)
    const ev = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })
    if (el.dispatchEvent(ev) && "setRangeText" in el) {
      el.setRangeText(textIn, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, "end")
      el.dispatchEvent(new Event("input", { bubbles: true }))
    }
  }
  function theme(t: any) {
    if (!t) return
    for (const [k, v] of Object.entries(t.vars ?? {})) document.documentElement.style.setProperty(k, String(v))
    if (t.scheme) document.body.className = t.scheme
  }

  addEventListener("message", async ev => {
    if (ev.source !== parent) return
    const d = ev.data as Msg
    if (!d || d.dt !== 1) return
    if (d.reply !== undefined && pending.has(d.id)) {
      pending.get(d.id)!(d.reply)
      pending.delete(d.id)
      return
    }
    switch (d.op) {
      case "init":
        await ready
        theme(d.theme)
        if (d.surface === "registry") {
          const definitions = Object.entries(defs).flatMap(([kind, m]) =>
            [...m.values()].map((x: any) => ({
              kind,
              id: x.id,
              name: x.name,
              types: x.types ?? [],
              scope: x.scope,
              fillsHeight: x.fillsHeight,
              summarizes: x.summarizes,
              icon: x.icon,
              label: x.label,
              routes: (x.routes ?? []).map((r: any) => ({ path: r.path ?? "" })),
            }))
          )
          post("registered", { definitions, kindDefaults })
        } else await mount(d)
        break
      case "props":
        props = { ...props, ...(d.props ?? {}) }
        await draw()
        break
      case "state":
        snapshot = d.state
        await draw()
        break
      case "route": {
        const from = route
        for (const g of guards) {
          try {
            if ((await g(d.route, from)) === false) return
          } catch {
            /* a guard's error is the module's */
          }
        }
        route = d.route
        for (const cb of routeListeners) cb(route)
        await draw()
        break
      }
      case "theme":
        theme(d.theme)
        break
      case "invalidate":
        dispatchEvent(new CustomEvent("dt:invalidate", { detail: d.detail }))
        break
      case "render-cells":
        await ready
        await renderCells(d)
        break
      case "paste":
        paste(String(d.text ?? ""))
        break
    }
  })
})()
