/**
 * TOASTS (cr-modules-022): a write says how it went without a person looking for it. One module-level list, drawn by
 * ToastHost under the browser shell (an editor draws none — the store fills and caps itself there, unseen). Ported
 * from the Vue ui's lib/toasts.ts.
 *
 * A success leaves by itself after TOAST_MS; an error stays until it is dismissed, because a failed write is the one
 * thing a person must not miss. At most TOAST_MAX show at once: the oldest success goes first, then the oldest of all.
 */
import { signal } from "./signal.ts"

export type ToastKind = "success" | "error" | "info"
export interface Toast {
  id: number
  kind: ToastKind
  text: string
  detail?: string
}

export const TOAST_MAX = 4
export const TOAST_MS = 4000

export const toasts = signal<Toast[]>([])
let seq = 0
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function stopTimer(id: number): void {
  const t = timers.get(id)
  if (!t) return
  clearTimeout(t)
  timers.delete(id)
}

export function dismissToast(id: number): void {
  stopTimer(id)
  toasts.set(toasts.get().filter(x => x.id !== id))
}

export function toast(kind: ToastKind, text: string, detail?: string): number {
  const id = ++seq
  let next: Toast[] = [...toasts.get(), { id, kind, text, ...(detail ? { detail } : {}) }]
  while (next.length > TOAST_MAX) {
    const drop = next.find(x => x.kind !== "error" && x.id !== id) ?? next[0]!
    stopTimer(drop.id)
    next = next.filter(x => x !== drop)
  }
  toasts.set(next)
  if (kind !== "error") {
    const t = setTimeout(() => dismissToast(id), TOAST_MS)
    // a pending dismissal never keeps a non-browser runtime (a test) alive
    ;(t as { unref?: () => void }).unref?.()
    timers.set(id, t)
  }
  return id
}

/** Run a write and report it: `ok` as a success toast, or `fail` and the host's sentence as a sticky error. The
 *  write's own result or rejection passes through unchanged, so a caller's inline handling still runs. */
export async function reported<T>(work: () => Promise<T>, ok: string, fail: string): Promise<T> {
  try {
    const out = await work()
    toast("success", ok)
    return out
  } catch (e) {
    toast("error", fail, e instanceof Error ? e.message : String(e))
    throw e
  }
}
