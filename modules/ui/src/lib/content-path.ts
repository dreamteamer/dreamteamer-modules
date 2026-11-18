import type { RouteLocationNormalizedLoaded } from 'vue-router';
import type { CollectionRow } from '../api/types';

/** The route patterns that BROWSE a collection, and therefore the only prefixes a record link may
 *  inherit from the current route.
 *
 *  ⚠ `/settings/schema/` joined them when the Schema tab landed: its right pane mounts
 *  `ContentBrowse` for every kind that has no bespoke surface (skills, agents, commands,
 *  command-bindings, ui-views, mixins), and without this a row click inside the tab
 *  would push `/content/skills/<id>` — leaving the tab the operator was working in. */
const CONTENT_BASES = ['/content/', '/settings/system/', '/settings/schema/'];

/**
 * Recovers the static prefix ('/content/' or '/settings/system/') of whichever greedy
 * `:path(.*)` route is currently mounted, so browse/detail navigation (row click, create,
 * save-redirect, cancel, delete, breadcrumb) stays under that same prefix instead of hardcoding
 * '/content/' — a system collection browsed under /settings/system/* must keep pushing
 * /settings/system/* links, or the sidebar's settings/content mode flips back to Content on every
 * row click (operator ask 2026-07-26, item 3: "clicking on any nav item in settings changes the
 * nav back to the content").
 *
 * ⚠ A collection is ALSO browsed from routes that are not those two: every `target: list`
 * ui-view mounts at its own path (`/inbox`, `/tasks/board`), and the data-model designer sits at
 * `/settings/data-model/*`. Stripping the (absent) `:path(.*)` off those left the view's whole
 * path as the "base", and the caller concatenates without a separator — so a row click in the
 * inbox pushed `/inboxtasks/<id>`: no route matches it, the page renders blank, and titles.ts
 * falls all the way through to the literal "dreamteamer" (measured 2026-08-03). Records don't
 * live inside a view, so anything that isn't one of the two browse prefixes falls back to
 * `/content/`, which is where the record actually is.
 */
export function currentContentBasePath(route: RouteLocationNormalizedLoaded): string {
	const pattern = route.matched[route.matched.length - 1]?.path ?? '';
	const base = pattern.replace(/:path\(.*\)$/, '');
	return CONTENT_BASES.includes(base) ? base : '/content/';
}

export interface ResolvedContentPath {
	/** null when no registered collection prefixes the path — never guess. */
	collection: string | null;
	id: string | null;
	create: boolean;
}

/**
 * Splits the studio's greedy `/content/:path(.*)` remainder into `{ collection, id, create }`.
 *
 * Mirrors `resolveCollectionPath` in `server/src/rest/list.ts`: walk the path segments from
 * longest to shortest, and the first prefix that matches a REGISTERED collection id wins —
 * collection ids may themselves contain '/' (nested namespace folders, e.g. `crm/contacts`), so
 * this can't be a simple first-segment split. Whatever segments remain after the matched prefix
 * are the record id, with one client-only exception: a lone trailing `+` segment means create
 * mode. That `+` convention has no server-side meaning at all (verified: nothing in `server/src`
 * special-cases it) — it exists purely so the studio's own router can express "new record" as a
 * path.
 *
 * Deliberately DOES NOT mirror the server's final fallback: when the server finds no registered
 * prefix, it falls back to treating the first segment as a v0 "meta-backed" collection id. The
 * studio never does that — an unmatched path resolves to `collection: null` and
 * the caller renders an explicit "unknown collection" state instead of guessing.
 */
export function resolveContentPath(rawPath: string, collections: CollectionRow[]): ResolvedContentPath {
	const registered = new Set(collections.map((row) => row.collection));
	const segments = rawPath
		.replace(/^\/+|\/+$/g, '')
		.split('/')
		.filter(Boolean);

	for (let take = segments.length; take >= 1; take--) {
		const candidate = segments.slice(0, take).join('/');
		if (!registered.has(candidate)) continue;

		const remainder = segments.slice(take);
		if (remainder.length === 0) return { collection: candidate, id: null, create: false };
		if (remainder.length === 1 && remainder[0] === '+') return { collection: candidate, id: null, create: true };
		return { collection: candidate, id: remainder.join('/'), create: false };
	}

	return { collection: null, id: null, create: false };
}
