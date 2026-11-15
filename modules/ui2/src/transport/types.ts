/**
 * THE TRANSPORT: how the UI reaches its host — the same contract as @dreamteamer/ui's, so any host that mounts
 * one can mount the other. The app speaks one REST contract (PROTOCOL.md in @dreamteamer/protocol) and a handful
 * of notifications; a host hands `mount` the transport that carries them.
 *
 * What comes BACK from the host that is not a reply (`dt:navigate`, `dt:invalidate`, …) arrives as a window
 * `message` event, whichever transport delivered it, so the app listens in one place.
 */
export interface Transport {
  /** One clean-contract request; `path` is everything after `/api`. Rejects with a `HostError`. */
  request(method: string, path: string, body?: unknown): Promise<unknown>
  /** Fire-and-forget: open a file, follow a route, say the app mounted. */
  notify(type: string, payload?: unknown): void
  /** Persist this view's identity (route, pinning) where the host keeps it, when it keeps one. */
  setState?(state: unknown): void
}

export class HostError extends Error {
  declare status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "HostError"
    this.status = status
  }
}
