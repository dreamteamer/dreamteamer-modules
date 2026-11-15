/**
 * What every page reads: the route and how to move it, the workspace's descriptors, whether edits are offered,
 * and the invalidation counter — bumped on every `dt:invalidate` the host posts, so a page that keys its fetch
 * on it re-reads when the workspace changes on disk.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react"
import type { Descriptor } from "./api/client.ts"
import type { Signal } from "./lib/signal.ts"

export interface AppState {
  route: string
  navigate(route: string): void
  descriptors: Descriptor[]
  /** Every collection name the workspace has, runtime ones included. */
  collections: string[]
  editable: boolean
  version: number
}

export const AppContext = createContext<AppState | null>(null)

export function useApp(): AppState {
  const app = useContext(AppContext)
  if (!app) throw new Error("ui2: useApp outside <App>")
  return app
}

export function useSignal<T>(s: Signal<T>): T {
  return useSyncExternalStore(s.subscribe, s.get, s.get)
}

export type Async<T> = { loading: true; error?: undefined; data?: T } | { loading: false; error?: string; data?: T }

/** Run `load` whenever `deps` change; the last answer wins. A failure is kept as `error`, the previous data
 *  stays on screen while a re-read is in flight. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): Async<T> {
  const [state, setState] = useState<Async<T>>({ loading: true })
  useEffect(() => {
    let live = true
    setState(s => ({ ...s, loading: true, error: undefined }))
    load().then(
      data => live && setState({ loading: false, data }),
      (err: unknown) => live && setState({ loading: false, error: err instanceof Error ? err.message : String(err) })
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are the caller's
  }, deps)
  return state
}
