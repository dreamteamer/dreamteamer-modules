/**
 * THE SCHEMA TAB, NARROWED TO ONE MODULE (operator 2026-10-29: a project opened from the nav listed
 * EVERY module, where only that project's were expected — as its data is). A module clicked in the nav opens the
 * tab with `?module=<id>`; every kind in the rail is then counted and listed through ONE filter —
 * `$module is <id>`, which the host stamps on every row (`src/api.ts`, `src/module-of.ts`): the module
 * a compiled entity was built from, or the module a data record's root belongs to.
 *
 * The scope is STICKY inside the tab: a row opened from a narrowed list keeps it, so the way back is
 * still narrowed. It ends when a navigation lands on a kind's list (or the tab's root) without it —
 * the banner's ✕, or the gear opening the whole schema.
 */
export const MODULE_FIELD = '$module';

export function moduleScopeFilter(id: string): Record<string, unknown> {
	return { [MODULE_FIELD]: { _eq: id } };
}

/** A Schema-tab path carrying the scope, when there is one. */
export function withModuleScope(path: string, id: string | undefined): string {
	return id ? `${path}?module=${encodeURIComponent(id)}` : path;
}

/** The scope after a navigation: the route's `?module=` when it names one; kept on a record page; ended on a list or the root. */
export function nextModuleScope(current: string | undefined, query: unknown, onRecord: boolean): string | undefined {
	const named = Array.isArray(query) ? query[0] : query;
	if (typeof named === 'string' && named) return named;
	return onRecord ? current : undefined;
}
