/**
 * WHAT A BROWSE STARTS FROM — the governing view record over the collection's own `display.list`
 * (descriptor v2, §3.5): "the collection's `display` IS what a bare route renders", and a view is a
 * named variant merged over it KEY BY KEY — a key the view sets wins, a key it omits is the
 * collection's.
 *
 * Pure and its own module, because precedence is a decision and a decision buried in a composable
 * that drags a router can only be tested by mounting one.
 */
import type { CollectionRow } from '../api/types';

/** What a governing view record contributes (`collection-views.ts#viewToConfig`, or a page's props). */
export interface ViewSeed {
	layout?: string;
	columns?: string[];
	sort?: string;
	listOptions?: Record<string, Record<string, unknown>>;
}

export interface ListSeed {
	layout: string;
	/** The column set and order, or null when neither the view nor the collection names one — the
	 *  caller's heuristic decides then. */
	columns: string[] | null;
	/** Undefined when neither names a sort: the list keeps whatever order it already has. `''` is a
	 *  view saying "unsorted", and it wins. */
	sort: string | undefined;
	/** Per-layout options, keyed by layout id. */
	listOptions: Record<string, Record<string, unknown>>;
}

/**
 * WHERE A BROWSE'S UNSAVED TWEAKS ARE KEPT — the key of the in-memory scratch pad (`useBrowseState`),
 * one per collection AND per governing view, so a density or a column picked on `/people/recent`
 * never leaks onto the bare `/people`, and an embedded browse (`scope`) never shares the page's.
 * The pad is deliberately NOT localStorage: a record is the durable home (Save in the drawer), and a
 * reload returning to what git says is the property that keeps "what I see" and "what is
 * committed" from drifting apart across sessions.
 */
export function scratchKey(collection: string, viewId?: string, scope?: string): string {
	return `${collection}::${viewId ?? 'default'}${scope ? `::${scope}` : ''}`;
}

export function listSeed(view: ViewSeed | undefined, list: CollectionRow['list'] | undefined): ListSeed {
	const layout = view?.layout ?? list?.layout ?? 'table';
	const columns = view?.columns?.length ? [...view.columns] : list?.columns?.length ? [...list.columns] : null;
	const sort = view?.sort ?? list?.sort;
	// the collection's options belong to the collection's layout; the view's sit on top of them
	const listOptions: Record<string, Record<string, unknown>> = {};
	if (list?.options && Object.keys(list.options).length) listOptions[list.layout] = { ...list.options };
	for (const [id, opts] of Object.entries(view?.listOptions ?? {})) listOptions[id] = { ...listOptions[id], ...opts };
	return { layout, columns, sort, listOptions };
}
