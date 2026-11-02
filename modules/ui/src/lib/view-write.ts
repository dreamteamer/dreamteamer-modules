/**
 * WHAT A "SAVE" IN THE LAYOUT OPTIONS PANEL WRITES — pure, so the shape is pinned by tier 1.
 *
 * Descriptor v2 (§3.5): a collection's default view is its own `display.list`, and a `ui-view` is a
 * NAMED variant carrying the same block. So a browse has exactly two places to save to:
 *
 *  - a NAMED view governing the page → the view record, rewritten whole (`saveUiView` replaces the
 *    source): its route, scope and collection, every `display` sub-block it already carried (`nav`
 *    included — this panel has no control for it), `display.list` from the screen, and the filter.
 *  - the collection's OWN display → `dt set collections/<c>` by v2 path, in ONE write: its
 *    `display.list.columns`, `display.list.sort`, `display.list.layout` when the screen's differs, and
 *    each layout option as `display.list.options.<key>` — the engine reads an option value as JSON
 *    where it parses, so every value is sent AS its JSON text (a string option `'25'` stays a string),
 *    and an option the screen no longer holds is sent empty, which prunes it. A FILTER is not part of
 *    a collection's display (§3.5: a view carries `filter`, a collection does not), so it is named
 *    back as unsaved rather than dropped silently — the remedy is a named view.
 */
import type { UiViewRecord, ViewDisplay } from '../ui-views';

/** What the screen shows, as a view's list block holds it. */
export interface ListPresentation {
	layout: string;
	columns: string[];
	/** `''` is "explicitly unsorted", and is written as such. */
	sort: string;
	/** The active layout's options. */
	options: Record<string, unknown>;
}

/** A ui-view source as the transport writes it (`id` beside the fields, or derived from `route`). */
export interface ViewWrite {
	name?: string;
	route: string;
	scope: 'collection';
	collection: string;
	title?: string;
	description?: string;
	filter?: Record<string, unknown>;
	display: ViewDisplay;
}

function listBlock(p: ListPresentation): NonNullable<ViewDisplay['list']> {
	return { layout: p.layout, columns: [...p.columns], sort: p.sort, ...(Object.keys(p.options).length ? { options: { ...p.options } } : {}) };
}

/** The whole source of an EXISTING named view, with the screen's list and filter. */
export function namedViewWrite(existing: UiViewRecord, collection: string, p: ListPresentation, filter: Record<string, unknown> | undefined): ViewWrite {
	return {
		route: existing.route,
		scope: 'collection',
		collection: `collections/${collection}`,
		// every top-level key the view carries and this panel does not edit goes back as it came: the
		// write REPLACES the view, and over a package's view an omitted key becomes `key: null` in the
		// overlay — a removal nobody asked for (review finding drawer-save-nulls-name)
		...(existing.name ? { name: existing.name } : {}),
		...(existing.title ? { title: existing.title } : {}),
		...(existing.description ? { description: existing.description } : {}),
		...(filter ? { filter } : {}),
		display: { ...(existing.display ?? {}), list: listBlock(p) },
	};
}

/** A NEW named view: always titled in the nav, so it is never anonymous. */
export function newViewWrite(route: string, collection: string, nav: { title: string; icon?: string }, p: ListPresentation, filter: Record<string, unknown> | undefined): ViewWrite {
	return {
		route,
		scope: 'collection',
		collection: `collections/${collection}`,
		...(filter ? { filter } : {}),
		display: { nav: { title: nav.title, ...(nav.icon ? { icon: nav.icon } : {}) }, list: listBlock(p) },
	};
}

/** The engine's default list layout — what a collection with no `display.list.layout` draws. */
const DEFAULT_LIST_LAYOUT = 'table';

/** An option value that says nothing — written as the empty value, which removes the key. */
const isUnset = (v: unknown) => v === undefined || v === null || v === '';

/**
 * The collection-display save: the keys `dt set collections/<c>` takes — columns and sort always,
 * the layout and each option only where the screen differs from what the collection already says —
 * and what the screen shows that a collection's display cannot hold (a filter).
 *
 * `own` is the collection row's `list` block, as the engine resolved it: its `layout` is always set,
 * and its `options` are exactly the authored ones (compile supplies none).
 */
export function collectionListWrite(
	own: { layout?: string; options?: Record<string, unknown> } | undefined,
	p: ListPresentation,
	filter: Record<string, unknown> | undefined,
): { changes: Record<string, unknown>; unsaved: string[] } {
	const changes: Record<string, unknown> = { 'display.list.columns': [...p.columns], 'display.list.sort': p.sort };
	if (p.layout !== (own?.layout ?? DEFAULT_LIST_LAYOUT)) changes['display.list.layout'] = p.layout;
	const was = own?.options ?? {};
	for (const [key, value] of Object.entries(p.options)) {
		if (JSON.stringify(value) === JSON.stringify(was[key])) continue;
		changes[`display.list.options.${key}`] = isUnset(value) ? '' : JSON.stringify(value);
	}
	for (const key of Object.keys(was)) if (!(key in p.options)) changes[`display.list.options.${key}`] = '';
	const unsaved = filter && Object.keys(filter).length ? ['filter'] : [];
	return { changes, unsaved };
}
