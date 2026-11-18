/**
 * COMPUTED FIELDS — what every record has without anyone authoring it: the module it belongs to, who
 * last changed it, who added it (operator 2026-10-29: "should be able to add custom fields like
 * source, author etc to list views and all relevant places"). The host stamps them on every list row
 * (`$module` — src/module-of.ts; `$last-modified-by` / `$created-by` — src/api.ts parseGitHistory),
 * and these rows make them FIELDS: offered in the column picker, the filter builder (with their values
 * from `/values/<field>`), sort, group-by and the card/kanban field pickers, like any field.
 *
 * Never authored and never written: `kind: 'virtual'`, not editable, hidden from the form and the
 * record page (whose header and Info section already say who changed it). Not a default column
 * either — they are there to be added (`browse-state.ts` isExcludedFromDefault). `$source` keeps its
 * own row and its own condition (`lib/sources.ts` sourceFieldRow): it is a column only where a record
 * CAN come from somewhere else.
 */
import type { FieldRow, SourceEntry } from '../api/types';
import { hasForeignSource, sourceFieldRow } from './sources';
import { MODULE_FIELD } from './module-scope';

export const MODIFIED_BY_FIELD = '$last-modified-by';
export const CREATED_BY_FIELD = '$created-by';

const COMPUTED: Array<{ field: string; title: string; description: string }> = [
	{ field: MODULE_FIELD, title: 'Module', description: 'The module the record belongs to — the one that built it, or the one its source belongs to. Computed; never stored.' },
	{ field: MODIFIED_BY_FIELD, title: 'Modified by', description: 'Who made the last commit to the record. Read from git; never stored.' },
	{ field: CREATED_BY_FIELD, title: 'Created by', description: 'Who made the commit that added the record. Read from git; never stored.' },
];

/** Is this one of the computed fields (or `$source`) — a `$` field a surface may draw? */
export function isComputedField(field: string): boolean {
	return COMPUTED.some((c) => c.field === field);
}

/** The computed fields as field rows of `collection`, appended to its visible fields. */
export function computedFieldRows(collection: string): FieldRow[] {
	return COMPUTED.map((c) => ({
		collection,
		field: c.field,
		type: 'string',
		title: c.title,
		description: c.description,
		required: false,
		kind: 'virtual',
		editable: false,
		nullable: true,
		hidden: ['form', 'record'],
	}) as FieldRow);
}

/**
 * A collection's visible field rows plus the computed ones — `$source` (where a record CAN come from
 * elsewhere) and the three above — or NOTHING while the field rows have not loaded. ⚠ `$source` waits
 * too: the overview carrying the sources can land FIRST, and a list whose column selection initialised
 * on `[$source]` alone drew ONE column, Source, for the whole visit (measured in a dev host, 2026-10-30,
 * on a layered collection with no authored columns).
 */
export function withComputedRows(rows: FieldRow[], collection: string, sources: readonly SourceEntry[] | undefined): FieldRow[] {
	if (!rows.length) return [];
	return [...rows, ...(hasForeignSource(sources) ? [sourceFieldRow(collection, sources!)] : []), ...computedFieldRows(collection)];
}
