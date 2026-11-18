/**
 * ui-view consumption (spec: "the studio reads the compiled view table"). On boot — before the
 * router mounts, so deep links like /admin/inbox work on hard reload — `loadUiViews` fetches the
 * compiled `ui-views` records plus `/api/info`, resolves `@me` filter placeholders to
 * `users/<operator>`, and registers one route per view, by its `scope` (descriptor v2, §3.5):
 *
 *   scope 'collection' → UiViewPage (a thin wrapper over BrowseView) rendering the view's
 *                        `display.list` over the referenced collection, with its `filter` applied.
 *   scope 'record'     → ContentDetail for `view.collection` + an `:id` route param.
 *   scope 'page'       → `display.list.layout: page` or `activity` — the surface's own page layouts
 *                        (pages/UiPageView.vue: a page that NESTS other views as panels, and a
 *                        module's activity feed; `?source=<layer>` scopes either to one layer) —
 *                        else the registered app named by `display.list.layout` (its index route
 *                        component), or a friendly "unregistered page" placeholder — never blank.
 *
 * A view is always a NAMED variant: a collection's default view is its own `display`, which a bare
 * `/content/<collection>` already renders. What a view DRAWS is `compiled.display` — compile's merge
 * of its `display` over its collection's, sub-block by sub-block. Views carrying a `display.nav`
 * surface as NavSidebar entries (`uiViewNav`, sorted by nav.order); one without has no nav entry.
 * Fault-tolerant like modules.ts: a failed fetch logs and the studio boots with no ui-view routes
 * rather than blanking.
 */
import { computed, defineComponent, h, ref, type Component } from 'vue';
import type { Router } from 'vue-router';
import { loadServerInfo } from './api/info';
import { hostRequest } from './api/transport';
import { apps } from './registry/index';

/** A view's `display` — the collection's four sub-blocks, with `nav.title` because a view has no
 *  descriptor title of its own. */
export interface ViewDisplay {
	nav?: { title?: string; icon?: string; order?: number };
	list?: { layout?: string; columns?: string[]; sort?: string; options?: Record<string, unknown> };
	record?: { layout?: string; subtitle?: string; badge?: string; color_by?: string; options?: Record<string, unknown> };
	form?: { sections?: Array<{ title: string; fields: string[] }> };
}

export interface UiViewRecord {
	id: string;
	name?: string;
	title?: string;
	description?: string;
	/** The path the view renders at, starting with /. */
	route: string;
	scope: 'record' | 'collection' | 'page';
	/** Qualified ref `collections/<name>`; a page may omit it. */
	collection?: string;
	filter?: Record<string, unknown>;
	/** What the view changes from its collection's display — what a write sends back. */
	display?: ViewDisplay;
	/** Compile's: the view's display merged over its collection's — what a surface draws. */
	compiled?: { display?: ViewDisplay };
	/** The host's, on every runtime row (`src/api.ts`): the module the view was compiled from, and
	 *  where that module sits — `own` (the workspace's modules/), `layer`, `module` (a package). */
	$module?: string;
	'$source-kind'?: string;
}

/** What a view draws: compile's merge, else what it authored (a view read before a compile). */
export function drawnDisplay(view: UiViewRecord): ViewDisplay {
	return view.compiled?.display ?? view.display ?? {};
}

/** The layout a view renders: its list layout, or its record layout for a record-scope view. */
export function viewLayout(view: UiViewRecord): string | undefined {
	const display = drawnDisplay(view);
	return view.scope === 'record' ? display.record?.layout : display.list?.layout;
}

/** What a view is called wherever it is listed: its nav title, else its own title, else its id. */
export function viewLabel(view: UiViewRecord): string {
	return view.display?.nav?.title ?? view.title ?? view.name ?? view.id;
}

export const uiViews = ref<UiViewRecord[]>([]);

/** The operator id `@me` resolves to (`/api/info`), kept so a LOOKUP can resolve it — see below. */
const operator = ref('');

/**
 * The LIVE record behind a registered route, `@me` already resolved.
 *
 * ⚠ This lookup is the whole point, and it replaced passing the record itself as a static route
 * prop. `router.addRoute` freezes whatever `props` object it is handed, and `loadUiViews` runs ONCE
 * at boot — so a view whose `filter` was authored (or edited, or compiled) after the tab opened kept
 * rendering with the filter it had at boot, i.e. usually none at all: the page showed the whole
 * collection and no amount of navigating back to it helped, because navigation re-used the same
 * frozen prop. Only a window reload fixed it. Reading through the reactive `uiViews` ref instead
 * means a refreshed view table reaches an open page (App.vue re-runs `loadUiViews` on
 * `dt:invalidate`, which the host posts whenever the workspace changes on disk).
 */
export function resolvedUiView(id: string): UiViewRecord | undefined {
	const view = uiViews.value.find((v) => v.id === id);
	if (!view) return undefined;
	return { ...view, filter: resolveAtMe(view.filter, operator.value) as Record<string, unknown> | undefined };
}

/**
 * Everything about a view record that a mounted browse consumed AT SETUP — `useBrowseState` reads
 * its config once, so the only honest way to apply a changed record is to remount. Callers use this
 * as the `:key`, which means an UNCHANGED record re-renders nothing (the string is stable by value).
 */
export function uiViewFingerprint(view: UiViewRecord | undefined): string {
	return view ? JSON.stringify([view.id, drawnDisplay(view), view.filter ?? null]) : 'none';
}

/** Nav entries for NavSidebar — views with a `display.nav`, sorted by its order (unordered last). */
export const uiViewNav = computed(() =>
	uiViews.value
		.filter((v) => v.display?.nav && typeof v.route === 'string')
		.sort((a, b) => (a.display?.nav?.order ?? Number.MAX_SAFE_INTEGER) - (b.display?.nav?.order ?? Number.MAX_SAFE_INTEGER)),
);

/** Strip the qualified `collections/` prefix off a ui-view's collection ref. */
export function collectionOf(view: UiViewRecord): string {
	return (view.collection ?? '').replace(/^collections\//, '');
}

/** Deep-resolve every '@me' string value in a filter tree to `users/<user>` (the operator's id). */
export function resolveAtMe(node: unknown, user: string): unknown {
	if (node === '@me') return `users/${user}`;
	if (Array.isArray(node)) return node.map((v) => resolveAtMe(v, user));
	if (node !== null && typeof node === 'object') {
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(node as Record<string, unknown>)) out[key] = resolveAtMe(value, user);
		return out;
	}
	return node;
}

/** The page layouts this surface draws itself (`pages/UiPageView.vue`, `lib/page-view.ts`) — ahead of
 *  any module app, so a module registering an app of the same id cannot hijack a page that nests views. */
const SURFACE_PAGE_LAYOUTS = new Set(['page', 'activity']);

/** "Unregistered page" placeholder for a `page` view whose app no loaded module registered. */
function placeholderPage(layout: string) {
	return defineComponent({
		name: 'UiViewUnregisteredPage',
		setup: () => () =>
			h('div', { class: 'dt-empty', style: 'padding: 48px' }, [
				h('span', { class: 'codicon codicon-extensions' }),
				h('p', { class: 'dt-empty__line' }, `Page '${layout}' is not registered — is its module installed and loaded?`),
			]),
	});
}

async function fetchUiViews(): Promise<UiViewRecord[]> {
	const json = (await hostRequest('GET', '/collections/ui-views/records?limit=200')) as { records?: UiViewRecord[] };
	return Array.isArray(json?.records) ? json.records : [];
}

/** Signature of the last table applied, so a re-run over unchanged records touches nothing. */
let lastSignature: string | null = null;

/**
 * Fetch ui-views + /api/info and register the routes. Never rejects — same "a broken extension
 * source never blanks the studio" posture as loadModules.
 *
 * Safe to call REPEATEDLY: it is the boot wiring and the refresh (App.vue calls it on every
 * `dt:invalidate`, LayoutOptionsSection after a save/delete). An unchanged table returns before
 * touching `uiViews`, so the common case — an agent writing records while a tab is open — costs one
 * cheap read and re-renders nothing.
 */
export async function loadUiViews(router: Router): Promise<void> {
	let views: UiViewRecord[];
	let user = '';
	try {
		const [info, records] = await Promise.all([loadServerInfo(), fetchUiViews()]);
		user = info.user;
		views = records;
	} catch (err) {
		console.warn('[ui-views] could not load ui-views — continuing without them', err);
		return;
	}

	const signature = JSON.stringify([user, views]);
	if (signature === lastSignature) return;
	lastSignature = signature;

	operator.value = user;
	uiViews.value = views;

	// Lazy import breaks the cycle ui-views → UiViewPage → BrowseView → … → nothing back here,
	// but ContentDetail's import chain reaches pages that import registry defaults; keeping both
	// page imports dynamic keeps this boot module dependency-light either way.
	const [{ default: UiViewPage }, { default: ContentDetail }, { default: UiPageView }] = await Promise.all([
		import('./pages/UiViewPage.vue'),
		import('./pages/ContentDetail.vue'),
		import('./pages/UiPageView.vue'),
	]);

	for (const view of views) {
		if (typeof view.route !== 'string' || !view.route.startsWith('/')) {
			console.warn(`[ui-views] '${view.id}' has no absolute route — skipping`);
			continue;
		}

		if (view.scope === 'collection') {
			// the ID, never the record: UiViewPage looks the live one up (see `resolvedUiView`).
			router.addRoute({ path: view.route, name: `ui-view:${view.id}`, component: UiViewPage, props: { viewId: view.id } });
		} else if (view.scope === 'record') {
			const collection = collectionOf(view);
			router.addRoute({
				path: `${view.route}/:id(.*)`,
				name: `ui-view:${view.id}`,
				component: ContentDetail,
				props: (route) => ({
					collection,
					id: Array.isArray(route.params['id']) ? route.params['id'].join('/') : ((route.params['id'] as string | undefined) ?? ''),
					create: false,
					// the record page draws THIS view's `display.record` rather than the collection's
					viewId: view.id,
				}),
			});
		} else if (view.scope === 'page' && SURFACE_PAGE_LAYOUTS.has(drawnDisplay(view).list?.layout ?? '')) {
			// A page this surface draws itself: one that nests views, or a module's activity. The id, as
			// for a collection view; `?source=` scopes it to one record layer.
			router.addRoute({
				path: view.route,
				name: `ui-view:${view.id}`,
				component: UiPageView,
				props: (route) => ({ viewId: view.id, source: typeof route.query['source'] === 'string' && route.query['source'] ? route.query['source'] : undefined }),
			});
		} else if (view.scope === 'page') {
			// The registered app named by `display.list.layout` supplies the component (its index
			// route); an unregistered name renders the placeholder rather than 404/blank.
			const layout = drawnDisplay(view).list?.layout ?? '';
			const app = apps.get(layout);
			const component = ((app?.routes[0] as { component?: Component } | undefined)?.component) ?? placeholderPage(layout);
			router.addRoute({ path: view.route, name: `ui-view:${view.id}`, component });
		}
	}
}
