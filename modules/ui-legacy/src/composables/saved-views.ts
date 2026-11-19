/**
 * Saved views + platform presets (terminology decision 2026-07-23: "Views are records" now live in
 * the `.schema/presets` system collection, record_type `preset`). A record is a `.preset.yaml` file
 * in the workspace, browsable/committable like any other record; the server ships a built-in
 * descriptor for it, and every save/delete is an attributed git commit.
 *
 * NOTE: the composable keeps its historical name `useSavedViews` (and `views` output) this task —
 * renaming the symbol is churn without benefit; the underlying collection and record shape are what
 * moved to the Preset terminology.
 *
 * Two shapes coexist on this one collection:
 *   - LEGACY saved views carry a serialized `state` (lib/view-state.ts) — the "save current browse
 *     state as a named view" feature. Exposed as `views` (used by the view-switcher UI).
 *   - PLATFORM presets carry `target`/`renderer`/`mode`/`options`/`default` directly (schema
 *     extended for the port). Exposed as `records` (used by lib/presets.ts to resolve which renderer
 *     renders a collection). A record may have either or both — saved views migrate in place.
 */
import { computed, ref } from 'vue';
import { api } from '../api/client';
import { parseViewState, serializeViewState, type ViewState } from '../lib/view-state';
import type { PresetMode, PresetRecord, PresetTarget } from '../lib/presets';

const PRESETS_COLLECTION = '.schema/presets';

export interface SavedView {
	id: string;
	name: string;
	collection: string;
	state: ViewState;
}

interface RawPresetRecord {
	id: string | number;
	collection?: unknown;
	name?: unknown;
	state?: unknown;
	target?: unknown;
	renderer?: unknown;
	mode?: unknown;
	options?: unknown;
	default?: unknown;
	layer?: unknown;
	$bundle?: unknown;
}

function toSavedView(record: RawPresetRecord): SavedView | null {
	if (typeof record.collection !== 'string' || typeof record.name !== 'string') return null;
	const state = parseViewState(typeof record.state === 'string' ? record.state : null);
	if (!state) return null;
	return { id: String(record.id), name: record.name, collection: record.collection, state };
}

function toPresetRecord(record: RawPresetRecord): PresetRecord | null {
	if (typeof record.collection !== 'string') return null;
	const target: PresetTarget = record.target === 'item' ? 'item' : 'list';
	const layer = typeof record.layer === 'string' ? record.layer : typeof record.$bundle === 'string' ? record.$bundle : undefined;
	return {
		id: String(record.id),
		collection: record.collection,
		name: typeof record.name === 'string' ? record.name : undefined,
		target,
		renderer: typeof record.renderer === 'string' ? record.renderer : undefined,
		mode: record.mode === 'view' || record.mode === 'edit' ? (record.mode as PresetMode) : undefined,
		options: record.options !== null && typeof record.options === 'object' ? (record.options as Record<string, unknown>) : undefined,
		default: record.default === true,
		layer,
	};
}

export function useSavedViews(collection: string) {
	const views = ref<SavedView[]>([]);
	const records = ref<PresetRecord[]>([]);
	const loading = ref(false);
	const error = ref<string | null>(null);

	const sorted = computed(() => [...views.value].sort((a, b) => a.name.localeCompare(b.name)));

	async function reload(): Promise<void> {
		loading.value = true;
		error.value = null;

		try {
			const res = await api.get<RawPresetRecord[]>(`/items/${encodeURIComponent(PRESETS_COLLECTION)}`);
			const mine = res.data.filter((r) => r.collection === collection);
			views.value = mine.map(toSavedView).filter((v): v is SavedView => v !== null);
			records.value = mine.map(toPresetRecord).filter((v): v is PresetRecord => v !== null);
		} catch (err) {
			error.value = err instanceof Error ? err.message : String(err);
		} finally {
			loading.value = false;
		}
	}

	async function save(name: string, state: ViewState): Promise<void> {
		await api.post(`/items/${encodeURIComponent(PRESETS_COLLECTION)}`, { collection, name, state: serializeViewState(state) });
		await reload();
	}

	async function remove(id: string): Promise<void> {
		await api.delete(`/items/${encodeURIComponent(PRESETS_COLLECTION)}/${encodeURIComponent(id)}`);
		views.value = views.value.filter((v) => v.id !== id);
		records.value = records.value.filter((v) => v.id !== id);
	}

	void reload();

	return { views: sorted, records, loading, error, reload, save, remove };
}
