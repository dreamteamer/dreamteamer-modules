/**
 * MOUNT — the one call a host makes, the same signature as the Vue ui's: wire the transport, teach
 * `fetch('/api/…')` to go through it (code built against the HTTP contract still calls it), load the workspace's
 * module apps BEFORE the first render so the registries hold their proxies (modules/host.tsx), render the app,
 * then say `dt:mounted` — the host answers with the route to show (`dt:navigate`).
 *
 * ui-views are read by the app itself (App.tsx, on every invalidation), not here: a view's route is a page as
 * soon as the table arrives, and a page view whose layout names a module app finds the app already registered.
 */
import { createRoot } from "react-dom/client"
import { StrictMode } from "react"
import { App } from "./App.tsx"
import { request, setTransport } from "./api/client.ts"
import { installApiFetchShim } from "./api/installApiFetchShim.ts"
import { loadModules } from "./modules/host.tsx"
import type { Transport } from "./transport/HostError.ts"

export interface MountOptions {
  transport: Transport
}

export async function mount(el: string | Element, { transport }: MountOptions): Promise<void> {
  setTransport(transport)
  const target = typeof el === "string" ? document.querySelector(el) : el
  if (!target) throw new Error(`ui: no element ${String(el)}`)
  installApiFetchShim(request)
  // never rejects: a failed read or a broken module is warned about and the app boots without it
  await loadModules()
  // the app says `dt:mounted` itself, after its first commit, when its message listener is in place
  return new Promise(resolve =>
    createRoot(target).render(
      <StrictMode>
        <App onMounted={resolve} />
      </StrictMode>
    )
  )
}
