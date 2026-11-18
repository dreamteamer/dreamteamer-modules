import type { CollectionRow } from '../api/types';

/**
 * OKF-registered rows carry a `provenance` key ('disk' | 'built-in' — every registered row does
 * under the bundle-layered core); any legacy/system row that isn't a real registered collection
 * never does — the key is omitted entirely, not set to null. This is the one and only filter for
 * "is this a collection the studio's nav should show": `GET /collections` returns one flat array,
 * and the nav must never show unregistered plumbing.
 */
export function isOkfRow(row: CollectionRow): boolean {
	return row.provenance !== undefined;
}

/**
 * An OKF row that isn't part of the `.schema/*` system namespace (views, users, settings — the
 * studio's own plumbing, still real OKF rows with `provenance`, just not project content).
 * NavSidebar renders the system rows in a group collapsed by default; the router's `/` →
 * first-collection redirect must skip them too, or a fresh workspace lands on a system collection
 * instead of the user's actual data the moment it happens to sort first (C1 E2E gate finding).
 */
export function isUserCollection(row: CollectionRow): boolean {
	return isOkfRow(row) && !row.collection.startsWith('.schema/');
}

/** True when the row is a `.schema/*` system collection (views/users/settings plumbing). */
export function isSystemCollection(row: CollectionRow): boolean {
	return row.collection.startsWith('.schema/');
}
