/**
 * A view record's filter, on the way IN to the builder and on the way back OUT to the record.
 *
 * Both halves used to live inline — the seeding in `browse-state.ts`, the saving in
 * `LayoutOptionsSection.vue` — and both got the same thing wrong, in the same way, for the same
 * stale reason (a `@me` hazard that died with the `users` collection in engine 0.8.0). They are
 * here, framework-free, because the interesting cases are decidable by running them: an opaque
 * filter, a cleared filter, and a URL filter arriving at a view that already has one.
 */
import { decompileFilter, compileFilter, emptyFilterGroup, parseFilterGroup, serializeFilterGroup, type FilterGroup } from './filter-query';

export interface SeededFilter {
	/** What the builder starts holding. */
	initial: FilterGroup;
	/** What the RECORD says, for `dirty` and Reset. `null` when the record's filter is opaque. */
	record: FilterGroup | null;
	/** True when the stored filter could not be decompiled — the builder never held it. */
	opaque: boolean;
}

/**
 * Seed the builder from a view's stored filter and the URL's.
 *
 * ⚠ Opacity is decided by the DECOMPILE alone. Deciding it by "did we seed" — which is false
 * whenever the URL carries a filter — declared a perfectly representable stored filter opaque on
 * arrival at `?filter=…`, and the caller then ANDs an opaque base underneath the operator's edit.
 * The edit appears to do nothing, which is the hardest kind of filter bug to see.
 *
 * `forceOpaque` is the one exception, and it is for a base filter that is SCOPE rather than a
 * filter: an embedded relation view is scoped to the ids its field names, and that set is not the
 * operator's to edit, to see as a chip, or to save into a view record. It decompiles perfectly
 * (`{id:{_in:[…]}}`), so nothing but this flag can say so — and without it a property row sprouts a
 * chip listing 52 record ids, carrying a ✕ that silently widens the row to the whole collection.
 */
export function seedFilter(baseFilter: unknown, urlFilter: string | null, forceOpaque = false): SeededFilter {
	const decompiled = forceOpaque ? null : decompileFilter(baseFilter);
	const opaque = Boolean(baseFilter) && !decompiled;
	const seeded = urlFilter ? null : decompiled;
	return {
		initial: seeded ?? parseFilterGroup(urlFilter),
		record: opaque ? null : (decompiled ?? emptyFilterGroup()),
		opaque,
	};
}

/**
 * What the builder should hold after the URL's `?filter=` changed underneath a mounted browse — a nav
 * row that differs only in its filter (each record layer's row), or back/forward. Null when there is
 * nothing to do: the URL is the builder's own write echoing back, or re-seeding gives what it already
 * holds. The browse reads the URL once at setup and the page is not remounted for a query-only change,
 * so without this the second layer's row showed the first layer's records (operator 2026-10-29).
 */
export function filterFromUrl(
	urlFilter: string | null,
	current: FilterGroup,
	baseFilter: unknown,
	forceOpaque = false,
): FilterGroup | null {
	if (urlFilter === serializeFilterGroup(current)) return null;
	const next = seedFilter(baseFilter, urlFilter, forceOpaque).initial;
	// compared compiled: a re-seed mints new rule ids, so the groups never match as objects
	return JSON.stringify(compileFilter(next) ?? null) === JSON.stringify(compileFilter(current) ?? null) ? null : next;
}

/**
 * The filter a Save writes: the builder's, compiled — unless the stored one is opaque, in which
 * case it is preserved verbatim because the builder cannot represent it and writing the builder's
 * version would flatten a nested group away.
 *
 * `undefined` means the key is OMITTED, which is how a filter is removed: the engine replaces the
 * source file, so an absent key is an absent filter.
 */
export function filterToWrite(
	group: FilterGroup,
	opts: { opaque: boolean; stored?: unknown },
): Record<string, unknown> | undefined {
	if (opts.opaque) return (opts.stored as Record<string, unknown> | undefined) ?? undefined;
	return compileFilter(group);
}
