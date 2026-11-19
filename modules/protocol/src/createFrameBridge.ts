// The frame bridge (cr-modules-008 §2; cr-modules-007 §4a): a message counts only when its source is a frame
// the host registered, and a frame whose document is ever replaced stops counting.

export interface FrameBridge<M = unknown> {
  add(win: object, meta: M): void
  remove(win: object): void
  loaded(win: object): void
  accept(event: {
    source: unknown
    data: unknown
  }): { meta: M; msg: { dt: 1; id: unknown; op: string; [k: string]: unknown } } | null
  reply(win: { postMessage(m: unknown, t: string): void }, id: unknown, reply: unknown): void
  post(win: { postMessage(m: unknown, t: string): void }, msg: Record<string, unknown>): void
}

export function createFrameBridge<M = unknown>(): FrameBridge<M> {
  const frames = new Map<unknown, { meta: M; loads: number }>() // window → { meta, loads }
  return {
    add(win, meta) {
      frames.set(win, { meta, loads: 0 })
    },
    remove(win) {
      frames.delete(win)
    },
    /** Call on every `load` of the frame element; the second load drops the frame. */
    loaded(win) {
      const f = frames.get(win)
      if (!f) return
      if (++f.loads > 1) frames.delete(win)
    },
    accept(event) {
      const f = frames.get(event?.source)
      const d = event?.data as { dt: 1; id: unknown; op: string; [k: string]: unknown } | null
      if (!f || !d || d.dt !== 1 || d.id === undefined || typeof d.op !== "string") return null
      return { meta: f.meta, msg: d }
    },
    reply(win, id, reply) {
      if (frames.has(win)) win.postMessage({ dt: 1, id, reply }, "*")
    },
    post(win, msg) {
      if (frames.has(win)) win.postMessage({ dt: 1, ...msg }, "*")
    },
  }
}
