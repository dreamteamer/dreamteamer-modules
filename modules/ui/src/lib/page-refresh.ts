/**
 * "Re-fetch what the open page shows" — the signal the refresh button ends in.
 *
 * The record composables (`useItems`, `useItem`) and the band-label resolver subscribe for their
 * lifetime; `requestPageRefresh` runs them all. A plain module-level list rather than a Vue event,
 * because a list layout and a record page are not each other's parents and both must hear it, and
 * because this file imports NOTHING — tier 1 bundles it, and a Vue or transport import here would put
 * `window` in that bundle (see `schema-refresh.ts`).
 *
 * Only the refresh button fires it (`dt:invalidate` with `pages: true`). The watcher does not: it
 * fires on every agent write, and a page re-fetch on each would be a request storm.
 */

const subscribers = new Set<() => void>();

/** Subscribe; returns the unsubscribe. */
export function onPageRefresh(fn: () => void): () => void {
	subscribers.add(fn);
	return () => {
		subscribers.delete(fn);
	};
}

/** Run every subscriber, in subscription order; a throwing one is logged and skipped. Returns how many ran. */
export function requestPageRefresh(): number {
	let ran = 0;
	for (const fn of [...subscribers]) {
		try {
			fn();
			ran++;
		} catch (err) {
			console.warn('dreamteamer: a page refresh subscriber failed —', err);
		}
	}
	return ran;
}
