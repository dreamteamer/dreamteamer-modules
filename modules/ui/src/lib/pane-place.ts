/**
 * Where the page is, in the four shapes the server stores (cr-modules-017 §5): `{ collection }`, `{ collection, id }`,
 * `{ uiView }` — and `{ other: true }` for everything else (home, a module app, settings), so a page outside the three
 * view shapes still reports that it is somewhere (round-3 finding a-page-outside-the-three-view-shapes…).
 *
 * ⚠ A collection name can carry a slash (`rnd/change-requests`) and so can an id (`2026/11/standup`): the split is
 * the LONGEST registered collection that prefixes the path, never the first slash.
 */
import { ref } from 'vue';
import type { PaneView } from '@dreamteamer/protocol/pane';

export type { PaneView };

/** The browse on screen writes its ticked rows here (BrowseView); the reporter sends them. */
export const pageSelection = ref<{ collection: string; ids: string[] } | null>(null);
/** The chat's push (`dt:select`), held until the list of its collection applies it. */
export const pushedSelection = ref<{ refs: string[]; at: number } | null>(null);

/** `{ collection, id }` of a reference, split at the end of the longest registered collection; null when none. */
export function splitRef(ref: string, collections: string[]): { collection: string; id: string } | null {
	const norm = ref.replace(/^\/+/, '');
	for (const c of [...collections].sort((a, b) => b.length - a.length)) {
		if (norm.startsWith(c + '/') && norm.length > c.length + 1) return { collection: c, id: norm.slice(c.length + 1) };
	}
	return null;
}

export function placeOf(route: { name?: string | symbol | null; params: Record<string, unknown> }, collections: string[]): PaneView {
	const name = typeof route.name === 'string' ? route.name : '';
	if (name.startsWith('ui-view:') && name.length > 'ui-view:'.length) return { uiView: name.slice('ui-view:'.length) };
	if (name !== 'content') return { other: true };
	const raw = route.params['path'];
	const path = (Array.isArray(raw) ? raw.join('/') : typeof raw === 'string' ? raw : '').replace(/^\/+|\/+$/g, '');
	if (!path) return { other: true };
	if (collections.includes(path)) return { collection: path };
	const split = splitRef(path, collections);
	if (!split) return { other: true };
	// a lone trailing `+` is the create page — the collection, client-side only (lib/content-path.ts)
	if (split.id === '+') return { collection: split.collection };
	return split;
}
