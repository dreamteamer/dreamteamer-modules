/**
 * MODULE COMPATIBILITY SHIM — ported from the Vue ui's api/transport.ts `installApiFetchShim`.
 *
 * Code written against the documented HTTP contract calls `fetch('/api/…')`. Inside a webview there is no
 * server at `/api`, so that request dies; this teaches the page's `fetch` to answer `/api/*` from the host's
 * transport instead, with a real Response (`ok`, `status`, `json()`, `text()`), and leaves every other URL to
 * the browser. A module FRAME has its own copy in the guest; this one serves the page itself — anything a host
 * or a module loads into it that still speaks `/api`.
 *
 * Installed by `mount` before anything else runs. Safe under the HTTP transport too: that transport keeps the
 * browser's own fetch, taken when it was made, so its requests never come back through here.
 */
import { HostError } from "../transport/types.ts"

type Request = (method: string, path: string, body?: unknown) => Promise<unknown>

/** Patch `target.fetch` (the window) so `/api` and `/api/*` go through `request`. Returns the undo. */
export function installApiFetchShim(request: Request, target: { fetch: typeof fetch } = window): () => void {
  const original = target.fetch.bind(target)
  target.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    if (!url.startsWith("/api/") && url !== "/api") return original(input, init)
    const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")
    let body: unknown
    if (init?.body) {
      try {
        body = JSON.parse(String(init.body))
      } catch {
        body = init.body
      }
    }
    try {
      return jsonResponse(200, await request(String(method).toUpperCase(), url.slice(4) || "/", body))
    } catch (err) {
      const status = err instanceof HostError ? err.status : 500
      return jsonResponse(status, { error: err instanceof Error ? err.message : String(err) })
    }
  }
  return () => {
    target.fetch = original
  }
}

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data ?? null), {
    status,
    statusText: status < 400 ? "OK" : "Error",
    headers: { "content-type": "application/json" },
  })
}
