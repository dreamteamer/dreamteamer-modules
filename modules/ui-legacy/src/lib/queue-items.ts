/**
 * Ask in chat (cr-modules-017 §6): a command the page queues for the chat's next prompt. The button is offered only
 * where a hook ran for this workspace in the last 24 hours — GET /host's `chat` — so it never draws in the editor
 * and never queues items no hook will deliver (round-3 finding ask-in-chat-is-keyed-on-the-entry…); an item reads
 * Waiting until a hook delivers it, and Expired an hour after it was queued.
 */
import type { QueueItem } from '@dreamteamer/protocol/pane';
import type { CommandRow } from './command-rows';

export type { QueueItem };

/** 'Waiting' · 'Delivered 14:02' · 'Expired'. */
export function itemLabel(i: QueueItem, locale?: string): string {
	if (i.state === 'expired') return 'Expired';
	if (i.state !== 'delivered') return 'Waiting';
	const at = i.deliveredAt ? new Date(i.deliveredAt) : null;
	if (!at || Number.isNaN(at.getTime())) return 'Delivered';
	return `Delivered ${at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

/** The chat can be asked: a hook ran here in the last 24 hours, and the row has an invocation to queue. */
export function canAsk(h: { chat: boolean } | null, row: CommandRow): boolean {
	return h?.chat === true && row.invocation !== null;
}
