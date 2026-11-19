/**
 * ROW DENSITY of the table layout — the `row_size` option (`compact` · `cozy` · `comfortable`).
 *
 * Three sources, one precedence, and it is the precedence every other layout option already has, so
 * nothing here invents a second one: the toolbar's pick (written into the browse's in-memory
 * scratch through `setListOptions`, exactly as the Layout options drawer writes) sits over whatever
 * `display.list.options.row_size` the governing ui-view or the collection authored (`lib/list-seed.ts`
 * merges those two), and the default closes the gap. `cozy` IS today's density — a table nobody
 * configured draws byte-identically to the one that existed before the option.
 *
 * ⚠ The value reaches the table as a CSS CLASS and nothing else (`dt-table--<size>`): every number —
 * the row height, the picture box, the title weight — is a stylesheet rule keyed off that class, so a
 * density is one place to read and the render tier can pin the class without a DOM.
 *
 * Pure and its own module, because "which density wins" is a decision, and a decision buried in a
 * component can only be tested by rendering it.
 */

export const ROW_SIZES = ['compact', 'cozy', 'comfortable'] as const;
export type RowSize = (typeof ROW_SIZES)[number];

export const DEFAULT_ROW_SIZE: RowSize = 'cozy';

/** What a density is called in the toolbar and the drawer — one spelling, both surfaces. */
export const ROW_SIZE_LABELS: Readonly<Record<RowSize, string>> = {
	compact: 'Compact',
	cozy: 'Cozy',
	comfortable: 'Comfortable',
};

export function isRowSize(value: unknown): value is RowSize {
	return typeof value === 'string' && (ROW_SIZES as readonly string[]).includes(value);
}

/**
 * The density a table draws at, from the table layout's resolved options — the slice the browse
 * holds under `listOptions.table`, which is already "toolbar over view over collection". An absent
 * key, or a value this build does not know (a typo in a view, a density a later build may add), is
 * the default: a misspelt option must not erase the table, the same posture `group_by` takes.
 */
export function resolveRowSize(options: Record<string, unknown> | undefined | null): RowSize {
	const value = options?.['row_size'];
	return isRowSize(value) ? value : DEFAULT_ROW_SIZE;
}

/** The class `.dt-table` carries for a density — the ONLY way a density reaches the stylesheet. */
export function tableDensityClass(size: RowSize): string {
	return `dt-table--${size}`;
}

/**
 * Is a picture square enough to be drawn as a circle? An avatar is; a wordmark is not, and cropping
 * one into a circle cuts its letters off. The band is deliberately generous (4:5 to 5:4): a portrait
 * crop a few pixels off square still reads as a face, and the alternative — a rounded square for
 * every near-square avatar — is the mobile-list look this exists to avoid.
 */
export function isSquarish(width: number, height: number): boolean {
	if (!(width > 0) || !(height > 0)) return false;
	const ratio = width / height;
	return ratio >= 0.8 && ratio <= 1.25;
}
