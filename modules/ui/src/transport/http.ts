/**
 * THE HTTP TRANSPORT — the UI served by a web host (dt web) on the same origin as its `/api`. Ported from
 * the Vue ui's transport/http.ts, same behaviour:
 *
 * Requests go to `/api/*` with the session cookie. Server-sent events on `/api/events` and the address bar's
 * hash come back as window `message` events, the same as a webview's host sends them: the hash IS the route
 * (`dt:mounted` → `dt:navigate` from the hash; `dt:route` → the hash). A 401 from any request means the session
 * is gone and `signedOut` is set.
 *
 * When the event stream drops, the transport asks `GET /host` itself: a 401 signs the page out, no answer a few
 * times over means the server (and every session in its memory) is gone, which signs it out too; an answer means
 * the session holds, and a stream the browser gave up is opened again.
 *
 * It keeps the browser's OWN fetch, taken when the transport is made, so nothing that patches `fetch` later
 * can route the transport's requests back into itself.
 */
import { HostError, type Transport } from "./types.ts"
import { filesBase, loadHost, signedOut } from "../lib/host.ts"

const STREAM_OPEN = 1
const STREAM_CLOSED = 2
/** How many times GET /host gets no answer at all before the page reads the server as gone. */
const NO_ANSWER_TRIES = 3

export interface HttpTransportOptions {
  /** The first wait between re-checks after the event stream drops; each next one doubles. Tests shorten it. */
  recheckMs?: number
}

export function httpTransport({ recheckMs = 1000 }: HttpTransportOptions = {}): Transport {
  const nativeFetch = window.fetch.bind(window)
  const post = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data }))
  const route = () => location.hash.slice(1) || "/"
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
  window.addEventListener("hashchange", () => post({ type: "dt:navigate", route: route() }))

  let events: EventSource | null = null
  let opened = false
  let checking = false

  const openEvents = () => {
    const source = new EventSource("/api/events")
    events = source
    // a change made while the stream was down is never sent again: every open after the first refetches
    source.onopen = async () => {
      const again = opened
      opened = true
      if (!again) return
      await loadHost((method, path, body) => transport.request(method, path, body))
      post({ type: "dt:invalidate", scope: "schema", pages: true })
    }
    source.onmessage = e => {
      try {
        const m = JSON.parse(e.data) as { type?: string }
        post(m?.type === "dt:invalidate" ? { ...m, pages: true } : m)
      } catch {
        /* a keep-alive or a malformed event — nothing to deliver */
      }
    }
    source.onerror = () => void recheck()
  }

  const recheck = async (): Promise<void> => {
    if (checking || signedOut.get()) return
    checking = true
    try {
      for (let tries = 0, wait = recheckMs; ; tries++, wait *= 2) {
        if (events?.readyState === STREAM_OPEN) return
        try {
          await transport.request("GET", "/host")
        } catch (err) {
          if (signedOut.get()) return
          if (err instanceof HostError && err.status === 0) {
            if (tries + 1 >= NO_ANSWER_TRIES) {
              signedOut.set(true)
              return
            }
            await sleep(wait)
            continue
          }
        }
        if (events?.readyState === STREAM_CLOSED) openEvents()
        return
      }
    } finally {
      checking = false
      if (signedOut.get()) events?.close()
    }
  }

  if (typeof EventSource !== "undefined") openEvents()

  const transport: Transport = {
    async request(method, path, body) {
      const init: RequestInit = { method, credentials: "same-origin", headers: {} }
      if (body !== undefined) {
        init.body = JSON.stringify(body)
        ;(init.headers as Record<string, string>)["content-type"] = "application/json"
      }
      let res: Response
      try {
        res = await nativeFetch(`/api${path}`, init)
      } catch (err) {
        throw new HostError(String(err), 0)
      }
      const text = await res.text()
      let data: unknown = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = text
      }
      if (res.ok) return data
      if (res.status === 401) signedOut.set(true)
      const error =
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : String(res.status)
      throw new HostError(error, res.status)
    },
    notify(type, payload) {
      const m = (payload ?? {}) as { route?: string; path?: string }
      if (type === "dt:mounted") post({ type: "dt:navigate", route: route() })
      else if (type === "dt:route" && typeof m.route === "string") history.replaceState(null, "", `#${m.route}`)
      else if (type === "dt:open" && typeof m.route === "string") window.open(`#${m.route}`, "_blank", "noopener")
      else if (type === "dt:open-file" && typeof m.path === "string" && filesBase()) {
        const file = m.path.split("/").map(encodeURIComponent).join("/")
        window.open(`${filesBase()}/w/${file}?frame=1`, "_blank", "noopener")
      }
    },
  }
  return transport
}
