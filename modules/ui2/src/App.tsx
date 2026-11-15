/**
 * THE APP — the nav beside the page the route names. It owns the route (moved by `dt:navigate` from the host
 * and by in-app links, reported back with `dt:route`) and the workspace's schema, the display contract (re-read on every
 * `dt:invalidate`). A signed-out session draws one sentence instead.
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { getPresentation, notify } from "./api/client.ts"
import { AppContext, EMPTY_SCHEMA, useApp, useAsync, useSignal, type AppState } from "./app-context.tsx"
import { Nav } from "./components/Nav.tsx"
import { canEdit, hostInfo, SIGNED_OUT, signedOut } from "./lib/host.ts"
import { mayLeave } from "./lib/leave-guard.ts"
import { pageOf, pathOf } from "./lib/route.ts"
import { loadUiViews, uiViews } from "./lib/ui-views.ts"
import { buildSchema } from "./lib/schema.ts"
import "./registry/register-defaults.ts"
import { HomePage } from "./pages/HomePage.tsx"
import { ListPage } from "./pages/ListPage.tsx"
import { RecordPage } from "./pages/RecordPage.tsx"
import { ViewPage } from "./pages/ViewPage.tsx"

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
        // a page with unsaved changes may refuse; the host's address (the hash) is put back
        if (mayLeave(routeNow.current, m.route)) setRoute(m.route)
        else notify("dt:route", { route: routeNow.current })
      }
      if (m?.type === "dt:invalidate") setVersion(v => v + 1)
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

  const navigate = useCallback((to: string) => {
    if (!mayLeave(routeNow.current, to)) return
    routeNow.current = to
    setRoute(to)
    notify("dt:route", { route: to })
  }, [])

  const presentation = useAsync(getPresentation, [version])
  // the ui-view table, re-read with everything else: a view's route is a page only once it is known
  useEffect(() => void loadUiViews(), [version])
  const schema = useMemo(() => (presentation.data ? buildSchema(presentation.data) : null), [presentation.data])
  const app: AppState = useMemo(
    () => ({
      route,
      navigate,
      schema: schema ?? EMPTY_SCHEMA,
      editable: canEdit(host),
      version,
    }),
    [route, navigate, schema, host, version]
  )

  if (out) return <p className="ui2-signed-out">{SIGNED_OUT}</p>

  return (
    <AppContext.Provider value={app}>
      <div className="ui2-shell">
        <Nav />
        <main className="ui2-main">
          {presentation.error && <p className="ui2-error">{presentation.error}</p>}
          {schema && (
            // keyed on the PATH: a query (`?filter=…`) is the page's own state, written back as it changes
            <Boundary key={pathOf(route)}>
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
      return <ListPage collection={page.collection} />
    case "record":
      return <RecordPage collection={page.collection} id={page.id} viewId={page.viewId} />
    case "create":
      return <RecordPage collection={page.collection} id={null} />
    case "view":
      return <ViewPage id={page.id} />
    case "unknown-collection":
      return <p className="ui2-page ui2-error">No collection {page.path} in this workspace.</p>
    case "unsupported":
      if (views === null) return null // the view table is still being read
      return (
        <p className="ui2-page ui2-subtle">
          <code>{page.route}</code> is a page @dreamteamer/ui draws; ui2 does not draw it yet.
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
    if (this.state.error) return <p className="ui2-page ui2-error">This page failed: {this.state.error.message}</p>
    return this.props.children
  }
}
