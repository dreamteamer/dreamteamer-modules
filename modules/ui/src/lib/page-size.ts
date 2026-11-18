/**
 * How many rows a browse asks for, and what "All" means on the wire.
 *
 * Paging is SERVER-side here: `useItems` sends `limit` and `page`, and both servers that answer it
 * — the engine's `server.js` and this extension's in-process `api.ts` — do the same thing with it,
 * `rows.slice(offset, offset + limit)`.
 *
 * ⚠ WHICH IS WHY `ALL` IS NOT -1. Directus spells unlimited as `limit: -1` and that convention is
 * in a lot of muscle memory, but `[1,2,3].slice(0, -1)` is `[1,2]`: a -1 here means "all but the
 * last row". `meta.filter_count` would still report the true total, so the page would show one row
 * fewer than it claimed and never say which one went missing. A large sentinel has no such edge.
 */

/** "All", as a number both servers can slice with. Large enough to clear any collection a workspace
 *  realistically holds, and positive — which is the whole point. */
export const ALL = 100000;

/** What every browse has always requested when nothing said otherwise. */
export const DEFAULT_PAGE_SIZE = 25;

/** Offered in the layout options, in this order; `ALL` renders as "All". */
export const PAGE_SIZE_CHOICES = [25, 50, 100, 200, ALL];

export const isAll = (n: unknown): boolean => n === ALL;

/**
 * The limit to request, given the view's declared `page_size` and whether its rows are grouped.
 *
 * A grouped view DEFAULTS to All — a band reading "12 of 40" is never a picture anyone wants — but
 * it is a default and not a prohibition (design 2026-09-07): an explicit `page_size` still wins, on
 * either kind of view. A value that is not a positive integer is not a request, so it falls back to
 * whatever this view would have asked for having said nothing at all.
 */
export function effectiveLimit(raw: unknown, hasRowGroup: boolean): number {
	const fallback = hasRowGroup ? ALL : DEFAULT_PAGE_SIZE;
	const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
	return Number.isInteger(n) && n > 0 ? n : fallback;
}
