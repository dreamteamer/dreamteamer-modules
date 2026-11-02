/**
 * Pure echo-guard decision for EditMarkdownBody's controlled-CM6 value-prop watcher (ported from
 * the archived dreamteamer-studio prototype's `editor-guard.js`, wave 17). No Vue/CM6 imports —
 * pure functions.
 *
 * The bug this guards against: every keystroke round-trips out via `update:value` and typically
 * straight back in via the `value` prop. Under rapid, overlapping keystrokes, a stale render's
 * `value` can lag behind a later keystroke already applied to the live CM6 doc; a plain
 * `value !== liveDoc` check would then dispatch a "corrective" reset back to the stale text —
 * itself a doc change that re-fires the same cycle, oscillating indefinitely. The editor
 * therefore remembers the last few texts it ITSELF emitted (a ring, updated synchronously inside
 * the CM6 update listener); an incoming `value` matching the live doc OR anything in the ring is
 * an echo of our own typing — never reset on it. Only a value we never produced (external
 * refetch, revert) is a genuine reset.
 *
 * A ring, not a single slot: a single "last emitted" always mirrors the live doc (both advance in
 * the same synchronous dispatch), so it can't recognize the INTERMEDIATE text a stale render
 * captured. The ring keeps those around for the handful of renders that can still be in flight.
 */
export const RING_SIZE = 4;

/** Append `text` to `ring` (oldest-first), capped at `maxSize`. Pure — returns a new array. */
export function pushEmitted(ring: string[], text: string, maxSize = RING_SIZE): string[] {
	const next = ring.concat([text]);
	return next.length > maxSize ? next.slice(next.length - maxSize) : next;
}

/** True when `incoming` is a genuine external change worth resetting the doc to — i.e. it matches
 * neither the live doc nor anything this editor recently emitted itself. */
export function shouldReset(incoming: string, liveDoc: string, recentEmitted: string[]): boolean {
	if (incoming === liveDoc) return false;
	return !recentEmitted.includes(incoming);
}
