/**
 * useCollections(): a single module-level cache of `GET /collections` — the flat overview
 * rows (`tree`) plus the workspace's unregistered `data/` folders (`raw['unregistered']`).
 * Every caller shares the same fetch; `reload()` refetches; `registerFolder(path)` runs
 * `POST /utils/infer` (the studio's one-click "adopt this folder" affordance) then reloads.
 */
import { ref } from 'vue';
import { api } from '../api/client';
import type { CollectionRow, UnregisteredFolder } from '../api/types';

const tree = ref<CollectionRow[]>([]);
const unregistered = ref<UnregisteredFolder[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
let loaded = false;

async function load(): Promise<void> {
	loading.value = true;
	error.value = null;

	try {
		const res = await api.get<CollectionRow[]>('/collections');
		tree.value = res.data;
		unregistered.value = (res.raw['unregistered'] as UnregisteredFolder[] | undefined) ?? [];
		loaded = true;
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err);
	} finally {
		loading.value = false;
	}
}

/**
 * Re-read the overview IF something has already read it. Called by the schema refresh
 * (`lib/schema-refresh.ts`) on a compile that happened while this tab was open.
 *
 * The `loaded` guard is the whole difference from `reload`: a tab whose pages never asked for the
 * overview must not be made to fetch it by a background invalidation.
 */
export async function refreshCollections(): Promise<void> {
	if (!loaded) return;
	await load();
}

/** The last overview read's failure, or null — `load` catches into `error` and resolves, so a
 *  caller that has to REPORT a failed re-read (the refresh button) asks here. */
export function collectionsError(): string | null {
	return error.value;
}

async function registerFolder(path: string): Promise<void> {
	await api.post('/utils/infer', { paths: [path] });
	await load();
}

export function useCollections() {
	if (!loaded) void load();

	return { tree, unregistered, loading, error, reload: load, registerFolder };
}
