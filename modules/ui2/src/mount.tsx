/**
 * MOUNT — the one call a host makes, the same signature as @dreamteamer/ui's: wire the transport, render the
 * app, then say `dt:mounted` — the host answers with the route to show (`dt:navigate`).
 *
 * Not here yet (ui has them): module apps (`app.js` bundles and the `fetch('/api/…')` shim they need) and
 * ui-views. A route to one draws a "not drawn yet" line, and the nav still lists it.
 */
import { createRoot } from "react-dom/client"
import { StrictMode } from "react"
import { App } from "./App.tsx"
import { setTransport } from "./api/client.ts"
import type { Transport } from "./transport/types.ts"

export interface MountOptions {
  transport: Transport
}

export function mount(el: string | Element, { transport }: MountOptions): Promise<void> {
  setTransport(transport)
  const target = typeof el === "string" ? document.querySelector(el) : el
  if (!target) return Promise.reject(new Error(`ui2: no element ${String(el)}`))
  // the app says `dt:mounted` itself, after its first commit, when its message listener is in place
  return new Promise(resolve =>
    createRoot(target).render(
      <StrictMode>
        <App onMounted={resolve} />
      </StrictMode>
    )
  )
}
