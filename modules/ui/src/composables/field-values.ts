/**
 * A field's real value vocabulary, for filter-value dropdowns.
 *
 * Why: the filter builder can only offer choices when something declares them, and `enum` is the
 * only thing that does — so a plain `type: string` field filtered by a free-text box you had to
 * know the vocabulary of by heart (operator 2026-07-28: "still no dropdown for many things,
 * visibility, status — why?"). `meetings.status` is exactly that: no enum, but only ever
 * `confirmed` or `manual` in 114 records.
 *
 * The engine derives it from the records (`GET /collections/:c/values/:f`, same op as
 * `dreamteamer <c> values <field>`) rather than the schema, so nothing has to be enum'd — and no
 * record can be invalidated by an enum someone adds after the fact.
 *
 * Fetched lazily per (collection, field) and cached at MODULE level: the filter panel mounts and
 * unmounts every time it opens, and re-reading every collection's vocabulary on each open would be
 * a directory walk per field. Cache is keyed by collection+field and never invalidated within a
 * session — a vocabulary that gains one value mid-session is not worth a refetch strategy; reopening
 * the window is the escape hatch.
 */
import { ref, type Ref } from 'vue';
import { api } from '../api/client';

export interface FieldValueChoice {
	text: string;
	value: unknown;
}

interface ValuesPayload {
	values: Array<{ value: unknown; count: number | null }>;
	total: number;
	truncated: boolean;
	skipped?: string;
}

/** null = not (yet) known / not offerable; an array = render a dropdown of exactly these. */
const cache = new Map<string, Ref<FieldValueChoice[] | null>>();

/**
 * Choices for `collection.field`, or null while loading / when a dropdown is the wrong control.
 * Deliberately null when the engine reports `truncated`: a 50-of-800 dropdown hides more than it
 * offers, and silently dropping the other 750 from an equality filter would be worse than a text box.
 */
export function fieldValues(collection: string, field: string): Ref<FieldValueChoice[] | null> {
	const key = `${collection}::${field}`;
	const hit = cache.get(key);
	if (hit) return hit;

	const out = ref<FieldValueChoice[] | null>(null);
	cache.set(key, out);

	void (async () => {
		try {
			const { data } = await api.get<ValuesPayload>(
				`/collections/${encodeURIComponent(collection)}/values/${encodeURIComponent(field)}`,
			);
			if (data.skipped || data.truncated || !data.values?.length) return;
			out.value = data.values.map(({ value }) => ({ text: String(value), value }));
		} catch {
			// no engine support, unknown field, or a read error — the caller falls back to free text
		}
	})();

	return out;
}
