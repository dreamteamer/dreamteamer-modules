/**
 * ONE fetch cache for "give me this record, by reference", shared across every component instance.
 *
 * ⚠ It has to live in a plain module. Bindings declared inside `<script setup>` run PER INSTANCE, so
 * a cache there dedupes nothing across the cells of a column — which is the whole reason this
 * exists: a table of 90 rows pointing at 20 distinct logos should issue 20 requests, not 90.
 *
 * Keyed `collection/id`. A miss issues one `GET /items/:collection/:id`; a failure resolves to null
 * rather than rejecting, so a bad or stale reference neither wedges the cache with a rejected
 * promise nor re-fires on every re-render.
 *
 * ⚠ BOTH HALVES ARE ENCODED, and the collection is the half that was missed. The adapter splits that
 * path on `/` and takes ONE segment as the collection (`api/adapter.ts`, the `items` branch), which
 * is why every other caller passes `encodeURIComponent(collection)`. This one did not — so a
 * NAMESPACED target (`introspection/collaborators`) was cut at its first slash, the request went to
 * a collection called `introspection` with a nonsense id, and the fetch resolved to null. Silently:
 * a null here is indistinguishable from a dangling reference, so every relation cell and every band
 * header pointing at a namespaced collection just kept showing the de-slugged path and looked like
 * a display choice. Found 2026-09-08 by a gantt banded on `collaborators`.
 *
 * Extracted from ViewRelation (0.12.0) when group headers needed the same thing for their icons —
 * two caches would have been two answers to "what is this reference", and the second one would have
 * been a cache miss for every row the first had already paid for.
 */
import { api } from '../api/client';
import type { ItemRecord } from '../api/types';

const recordCache = new Map<string, Promise<ItemRecord | null>>();

/** Forget every fetched record — the refresh button's first step, so the next read goes to the host. */
export function resetRecordCache(): void {
	recordCache.clear();
}

export function fetchRecord(collection: string, id: string): Promise<ItemRecord | null> {
	const key = `${collection}/${id}`;
	let promise = recordCache.get(key);
	if (!promise) {
		promise = api
			.get<ItemRecord>(`/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`)
			.then((res) => res.data)
			.catch(() => null);
		recordCache.set(key, promise);
	}
	return promise;
}
