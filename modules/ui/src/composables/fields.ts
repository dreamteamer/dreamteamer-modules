/**
 * useFields(collection): per-collection cache of `GET /fields/:collection` plus derived
 * helpers (`visibleFields`, `pkField`, `bodyField`, `relationTargets`, `isRelationList`).
 *
 * Relation targets resolve from ONE cached `GET /relations` fetch (all rows, normalized
 * shape `{ collection, field, related_collection, meta }` — top-level `related_collection`
 * is the target). We deliberately never call `/relations/<collection-path>`: the greedy
 * routing shim (`server/src/rest/list.ts`, `collectionPathShim`) only rewrites nested
 * collection paths for `/items/`, `/fields/`, `/collections/`, and the `/utils/*` write
 * helpers — `/relations/` is absent from that prefix list, so a nested path like
 * `crm/contacts` fed to `/relations/crm/contacts` would mis-route into the
 * `/relations/:collection/:field` route instead of `/relations/:collection`. Fetching the
 * full flat list once and filtering client-side sidesteps the mis-route entirely.
 */
import { computed, ref } from 'vue';
import { api } from '../api/client';
import type { FieldRow } from '../api/types';
import { drawnOn, isBodyField, isRelationList as isRelationListRow } from '../lib/field-row';
import { SOURCE_FIELD } from '../lib/sources';
import { withComputedRows } from '../lib/computed-fields';
import { useCollections } from './collections';

export interface RelationRow {
	collection: string;
	field: string;
	related_collection: string | null;
	/** The field holds an ARRAY of references. */
	list?: boolean;
	/** OWNING side of a two-way relation — the engine's own three names (`src/relations.js`):
	 *  `m2o` many-to-one, `o2o` one-to-one, `m2m` many-to-many. Absent on a mirror row, and absent
	 *  on a reference nothing mirrors. */
	kind?: 'm2o' | 'o2o' | 'm2m';
	/** This row is the GENERATED far end. One relation emits two rows; filter these out to count
	 *  edges rather than sides. */
	mirror?: true;
	meta?: unknown;
}

/** One row per RELATION rather than per side — the owner's row, which carries the cardinality. */
export function ownerRows(rows: RelationRow[]): RelationRow[] {
	return rows.filter((r) => r.mirror !== true);
}

let relationsPromise: Promise<RelationRow[]> | null = null;

/**
 * Exported for EditRelation's fallback target-resolution path (Task 4): when a
 * composing view doesn't pass `targetCollection` explicitly, the interface searches this
 * same cached flat list by field name. Normal usage (ItemForm, Task 6) resolves the target
 * via `useFields(ownerCollection).relationTargets` instead, which is unambiguous.
 */
export function loadRelations(): Promise<RelationRow[]> {
	if (!relationsPromise) {
		relationsPromise = api.get<RelationRow[]>('/relations').then((res) => res.data);
	}
	return relationsPromise;
}

/** Drop the cached relations list — schema writes call this so relation targets refresh. */
export function invalidateRelations(): void {
	relationsPromise = null;
	fieldsPromises.clear();
	allFieldsPromises.clear();
}

const fieldsPromises = new Map<string, Promise<FieldRow[]>>();
const allFieldsPromises = new Map<string, Promise<FieldRow[]>>();

/**
 * One collection's visible field rows, cached and shared.
 *
 * The filter field TREE needs the fields of collections this one merely references — `person`'s
 * fields to offer `person.name` — and it discovers which ones only as the operator expands. So the
 * fetch has to be per-collection and on demand, rather than `useFields`'s eager per-component load:
 * expanding four relations must not mean four component instances and four duplicate requests.
 * Invalidated with the relations list, since a schema write can change both.
 */
export function loadFields(collection: string): Promise<FieldRow[]> {
	let hit = fieldsPromises.get(collection);
	if (!hit) {
		hit = api.get<FieldRow[]>(`/fields/${encodeURIComponent(collection)}`)
			.then((res) => res.data.filter(isVisible))
			// A collection we cannot read is an empty branch, not a broken picker — same posture as
			// the rest of the studio. The operator sees a relation that opens onto nothing.
			.catch(() => []);
		fieldsPromises.set(collection, hit);
	}
	return hit;
}

/**
 * EVERY field row of a collection, hidden ones included — what the designer has to ask when it is
 * about to write a field NAME onto another collection. `loadFields` filters to what a form should
 * draw, and a name collision does not care whether the field it collides with is drawn: a hidden
 * field is still a taken name, and a hidden foreign key is still the key.
 */
export function loadAllFields(collection: string): Promise<FieldRow[]> {
	let hit = allFieldsPromises.get(collection);
	if (!hit) {
		hit = api.get<FieldRow[]>(`/fields/${encodeURIComponent(collection)}`)
			.then((res) => res.data)
			.catch(() => []);
		allFieldsPromises.set(collection, hit);
	}
	return hit;
}

/**
 * Drawn on at least one surface. A field hidden from `list`, `form` AND `record` (the injected `id`,
 * a deprecated field) is drawn nowhere and never offered; one hidden from only some surfaces stays,
 * and each surface drops it where it is hidden (`lib/field-row.ts#drawnOn`).
 */
function isVisible(field: FieldRow): boolean {
	// `$source` is the one synthetic key that IS a column (`lib/sources.ts`); every other `$` key is
	// a wire implicit no surface draws as a field
	if (field.field.startsWith('$') && field.field !== SOURCE_FIELD) return false;
	return drawnOn(field, 'list') || drawnOn(field, 'form') || drawnOn(field, 'record');
}

function createFieldsState(collection: string) {
	const fields = ref<FieldRow[]>([]);
	const loading = ref(false);
	const error = ref<string | null>(null);
	const relationTargets = ref<Map<string, string>>(new Map());

	// The collection's row of the overview, for its `sources`: a collection with a foreign root — a
	// layer, a module-owned list — gets the `$source` column appended to its visible rows, so the
	// Source column, the filter builder and the group-by axis see one more field like any other.
	// `fields` (the engine's rows, raw) is untouched: the designer edits those, and `$source` is not
	// a field anyone can author. A collection reading only its own root gets nothing — it looks
	// exactly as it did (design rule 1).
	const { tree } = useCollections();
	const sources = computed(() => tree.value.find((row) => row.collection === collection)?.sources);
	const visibleFields = computed(() => {
		const rows = fields.value.filter(isVisible);
		// the computed fields every record has (module, modified by, created by) — offered wherever a
		// field is, never shown by default (`lib/computed-fields.ts`); only once the schema has loaded
		const computed = withComputedRows(rows, collection, sources.value);
		// no "(computed)" suffix when a title collides with an authored one (a provenance `source` beside
		// `$source`): a computed field is told apart by being drawn DIMMED (`computedReason`), never by label text
		return computed;
	});
	// The record's address. Every collection's is `id` (descriptor v2 §3.6: injected, virtual).
	const pkField = computed(() => 'id');
	const bodyField = computed(() => fields.value.find(isBodyField)?.field ?? null);

	async function load(): Promise<void> {
		loading.value = true;
		error.value = null;

		try {
			const [fieldsRes, relations] = await Promise.all([api.get<FieldRow[]>(`/fields/${encodeURIComponent(collection)}`), loadRelations()]);
			fields.value = fieldsRes.data;

			const targets = new Map<string, string>();
			for (const row of relations) {
				if (row.collection === collection && row.related_collection) {
					targets.set(row.field, row.related_collection);
				}
			}
			relationTargets.value = targets;
		} catch (err) {
			error.value = err instanceof Error ? err.message : String(err);
		} finally {
			loading.value = false;
		}
	}

	function isRelationList(field: string): boolean {
		const row = fields.value.find((f) => f.field === field);
		return row ? isRelationListRow(row) : false;
	}

	void load();

	return { fields, visibleFields, pkField, bodyField, relationTargets, loading, error, reload: load, isRelationList };
}

const fieldsCache = new Map<string, ReturnType<typeof createFieldsState>>();

/**
 * Re-read every field state a mounted component is currently holding.
 *
 * ⚠ NOT `fieldsCache.clear()`. The cached value is a live reactive state object that components
 * already hold a reference to — clearing the map orphans them, so the next `useFields` builds a
 * SECOND state while the mounted form goes on rendering the first one's stale fields forever.
 * Reloading in place is what actually reaches the screen.
 */
export function reloadCachedFields(): Promise<void[]> {
	return Promise.all([...fieldsCache.values()].map((state) => state.reload()));
}

/** Every cached field state's last failure, as `collection: message` — each state catches into its own
 *  `error` and resolves, so this is how a re-read that failed is told apart from one that did not. */
export function cachedFieldErrors(): string[] {
	return [...fieldsCache.entries()].flatMap(([collection, state]) => (state.error.value ? [`${collection}: ${state.error.value}`] : []));
}

export function useFields(collection: string) {
	let state = fieldsCache.get(collection);

	if (!state) {
		state = createFieldsState(collection);
		fieldsCache.set(collection, state);
	}

	return state;
}
