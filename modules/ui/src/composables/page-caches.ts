/**
 * The live wiring for "re-fetch the open page" — the counterpart of `schema-caches.ts`.
 *
 * Lives in `composables/`, not `lib/`, for the same reason that one does: what it will reset reaches
 * `api/transport.ts`, which registers a `window` listener at import time, and tier 1 must not bundle
 * that.
 */
import { requestPageRefresh } from '../lib/page-refresh';
import { resetRecordCache } from '../lib/record-cache';
import { resetReferenceTitles } from '../lib/record-titles';

/**
 * Re-fetch what the open page shows. ORDER: drop the caches first, then signal — a subscriber that
 * re-reads before the record cache is cleared gets the old record back and reports success.
 */
export function refreshPages(): void {
	resetRecordCache();
	resetReferenceTitles();
	requestPageRefresh();
}
