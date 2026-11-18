/**
 * A value React components can subscribe to without a store library: `useSignal(s)` re-renders on `s.set`.
 * The host's boot values and the signed-out flag live in these, because the transport (plain TypeScript, no
 * React) writes them and the app reads them.
 */
export interface Signal<T> {
  get(): T
  set(value: T): void
  subscribe(listener: () => void): () => void
}

export function signal<T>(initial: T): Signal<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return
      value = next
      for (const l of [...listeners]) l()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
