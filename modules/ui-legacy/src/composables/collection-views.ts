/**
 * A collection's VIEWS — the default, and the named variants (descriptor v2, §3.5).
 *
 * Directus-parity (operator 2026-07-27: "they have a default view for every collection, and user
 * can define as many view as they want — same data structure"). The data structure is the
 * `display` block: a collection's own `display.list` IS its default view — what a bare
 * `/content/<collection>` renders, in git, in the descriptor an agent already reads — and a
 * `ui-view` record is a NAMED variant carrying the same block, which compile merges over the
 * collection's (`compiled.display`). There is no `default: true` view any more.
 *
 * Columns, their ORDER, sort, layout and layout options all live in `display.list`, so they land in
 * a diff and an agent can rewrite them. `lib/list-seed.ts` merges a governing view over the
 * collection's list key by key.
 */
import { computed } from 'vue';
import { uiViews, collectionOf, drawnDisplay, type UiViewRecord } from '../ui-views';

/** Everything a browse page needs in order to render a view. */
export interface ViewConfig {
	/** the record this came from, if any — what "Save" writes back to */
	viewId?: string;
	layout?: string;
	columns?: string[];
	sort?: string;
	filter?: Record<string, unknown>;
	/** per-layout declared options, keyed by list id */
	listOptions?: Record<string, Record<string, unknown>>;
}

/**
 * A view key that must be a LIST OF STRINGS — `display.list.columns` today, and whatever joins it.
 *
 * ⚠ TOLERATE AND COMPLAIN. Answering `undefined` for every shape that is not an array is
 * byte-identical to "this view configures no columns": the page silently falls back to the
 * collection's columns, with nothing on screen or in the console saying the record had asked for
 * something else. A comma STRING is split and honoured; every unusable shape warns, naming the VIEW
 * and the KEY, because the record is still what wants fixing. Only a genuinely absent value
 * (`undefined`/`null`) is silent — that one really does mean "unset".
 */
function stringArray(raw: unknown, viewId: string, key: string): string[] | undefined {
	const where = `[collection-views] view '${viewId}': display.list.${key}`;
	if (Array.isArray(raw)) {
		const strings = raw.filter((c): c is string => typeof c === 'string');
		if (strings.length !== raw.length) {
			console.warn(`${where} has ${raw.length - strings.length} entr${raw.length - strings.length === 1 ? 'y' : 'ies'} that are not strings — ignoring them. Fix the record.`);
		}
		return strings;
	}
	if (typeof raw === 'string') {
		const split = raw.split(',').map((c) => c.trim()).filter(Boolean);
		console.warn(`${where} is a comma string, not a list — reading it as ${JSON.stringify(split)}. Fix the record: it should be a YAML list.`);
		return split.length ? split : undefined;
	}
	if (raw !== undefined && raw !== null) {
		console.warn(`${where} is a ${typeof raw}, not a list of strings — ignoring it. Fix the record.`);
	}
	return undefined;
}

/**
 * A view's `display.list` — as compile merged it over its collection's — split into the pieces the
 * browse state consumes. `layout`, `columns` and `sort` are keys of the block; its `options` belong
 * to the layout it pins and ride through untouched under that layout's id.
 */
export function viewToConfig(view: UiViewRecord): ViewConfig {
	const list = drawnDisplay(view).list ?? {};
	const { layout, columns, sort, options } = list as Record<string, unknown>;
	// `sort` is the same silent case one type over: a present-but-unusable value reads exactly like
	// an absent one, so it says so rather than vanishing. `''` IS usable — explicitly unsorted.
	if (typeof sort !== 'string' && sort !== undefined && sort !== null) {
		console.warn(`[collection-views] view '${view.id}': display.list.sort is a ${typeof sort}, not a string — ignoring it. Fix the record.`);
	}
	const pinned = typeof layout === 'string' && layout ? layout : undefined;
	const opts = options && typeof options === 'object' && !Array.isArray(options) ? (options as Record<string, unknown>) : {};
	return {
		viewId: view.id,
		layout: pinned,
		columns: stringArray(columns, view.id, 'columns'),
		sort: typeof sort === 'string' ? sort : undefined,
		filter: view.filter,
		// a view pins ONE layout, so its options are that layout's
		listOptions: pinned && Object.keys(opts).length ? { [pinned]: { ...opts } } : {},
	};
}

/** Every collection-scope view of a collection — its NAMED variants, nav order first. */
export function viewsFor(collection: string): UiViewRecord[] {
	return uiViews.value.filter((v) => v.scope === 'collection' && collectionOf(v) === collection);
}

export function useCollectionViews(collection: string) {
	return { views: computed(() => viewsFor(collection)) };
}
