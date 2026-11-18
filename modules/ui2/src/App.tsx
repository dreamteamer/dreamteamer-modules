/**
 * THE APP — the nav beside the page the route names. It owns the route (moved by `dt:navigate` from the host
 * and by in-app links, reported back with `dt:route`) and the workspace's schema, the display contract (re-read on every
 * `dt:invalidate`). A signed-out session draws one sentence instead.
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { getPresentation, notify, request } from "./api/client.ts"
import { AppContext, EMPTY_SCHEMA, RouteBase, useApp, useAsync, useSignal, type AppState } from "./AppContext.tsx"
import { Nav } from "./components/Nav.tsx"
import { canEdit, hostInfo, loadHost, paneHost, SIGNED_OUT, signedOut } from "./lib/host.ts"
import { navHistory, peek, step, visit } from "./lib/navHistory.ts"
import { placeOf, type PaneView } from "./lib/panePlace.ts"
import { receiveSelect, startPaneReport } from "./lib/paneReport.ts"
import { signal } from "./lib/signal.ts"
import { mayLeave } from "./lib/leaveGuard.ts"
import { pageOf, pathOf, settingsRedirect } from "./lib/createRoute.ts"
import { loadUiViews, uiViews } from "./lib/uiViews.ts"
import { buildSchema } from "./lib/schema.ts"
import "./registry/register-defaults.ts"
import { HomePage } from "./pages/HomePage.tsx"
import { ListPage } from "./pages/ListPage.tsx"
import { RecordPage } from "./pages/RecordPage.tsx"
import { PageView } from "./pages/PageView.tsx"
import { ViewPage } from "./pages/ViewPage.tsx"
import { SchemaTab } from "./settings/SchemaTab.tsx"
import { AppPage } from "./modules/host.tsx"
import { cx, error, page as pageFrame, subtle } from "./styles/classes.ts"

/** The page's place, in the shapes the pane reports (lib/panePlace.ts) — set on every route change. */
const place = signal<PaneView>({ other: true })

/** `onMounted` runs once, after the first commit: the message listener is in place, so the host's answer to
 *  `dt:mounted` (the route to show) cannot arrive before anything listens. */
export function App({ onMounted }: { onMounted?: () => void }) {
  const out = useSignal(signedOut)
  const host = useSignal(hostInfo)
  const [route, setRoute] = useState("/")
  const [version, setVersion] = useState(0)
  const mounted = useRef(false)
  // the route as of the last render — what a refused move puts back
  const routeNow = useRef(route)
  routeNow.current = route

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const m = e.data as { type?: string; route?: unknown } | null
      if (m?.type === "dt:navigate" && typeof m.route === "string") {
        // an old address (`/settings/data-model/…`) lands where it moved
        const to = settingsRedirect(m.route) ?? m.route
        // a page with unsaved changes may refuse; the host's address (the hash) is put back
        if (mayLeave(routeNow.current, to)) {
          routeNow.current = to
          navHistory.set(visit(navHistory.get(), to))
          setRoute(to)
        } else notify("dt:route", { route: routeNow.current })
      }
      if (m?.type === "dt:invalidate") setVersion(v => v + 1)
      // cr-modules-017: the level, the chat flag or the files key changed on the server — ask GET /host again
      if (m?.type === "dt:host") void loadHost(request)
      // cr-modules-017 §5: the chat ticked rows (`dt web select`) — tick them here, on that collection's list
      if (m?.type === "dt:select")
        receiveSelect((m as { refs?: unknown }).refs, {
          collections: namesNow.current,
          here: place.get(),
          navigate: navigateNow.current,
        })
    }
    window.addEventListener("message", onMessage)
    // once, though StrictMode runs effects twice in development
    if (!mounted.current) {
      mounted.current = true
      notify("dt:mounted")
      onMounted?.()
    }
    return () => window.removeEventListener("message", onMessage)
  }, [onMounted])

  const navigate = useCallback((wanted: string) => {
    const to = settingsRedirect(wanted) ?? wanted
    if (!mayLeave(routeNow.current, to)) return
    routeNow.current = to
    navHistory.set(visit(navHistory.get(), to))
    setRoute(to)
    notify("dt:route", { route: to })
  }, [])
  const navigateNow = useRef(navigate)
  navigateNow.current = navigate

  const go = useCallback((delta: number) => {
    const to = peek(navHistory.get(), delta)
    if (to === null || !mayLeave(routeNow.current, to)) return
    routeNow.current = to
    navHistory.set(step(navHistory.get(), delta))
    setRoute(to)
    notify("dt:route", { route: to })
  }, [])

  // dev-loop handle: a driver reads which route this tab shows
  useEffect(() => {
    document.documentElement.dataset["dtRoute"] = route
  }, [route])

  const presentation = useAsync(getPresentation, [version])
  // the ui-view table, re-read with everything else: a view's route is a page only once it is known
  useEffect(() => void loadUiViews(), [version])
  const schema = useMemo(() => (presentation.data ? buildSchema(presentation.data) : null), [presentation.data])
  const views = useSignal(uiViews)
  const names = schema?.names ?? EMPTY_SCHEMA.names
  const namesNow = useRef(names)
  namesNow.current = names
  useEffect(() => {
    // a re-read schema is a new object naming the same place: only a different place is a change to report
    const next = placeOf(pageOf(route, names, views ?? []))
    if (JSON.stringify(next) !== JSON.stringify(place.get())) place.set(next)
  }, [route, names, views])

  // cr-modules-017 §5: on a pane host the page reports its place and ticked rows to the server the chat's hook reads.
  // GET /host answered before mount (main-browser), so a page that is not a pane host never starts the reporter.
  const pane = paneHost(host)
  useEffect(() => (pane ? startPaneReport({ place, request }) : undefined), [pane])
  const app: AppState = useMemo(
    () => ({
      route,
      navigate,
      go,
      schema: schema ?? EMPTY_SCHEMA,
      editable: canEdit(host),
      version,
      refresh: () => setVersion(v => v + 1),
    }),
    [route, navigate, go, schema, host, version]
  )

  if (out) return <p className="p-6 text-fg-subtle">{SIGNED_OUT}</p>

  return (
    <AppContext.Provider value={app}>
      <div
        className="grid grid-cols-[260px_1fr] h-full max-[720px]:grid-cols-1 max-[720px]:grid-rows-[auto_1fr]"
        data-shell
      >
        <Nav />
        <main className="overflow-auto min-w-0">
          {presentation.error && <p className={error}>{presentation.error}</p>}
          {schema && (
            // keyed on the PATH: a query (`?filter=…`) is the page's own state, written back as it changes; a module
            // app keeps its frame across its own routes (`/a/<id>/…`), which it hears as messages
            <Boundary key={pathOf(route).replace(/^(\/a\/[^/]+)\/.*$/, "$1")}>
              <Page />
            </Boundary>
          )}
        </main>
      </div>
    </AppContext.Provider>
  )
}

function Page() {
  const { route, schema } = useApp()
  const views = useSignal(uiViews)
  const page = pageOf(route, schema.names, views ?? [])
  switch (page.kind) {
    case "home":
      return <HomePage />
    case "list":
      return (
        <RouteBase.Provider value={page.base ?? "/content"}>
          <ListPage collection={page.collection} />
        </RouteBase.Provider>
      )
    case "record":
      return (
        <RouteBase.Provider value={page.base ?? "/content"}>
          <RecordPage collection={page.collection} id={page.id} viewId={page.viewId} />
        </RouteBase.Provider>
      )
    case "create":
      return (
        <RouteBase.Provider value={page.base ?? "/content"}>
          <RecordPage collection={page.collection} id={null} />
        </RouteBase.Provider>
      )
    case "settings":
      return <SchemaTab tail={page.tail} />
    case "view":
      return <ViewPage id={page.id} />
    case "page-view":
      return <PageView viewId={page.id} source={page.source} />
    case "app":
      return <AppPage id={page.id} />
    case "app-page":
      // ui: the registered app named by the view's `display.list.layout`, its index route
      return <AppPage id={page.layout} />
    case "unknown-collection":
      return <p className={error}>No collection {page.path} in this workspace.</p>
    case "unsupported":
      if (views === null) return null // the view table is still being read
      return (
        <p className={cx(pageFrame, subtle)}>
          <code>{page.route}</code> is not a page this app draws.
        </p>
      )
  }
}

/** A page that throws draws its error and leaves the nav working; the next route starts clean. */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) return <p className={error}>This page failed: {this.state.error.message}</p>
    return this.props.children
  }
}
