/**
 * Saved-view state shape (phase E scope item 4): the full "how am I browsing this collection"
 * snapshot — layout, search, filter tree, sort, and visible columns — that a saved view captures
 * and re-applies. Kept framework-free (no Vue imports) so it's cheaply unit-testable, mirroring
 * `lib/filter-query.ts`'s pure-logic-plus-thin-UI split: `composables/browse-state.ts` and
 * `composables/saved-views.ts` are the Vue-facing shells around this.
 */
import { emptyFilterGroup, type FilterGroup } from './filter-query';

/**
 * A registered list-layout id. Was the closed union `'table' | 'cards'`; widened to `string` for
 * the platform port (spec §8) so a saved view / URL can name a **module-provided** list layout
 * (e.g. `kanban`), not just the two built-ins. The registry (and lib/presets.ts#resolveRendererEntry)
 * is the authority on which ids actually resolve — an unregistered id degrades to the built-in
 * table there rather than being rejected here.
 */
export type BrowseLayout = string;

export interface ViewState {
	layout: BrowseLayout;
	search: string;
	filter: FilterGroup;
	sort: string;
	columns: string[];
	/** Per-List declared-option values, keyed by list id (Task 5). Absent on pre-Task-5 saved
	 *  views; `parseViewState`/`applyViewState` default it to `{}`. */
	listOptions: Record<string, Record<string, unknown>>;
}

export function defaultViewState(columns: string[] = []): ViewState {
	return { layout: 'table', search: '', filter: emptyFilterGroup(), sort: '', columns, listOptions: {} };
}

function isValidLayout(value: unknown): value is BrowseLayout {
	return typeof value === 'string' && value.length > 0;
}

function isFilterGroup(value: unknown): value is FilterGroup {
	if (value === null || typeof value !== 'object') return false;
	const v = value as { logic?: unknown; rules?: unknown };
	return (v.logic === '_and' || v.logic === '_or') && Array.isArray(v.rules);
}

/** JSON-serialize a `ViewState` for storage (the `.schema/presets` record's `state` field). */
export function serializeViewState(state: ViewState): string {
	return JSON.stringify(state);
}

/**
 * Parse a stored/URL-carried view state back into a `ViewState`, never throwing — malformed or
 * partial input (an old saved view, a hand-edited preset record) degrades field-by-field to the
 * default rather than rejecting the whole view, matching the rest of the studio's "never an
 * error" posture (`lib/filter-query.ts#parseFilterGroup`'s same contract).
 */
export function parseViewState(raw: string | null | undefined): ViewState | null {
	if (!raw) return null;

	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== 'object') return null;

		const obj = parsed as Record<string, unknown>;
		const layout = isValidLayout(obj['layout']) ? obj['layout'] : 'table';
		const search = typeof obj['search'] === 'string' ? obj['search'] : '';
		const filter = isFilterGroup(obj['filter']) ? (obj['filter'] as FilterGroup) : emptyFilterGroup();
		const sort = typeof obj['sort'] === 'string' ? obj['sort'] : '';
		const columns = Array.isArray(obj['columns']) ? obj['columns'].filter((c): c is string => typeof c === 'string') : [];
		const listOptions =
			obj['listOptions'] !== null && typeof obj['listOptions'] === 'object'
				? (obj['listOptions'] as Record<string, Record<string, unknown>>)
				: {};

		return { layout, search, filter, sort, columns, listOptions };
	} catch {
		return null;
	}
}
