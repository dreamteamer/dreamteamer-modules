/**
 * ONE function that makes an open app tab agree with the compiled runtime again.
 *
 * ⚠ THE BUG THIS EXISTS FOR: the app is a long-lived SPA with five module-level caches of the
 * schema, and the host has posted `dt:invalidate` on every disk change since the tab existed —
 * but App.vue only ever re-read the ui-view table with it. So a collection compiled after the tab
 * opened was invisible to that tab: `useCollections().tree` still held the boot list,
 * `resolveContentPath` found nothing in it, and `/content/content/refinement-iterations` rendered
 * "Unknown collection" until the window was reloaded. Measured on a large private workspace 2026-08-29, with the
 * descriptor sitting compiled on disk the whole time.
 *
 * ORDER IS LOAD-BEARING, and it is the reason this is one function rather than four calls at the
 * call site. `/collections`, `/fields/:c` and `/relations` are all served OUT OF the adapter's
 * cached `/presentation` contract (api/adapter.ts) — so reloading them before dropping that
 * contract re-reads the same stale object and reports success. Invalidate first, always.
 *
 * ⚠ This module imports NOTHING. The caches it drives live behind `api/transport.ts`, which
 * registers a `window` message listener at import time — so importing them here would put `window`
 * in the tier-1 bundle and take the test down before a single assertion ran. The live wiring is
 * `composables/schema-caches.ts`; this file is the order, and the order is the part that is silent
 * when wrong.
 */

export interface SchemaCaches {
	/** drop the cached `/presentation` contract — MUST run before any re-read */
	invalidateContract: () => void;
	/** drop the cached `/info` */
	invalidateServerInfo: () => void;
	/** drop the cached `/relations` + per-collection field promises */
	invalidateRelations: () => void;
	/** re-read the collections overview, if anything had read it */
	refreshCollections: () => Promise<unknown>;
	/** re-read every field state a mounted component holds */
	reloadCachedFields: () => Promise<unknown>;
}

/**
 * Two phases, and they may not interleave: drop everything, THEN re-read. `caches` is a parameter
 * rather than a module import so tier 1 can pin that ordering.
 */
export async function refreshSchema(caches: SchemaCaches): Promise<void> {
	caches.invalidateContract();
	caches.invalidateServerInfo();
	caches.invalidateRelations();
	await Promise.all([caches.refreshCollections(), caches.reloadCachedFields()]);
}
