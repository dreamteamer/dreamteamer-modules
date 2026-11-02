/**
 * THE SOURCE PICKER'S STATE FOR A HAND-BUILT LIST — the two refs a browse hands `SourcePicker`
 * (`sourceFacets`, `filterGroup`), for the Schema tab's Collections and Modules pages, which are
 * tables of their own (`lib/sources.ts` § the picker on a hand-built list). Reads the kind's rows
 * once for each one's `$source`; the selection is the page's own, never written to the URL.
 */
import { computed, ref } from 'vue';
import { api, buildQuery } from '../api/client';
import type { SourceEntry } from '../api/types';
import { emptyFilterGroup, type FilterGroup } from '../lib/filter-query';
import { facetsOver, hasForeignSource, keepsSource } from '../lib/sources';

export function useSourceFilter(kind: 'collections' | 'modules', only: () => readonly string[] | null | undefined) {
	const sources = ref<SourceEntry[]>([]);
	const sourceById = ref(new Map<string, string>());
	const filterGroup = ref<FilterGroup>(emptyFilterGroup());

	void api
		.get<Array<Record<string, unknown>>>(`/items/${kind}${buildQuery({ limit: 1000 })}`)
		.then((res) => {
			sourceById.value = new Map(res.data.map((r) => [String(r.id), typeof r['$source'] === 'string' ? r['$source'] : '']));
			const meta = res.raw['meta'] as { sources?: SourceEntry[] } | undefined;
			sources.value = Array.isArray(meta?.sources) ? meta.sources : [];
		})
		.catch(() => {
			// no sources read: no picker, every row shown — the list itself still loads on its own
		});

	const sourceFacets = computed(() => facetsOver(sources.value, sourceById.value, only()));
	return {
		sourceFacets,
		filterGroup,
		/** Draw the picker only when a row can come from somewhere other than the workspace itself. */
		shown: computed(() => hasForeignSource(sourceFacets.value)),
		keeps: (id: string) => keepsSource(filterGroup.value, sourceById.value.get(id)),
	};
}
