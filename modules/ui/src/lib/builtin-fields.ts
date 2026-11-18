/**
 * THE ENGINE'S BUILT-IN FIELDS, UNDER THE ENGINE'S OWN NAMES (cr-vscode-011).
 *
 * Every collection has `id`, `created` and `last_modified` (engine `INJECTED_FIELDS`), and those are
 * the names a view's `display.list.columns` and `sort` may say — compile refuses anything else. The
 * host also stamps every row with the commit date under the v1 key `last-modified` (src/api.ts
 * `lastModifiedKeys`), which the page header's commit line reads; that is a WIRE key, never a field.
 * Until 0.24.27 the browse sorted by it by default and Save wrote it into the view, which compile
 * refused ("… has no field last-modified").
 *
 * So the webview holds `last_modified` from the start, and every write and every seed passes its
 * columns and sort through `engineFieldName` / `engineSort`: the one legacy key becomes the field, and
 * every other name — `created`, `id`, the computed `$last-modified-by` — is left exactly as it came.
 */

const LEGACY: Record<string, string> = { 'last-modified': 'last_modified' };

/** A column or sort field under the engine's name: the legacy `last-modified` → `last_modified`. */
export function engineFieldName(field: string): string {
	return LEGACY[field] ?? field;
}

/** A sort (`field`, `-field` or `''`) with its field under the engine's name; the direction kept. */
export function engineSort(sort: string): string {
	const desc = sort.startsWith('-');
	const field = engineFieldName(desc ? sort.slice(1) : sort);
	return desc ? `-${field}` : field;
}

/** The browse's built-in order — newest change first — until a view, a column click or the Sort
 *  control says otherwise. The engine's field name, so the Sort control, the column header and a
 *  Save all name the same thing (the host sorts a row by either key; both carry the same date). */
export const DEFAULT_SORT = '-last_modified';
