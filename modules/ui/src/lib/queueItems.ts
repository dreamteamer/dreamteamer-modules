/**
 * Ask in chat (cr-modules-017 §6): a command the page queues for the chat's next prompt. The button is offered only
 * where a hook ran for this workspace in the last 24 hours — GET /host's `chat` — so it never draws in the editor
 * and never queues items no hook will deliver; an item reads Waiting until a hook delivers it, and Expired an hour
 * after it was queued. Copied from the Vue ui's lib/queue-items.ts; `QueueItem` is copied from
 * @dreamteamer/protocol's pane.d.ts (ui takes no protocol dependency — the shape is the wire's, PROTOCOL.md
 * `POST /queue`).
 */
import type { CommandRow } from "./commandRows.ts"

/** One queued ask — `GET /queue`'s item (copied from @dreamteamer/protocol `pane.d.ts`). */
export interface QueueItem {
  id: string
  command: string
  refs: string[]
  invocation: string
  state: "waiting" | "delivered" | "expired"
  queuedAt: string
  deliveredAt?: string
}

/** 'Waiting' · 'Delivered 14:02' · 'Expired'. */
export function itemLabel(i: QueueItem, locale?: string): string {
  if (i.state === "expired") return "Expired"
  if (i.state !== "delivered") return "Waiting"
  const at = i.deliveredAt ? new Date(i.deliveredAt) : null
  if (!at || Number.isNaN(at.getTime())) return "Delivered"
  return `Delivered ${at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false })}`
}

/** The chat can be asked: a hook ran here in the last 24 hours, and the row has an invocation to queue. */
export function canAsk(h: { chat: boolean } | null, row: CommandRow): boolean {
  return h?.chat === true && row.invocation !== null
}
