/**
 * The record form's SECTIONS for one collection (descriptor v2 §3.5 `display.form.sections`), read
 * off the collection's own row of the display contract (`useCollections`), where the engine already
 * carries them — the same overview every other collection-level display answer comes from, refreshed
 * by the same schema invalidation.
 *
 * Shared by both record layouts — `ItemForm` and `ItemProperties` — so the two cannot disagree about
 * what a section is or which fields it holds; `lib/field-row.ts#formSections` is the arrangement. A
 * collection the overview does not (yet) carry draws its fields unsectioned, never a broken page.
 */
import { computed, type ComputedRef } from 'vue';
import type { CollectionRow } from '../api/types';
import { useCollections } from './collections';

export type FormSectionSpec = CollectionRow['form']['sections'][number];

export function useFormSections(collection: () => string | undefined): ComputedRef<FormSectionSpec[]> {
	const { tree } = useCollections();
	return computed(() => {
		const name = collection();
		if (!name) return [];
		return tree.value.find((r) => r.collection === name)?.form?.sections ?? [];
	});
}
