/**
 * WHAT A PAGE VIEW DRAWS — a ui-view that nests other ui-views (decision: dashboards are nested
 * ui-views, not a panel vocabulary). Pure, so tier 1 pins it (`test/unit/page-view.test.ts`).
 *
 * The vocabulary is the SURFACE's, and the engine needs no change for it: a view's `display` is a free
 * map compile merges and never validates a layout name against, and `options` is open. So:
 *
 *   scope: page · display.list.layout: page      options.views — the children, each a ui-view
 *                                                reference (`ui-views/<id>`, a bare id, or the view's
 *                                                `/route`); options.grid_columns — 1 or 2;
 *                                                options.module — the module this page is FOR
 *   scope: page · display.list.layout: activity  options.module — that module's feed (ActivityPane)
 *   scope: collection · layout: counts           options.group_by — a field option, so compile CHECKS
 *                                                it; one number per value (lists/ListCounts.vue)
 *
 * A child keeps its own collection, filter and layout: a panel IS the view, so every view feature
 * (Save as, overlay, move, the compile checks on its columns and filter) applies to it unchanged.
 *
 * ⚠ `grid_columns`, not `columns`: compile warns on `display.list.options.columns` ("read by nothing —
 * `columns` is a key of display.list"), and a column COUNT is not a column list anyway.
 *
 * ⚠ EVERYTHING WRONG WITH A CHILD IS REFUSED HERE, AT RENDER, IN ITS OWN PANEL, BY ITS REFERENCE —
 * compile passes the record unchanged, because only this surface knows what the layouts mean. A
 * reference to no view, a cycle (a page naming itself, or `a → b → a`), an entry that is not a string,
 * a `record` view (a page has no record to show it), and a page whose layout is a module's APP (its
 * component owns a whole route; a panel links to it instead). A refusal never takes its siblings down.
 */
import type { InjectionKey, Ref } from 'vue';
import type { UiViewRecord, ViewDisplay } from '../ui-views';
import { SOURCE_FIELD } from './sources';
import { decompileFilter } from './filter-query';

/** What a view draws — `ui-views.ts#drawnDisplay`'s rule (compile's merge, else what it authored),
 *  restated here because importing that module pulls in the host transport, which tier 1 cannot load. */
const drawnDisplay = (view: UiViewRecord): ViewDisplay => view.compiled?.display ?? view.display ?? {};

/** The source (a record layer) a page is scoped to, provided by the page to every panel under it —
 *  what a `counts` link carries so a click lands on the same rows the number counted. */
export const PAGE_SOURCE: InjectionKey<Readonly<Ref<string | undefined>>> = Symbol('dt-page-source');

export const PAGE_LAYOUT = 'page';
export const ACTIVITY_LAYOUT = 'activity';
export const COUNTS_LAYOUT = 'counts';

/** One child of a page, as it will draw. */
export type PanelPlan =
	/** a collection view — drawn by the embedded browse in its own layout (table, kanban, cards, counts…) */
	| { kind: 'view'; ref: string; view: UiViewRecord }
	/** a page nested in a page — drawn as a grid of its own panels, without a frame of its own */
	| { kind: 'page'; ref: string; view: UiViewRecord }
	/** a module's activity feed */
	| { kind: 'activity'; ref: string; view: UiViewRecord; module?: string }
	/** what the page cannot draw, and why — shown in the panel, naming the reference */
	| { kind: 'refused'; ref: string; reason: string };

/** A view's list layout, as compile merged it. */
export function listLayout(view: UiViewRecord): string | undefined {
	const layout = drawnDisplay(view).list?.layout;
	return typeof layout === 'string' && layout ? layout : undefined;
}

/** A view's list options, as compile merged them. */
export function listOptionsOf(view: UiViewRecord): Record<string, unknown> {
	const options = drawnDisplay(view).list?.options;
	return options && typeof options === 'object' && !Array.isArray(options) ? options : {};
}

/** A page view that nests views — `scope: page` with the `page` layout. */
export function isPageView(view: UiViewRecord): boolean {
	return view.scope === 'page' && listLayout(view) === PAGE_LAYOUT;
}

/** The view a reference names: `ui-views/<id>`, a bare `<id>`, or the view's `/route`. */
export function findView(ref: string, views: readonly UiViewRecord[]): UiViewRecord | undefined {
	if (ref.startsWith('/')) return views.find((v) => v.route === ref);
	const id = ref.replace(/^ui-views\//, '');
	return views.find((v) => v.id === id);
}

/** What a reference is called in a refusal: its id, without the collection prefix. */
const named = (ref: string) => ref.replace(/^ui-views\//, '');

/**
 * The panels a page draws, one per entry of `options.views`, in order. `ancestry` is the ids of the
 * pages ABOVE this one — the page being drawn inside another names that one — which is what makes a
 * cycle visible at the panel that closes it rather than as an infinite render.
 */
export function pagePanels(page: UiViewRecord, views: readonly UiViewRecord[], ancestry: readonly string[] = []): PanelPlan[] {
	const raw = listOptionsOf(page)['views'];
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) {
		return [{ kind: 'refused', ref: page.id, reason: `options.views is a list of ui-view references — '${page.id}' has a ${typeof raw}` }];
	}
	const chain = [...ancestry, page.id];
	return raw.map((entry, i): PanelPlan => {
		if (typeof entry !== 'string' || !entry.trim()) {
			return { kind: 'refused', ref: String(entry), reason: `entry ${i + 1} is not a ui-view reference (ui-views/<id>, an id, or a /route)` };
		}
		const ref = entry.trim();
		const view = findView(ref, views);
		if (!view) return { kind: 'refused', ref, reason: `ui-view '${named(ref)}' does not exist` };
		if (chain.includes(view.id)) {
			return { kind: 'refused', ref, reason: `'${view.id}' nests itself: ${[...chain.slice(chain.indexOf(view.id)), view.id].join(' → ')}` };
		}
		if (view.scope === 'record') {
			return { kind: 'refused', ref, reason: `'${view.id}' is a record view — it draws one record, and a page has none to give it` };
		}
		if (view.scope === 'collection') return { kind: 'view', ref, view };
		const layout = listLayout(view);
		if (layout === PAGE_LAYOUT) return { kind: 'page', ref, view };
		if (layout === ACTIVITY_LAYOUT) {
			const module = listOptionsOf(view)['module'];
			return { kind: 'activity', ref, view, ...(typeof module === 'string' && module ? { module } : {}) };
		}
		return { kind: 'refused', ref, reason: `'${view.id}' is a page of layout '${layout ?? '(none)'}', which draws a whole route and cannot be drawn in a panel — open it` };
	});
}

/** One or two columns: `options.grid_columns` 2 (a number, or the string a CLI write leaves) is two; anything else is one. */
export function gridColumns(page: UiViewRecord): 1 | 2 {
	return Number(listOptionsOf(page)['grid_columns']) === 2 ? 2 : 1;
}

/** Where a compiled view came from, as the host stamps every runtime row (`src/sources.ts`
 *  moduleSource): `own` — a module under the workspace's `modules/`, the workspace module included;
 *  `layer`; `module` — a package (`node_modules`) or a git module. Nearer wins. */
const SOURCE_RANK: Record<string, number> = { own: 0, layer: 1, module: 2 };
const rankOf = (v: UiViewRecord) => SOURCE_RANK[String(v['$source-kind'] ?? '')] ?? 3;

/**
 * The page view that is a module's page: the PAGE view whose `options.module` names it. When several
 * do, the one NEAREST the workspace wins — the workspace's own modules, then a layer, then a package —
 * and only then the lowest id: a workspace that authors a page for an installed package (rnd ships
 * `modules-rnd`) gets ITS page, whatever its id (review 2026-10-31: the lowest id alone let the shipped
 * page win, silently). The page says which view it drew (`pageOrigin`).
 */
export function modulePageView(views: readonly UiViewRecord[], module: string): UiViewRecord | undefined {
	return views
		.filter((v) => isPageView(v) && listOptionsOf(v)['module'] === module)
		.sort((a, b) => rankOf(a) - rankOf(b) || a.id.localeCompare(b.id))[0];
}

/** "ui-view <id> · from <module>" — what a drawn page says about itself, so an author can tell whose page won. */
export function pageOrigin(view: UiViewRecord): string {
	const module = view.$module;
	return `ui-view ${view.id}${typeof module === 'string' && module ? ` · from ${module}` : ''}`;
}

/** A child's own filter, narrowed to one source (a record layer) — the source picker's `$source is <name>`. */
export function scopedFilter(filter: Record<string, unknown> | undefined, source: string | undefined): Record<string, unknown> | undefined {
	if (!source) return filter;
	const clause = { [SOURCE_FIELD]: { _eq: source } };
	return filter && Object.keys(filter).length ? { _and: [filter, clause] } : clause;
}

/** The builder's `?filter=` for a list route — `{logic, rules}`, the shape the browse parses (`parseFilterGroup`). */
function withRules(route: string, rules: Array<{ field: string; operator: string; value: unknown }>): string {
	return rules.length ? `${route}?filter=${encodeURIComponent(JSON.stringify({ logic: '_and', rules }))}` : route;
}
const sourceRule = (source: string | undefined) => (source ? [{ field: SOURCE_FIELD, operator: '_eq', value: source }] : []);

/** Where a panel's title links: the child's full view, still scoped — a list by a removable `$source` rule, a page by `?source=`. */
export function panelLink(view: UiViewRecord, source: string | undefined): string {
	if (view.scope === 'page') return source ? `${view.route}?source=${encodeURIComponent(source)}` : view.route;
	return withRules(view.route, sourceRule(source));
}

/**
 * Where a number of a `counts` view links: the RECORDS behind it — the collection's own list
 * (`/content/<collection>`), filtered by the view's own filter, then `<field> is <value>` (`null`, the
 * ungrouped band, is "is empty"; no field is the total), then the scope — every one an ordinary
 * removable rule. Not the view's own route: that draws the counts again (seen in the dev host, where a
 * click on "14 open" opened a page reading "14 total · 14 open").
 *
 * A view filter the flat builder cannot carry as `_and` rules (nested groups, `_or`) cannot be joined
 * to the value rule without changing what it means, and the list's `?filter=` carries only flat rules —
 * so the count is UNLINKED (`null`) and says why (`UNLINKED_COUNT`). Never the counts view's own route:
 * that draws the counts again (review 2026-10-31).
 */
export const UNLINKED_COUNT = 'this view’s filter (an any-of or nested group) cannot be carried to the list — open the view to see its records';
export function countLink(view: UiViewRecord, field: string | undefined, value: string | null, source: string | undefined): string | null {
	const valueRule = field === undefined ? [] : [value === null ? { field, operator: '_null', value: '' } : { field, operator: '_eq', value }];
	const own = view.filter && Object.keys(view.filter).length ? decompileFilter(view.filter) : { logic: '_and' as const, rules: [] };
	if (!own || (own.logic !== '_and' && own.rules.length > 1)) return null;
	const carried = own.rules.map(({ field: f, operator, value: v }) => ({ field: f, operator, value: v }));
	const collection = (view.collection ?? '').replace(/^collections\//, '');
	return withRules(`/content/${collection}`, [...carried, ...valueRule, ...sourceRule(source)]);
}
