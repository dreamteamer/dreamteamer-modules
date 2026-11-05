/**
 * `useItems(collection)`: the tabular-browse data source — list state (items/loading/error),
 * pagination (page/limit), sort (`setSort` toggles `field` ↔ `-field`), search, and `total`
 * read from the server's `?meta=filter_count` response (never inferred from a page being
 * short — the server only computes the count when asked, so we always ask). Changing
 * page/limit/sort/search reactively refetches.
 *
 * `useItem(collection, id | null)`: single-record editing state. `setField` tracks only
 * fields that differ from the last-loaded record — setting a field back to its original
 * value drops it from `edits` again, so `save()` always PATCHes an exact, minimal diff.
 * `id === null` is create mode: `save()` POSTs `edits` and returns the created record; the
 * view is responsible for navigating to the new record's id afterward (this composable
 * instance stays bound to `id === null` for its lifetime — mirrors T2's stateless design).
 */
import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue';
import { onPageRefresh } from '../lib/page-refresh';
import { api, buildQuery, type QueryParams } from '../api/client';
import type { ItemRecord, SourceEntry } from '../api/types';
import { DEFAULT_SORT } from '../lib/builtin-fields';

/** `notes`: ask the host for each row's `$notes` — what an extension says about it (a session holding
 *  it). Only the browse list asks; every note read costs one engine call (cr-vscode-005). */
export function useItems(collection: string, opts: { notes?: boolean } = {}) {
	const items = ref<ItemRecord[]>([]);
	const loading = ref(false);
	const error = ref<string | null>(null);
	/** Why this machine cannot read the collection (an env-pointed root whose var is unset) — not an error:
	 *  the page draws, says so, and offers no create (cr-vscode-019). */
	const unavailable = ref<string | null>(null);
	const page = ref(1);
	const limit = ref(25);
	// Default sort (operator ask 2026-07-27): most-recently-touched-in-git first, on every
	// collection, until a saved view or a column click overrides it. Universal, not per-collection
	// config — every collection has the engine's `last_modified` (the host stamps the date on each row
	// under that name and the v1 `last-modified`), null for the handful (skills/agents/commands/…)
	// whose compiled records have no git history, which sorts them after everything with a real date.
	// ⚠ The ENGINE's name, never the wire key: a Save writes this sort, and compile knows only
	// `last_modified` (cr-vscode-011, `lib/builtin-fields.ts`).
	const sort = ref(DEFAULT_SORT);
	const search = ref('');
	// Server `filter` param (C2 spec item 1) — the filter-builder compiles its rule tree down to
	// this shape (`lib/filter-query.ts#compileFilter`) and the caller assigns it here; `undefined`
	// means "no filter", not "filter on nothing".
	const filter = ref<Record<string, unknown> | undefined>(undefined);
	// `fields` is the raw `?fields=` query value (e.g. '*' or '*,assignee.*' for relation
	// expansion — Task 5/DataTable owns building this string). Reactive like the other params:
	// changing it (e.g. the browse view's column selection resolving) refetches.
	const fields = ref('');
	const total = ref(0);
	// Every source of the collection with the records the CURRENT query reads from it — counted by the
	// host over the filtered rows before the page is cut (`meta.sources`), so the facet strip's counts
	// hold still as you page. Empty until the first response, and on a host that answers none.
	const sources = ref<SourceEntry[]>([]);

	// DataTable fires several `reload()`s in quick succession as it boots: an unparameterized
	// first call, then one once column selection resolves `fields` to `'*'`, then again once
	// `useFields`'s relation targets resolve `fields` to `'*,<relField>.*'` (see DataTable.vue's
	// `columns` watcher). These are real HTTP round-trips with no ordering guarantee — the
	// LAST-ISSUED request is the only one whose result should ever win, but network completion
	// order can (and, observed via the C1 E2E gate's browser walk, DOES) differ from issue order:
	// an earlier, less-specific request finishing after a later, more-specific one would silently
	// overwrite correctly-expanded relation data with unexpanded raw values. Guard with a sequence
	// token — only the response matching the most recently issued request is applied.
	let requestSeq = 0;

	async function reload(): Promise<void> {
		const seq = ++requestSeq;
		loading.value = true;
		error.value = null;

		try {
			const query: QueryParams = { limit: limit.value, page: page.value, meta: 'filter_count' };
			if (sort.value) query.sort = sort.value;
			if (search.value) query.search = search.value;
			if (fields.value) query.fields = fields.value;
			if (filter.value) query.filter = filter.value;
			if (opts.notes) query.notes = 1;

			const res = await api.get<ItemRecord[]>(`/items/${encodeURIComponent(collection)}${buildQuery(query)}`);
			if (seq !== requestSeq) return; // superseded by a newer reload — never apply a stale response

			items.value = res.data;
			const meta = res.raw['meta'] as { filter_count?: number; sources?: SourceEntry[]; unavailable?: string } | undefined;
			unavailable.value = typeof meta?.unavailable === 'string' ? meta.unavailable : null;
			total.value = meta?.filter_count ?? 0;
			sources.value = Array.isArray(meta?.sources) ? meta.sources : [];
		} catch (err) {
			if (seq !== requestSeq) return;
			error.value = err instanceof Error ? err.message : String(err);
		} finally {
			if (seq === requestSeq) loading.value = false;
		}
	}

	function setSort(field: string): void {
		sort.value = sort.value === field ? `-${field}` : field;
	}

	watch([page, limit, sort, search, fields, filter], () => void reload());
	void reload();
	// The refresh button: the same question again — page, sort, search and filter are kept.
	listenForPageRefresh(() => void reload());

	return { items, loading, error, unavailable, page, limit, sort, search, fields, filter, total, sources, setSort, reload };
}

/** Deep-equal enough for record fields: primitives by `===`, arrays/objects (relations) by JSON shape. */
function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === undefined || b === undefined) return false;
	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch {
		return false;
	}
}

export function useItem(collection: string, id: string | null) {
	const record = ref<ItemRecord | null>(null);
	const loaded = ref<ItemRecord>({});
	const edits = ref<ItemRecord>({});
	const loading = ref(false);
	const error = ref<string | null>(null);

	const dirty = computed(() => Object.keys(edits.value).length > 0);
	/** The refresh button skipped this record because it holds unsaved edits — ContentDetail says so. */
	const refreshSkipped = ref(false);
	watch(dirty, (now) => {
		if (!now) refreshSkipped.value = false;
	});
	// The refresh button: re-read the record — unless that would throw the operator's typing away.
	listenForPageRefresh(() => {
		if (id === null) return;
		if (dirty.value) {
			refreshSkipped.value = true;
			return;
		}
		void load();
	});

	async function load(): Promise<void> {
		if (id === null) return;
		loading.value = true;
		error.value = null;

		try {
			// Encode the pk: nested file-shape ids contain '/' (e.g. 2026/07/kickoff) and must
			// arrive as ONE path segment or the greedy collection-path shim misparses the route.
			const res = await api.get<ItemRecord>(`/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`);
			record.value = res.data;
			loaded.value = { ...res.data };
			edits.value = {};
			refreshSkipped.value = false;
		} catch (err) {
			error.value = err instanceof Error ? err.message : String(err);
		} finally {
			loading.value = false;
		}
	}

	function setField(field: string, value: unknown): void {
		if (sameValue(value, loaded.value[field])) {
			if (field in edits.value) {
				const rest = { ...edits.value };
				delete rest[field];
				edits.value = rest;
			}
		} else {
			edits.value = { ...edits.value, [field]: value };
		}
	}

	/** `target` — a create only: the root the create form chose (cr-vscode-004), sent as `?target=`. */
	async function save(target?: string | null): Promise<ItemRecord | null> {
		if (id === null) {
			const res = await api.post<ItemRecord>(`/items/${encodeURIComponent(collection)}${target ? `?target=${encodeURIComponent(target)}` : ''}`, edits.value);
			record.value = res.data;
			loaded.value = { ...res.data };
			edits.value = {};
			return res.data;
		}

		if (!dirty.value) return record.value;

		const res = await api.patch<ItemRecord>(`/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, edits.value);
		record.value = res.data;
		loaded.value = { ...res.data };
		edits.value = {};
		return res.data;
	}

	/** Drop all pending edits (detail view's Cancel) — record/loaded stay as last fetched. */
	function discard(): void {
		edits.value = {};
	}

	async function remove(): Promise<void> {
		if (id === null) return;
		await api.delete(`/items/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`);
	}

	return { record, edits, dirty, loading, error, refreshSkipped, setField, load, save, remove, discard };
}

/** Subscribe to the page-refresh signal for the lifetime of the calling effect scope (a component's
 *  setup), or for good when there is none. */
function listenForPageRefresh(fn: () => void): void {
	const off = onPageRefresh(fn);
	if (getCurrentScope()) onScopeDispose(off);
}
