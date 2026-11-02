/**
 * Which keys in a view's layout options does the active List NOT declare — and, for each one this
 * extension once knew under another name, what it is called now?
 *
 * The engine forwards layout options opaque (decision 195 — it validates only what it interprets),
 * and a List reads only the keys it knows, so a key this build does not declare is silently ignored.
 * `lane_by` on 0.11.2 was exactly that. The registry already declares every option per layout
 * (`ListDefinition.options`); this is the difference, in the view's own order, for BrowseView to SAY
 * rather than swallow.
 *
 * ⚠ DESCRIPTOR V2 RENAMED THE LAYOUT OPTION KEYS (§3.5.1): an option that takes a field is named for
 * the ROLE the field plays, with no `_field` suffix, and one that takes a template for what it
 * labels. There is no fallback that keeps reading an old name — a view carrying one is NAMED here,
 * with its new spelling, which is the migration path. The rename is offered only where this layout
 * declares the new name: `template` is still the gantt's bar label, so it is not unknown there.
 */

/**
 * The renamed layout option keys, old → v2 (§3.5.1). `date_field` was the calendar's `start`.
 *
 * The last five finished the rename on 0.24.18: the carousel's `folder` / `text`, the cards' `image`,
 * the gantt's `bar_label` / `group_icon`. They had kept their `_field` names while a module's own
 * descriptor already wrote the v2 spelling, so a correct view was reported as unknown — the one
 * message that tells an author to check the spelling of a key they spelled right. A registered
 * option may not end in `_field` any more (`test/unit/option-names.test.ts`).
 */
export const RENAMED_OPTIONS: Readonly<Record<string, string>> = {
	color_by_field: 'color_by',
	group_rows_by_field: 'group_by',
	group_columns_by_field: 'lanes_by',
	start_field: 'start',
	end_field: 'end',
	date_field: 'start',
	lat_field: 'lat',
	lng_field: 'lng',
	template: 'card_title',
	group_template: 'group_title',
	group_summary_template: 'group_summary',
	folder_field: 'folder',
	text_field: 'text',
	image_field: 'image',
	bar_label_field: 'bar_label',
	group_icon_field: 'group_icon',
};

export interface UnknownOption {
	key: string;
	/** The v2 name this layout declares for the same option, when the key is an old spelling. */
	renamedTo?: string;
}

export function unknownOptions(
	viewOptions: Record<string, unknown> | undefined,
	declared: ReadonlyArray<{ field: string }> | undefined,
): UnknownOption[] {
	if (!viewOptions) return [];
	const known = new Set((declared ?? []).map((d) => d.field));
	return Object.keys(viewOptions)
		.filter((k) => !known.has(k))
		.map((key) => {
			const renamed = RENAMED_OPTIONS[key];
			return renamed && known.has(renamed) ? { key, renamedTo: renamed } : { key };
		});
}
