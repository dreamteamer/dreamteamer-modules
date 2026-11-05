/**
 * What an app tab does with the host's `dt:invalidate` (src/changes.ts `invalidateMessage`).
 *
 * ORDER IS THE POINT: the ui-view table and (unless only records moved) the schema caches are
 * re-read and SETTLE first, then — only when the host asked for `pages`, which only the refresh
 * button does — the open page re-fetches its records, against the refreshed schema.
 *
 * SETTLE, NOT SUCCEED. A schema re-read that fails (a descriptor mid-compile) must not cancel the
 * page re-fetch the operator clicked for: the records may well be readable. The failure is written to
 * the console and never thrown into the message loop.
 *
 * Imports nothing, so tier 1 can pin the order with stub dependencies.
 */

export interface InvalidateDeps {
	loadUiViews: () => Promise<unknown>;
	refreshSchema: () => Promise<unknown>;
	refreshPages: () => unknown;
	warn?: (...args: unknown[]) => void;
}

export async function handleInvalidate(m: { scope?: string; pages?: boolean }, deps: InvalidateDeps): Promise<void> {
	const warn = deps.warn ?? ((...a: unknown[]) => console.warn(...a));
	const work: Array<Promise<unknown>> = [deps.loadUiViews()];
	// An older host sends no scope at all — treat that as `schema` (App.vue's long-standing rule).
	if (m.scope !== 'data') work.push(deps.refreshSchema());
	for (const r of await Promise.allSettled(work)) {
		if (r.status === 'rejected') warn('dreamteamer: refresh —', r.reason);
	}
	if (m.pages) {
		try {
			deps.refreshPages();
		} catch (err) {
			warn('dreamteamer: page refresh —', err);
		}
	}
}
