// Which of a collection's fields a RECORD PAGE draws — the form and the properties layout alike, since
// ContentDetail hands both the same list.
//
// One exclusion here — which SURFACE (form or record) a field is hidden from is the layouts' call,
// since only they know the mode:
//  - the block COMPILE writes onto a v2 collection descriptor (engine 0.33.0). A `collections/<name>`
//    record page drew `compiled` — the defaults compile supplied, the resolved fields and the whole
//    json_schema — as one JSON row larger than everything the operator authored above it. It is build
//    output, never authored, and the engine's own description of it says so. `display` is authored and
//    stays.
import type { FieldRow } from '../api/types';

/** collection → the fields of it that compile writes and nobody authors */
const COMPILE_WRITTEN: Record<string, ReadonlySet<string>> = {
	collections: new Set(['compiled']),
};

export function recordPageFields(collection: string, fields: FieldRow[]): FieldRow[] {
	const written = COMPILE_WRITTEN[collection];
	return fields.filter((f) => !written?.has(f.field)).map(stubOnForm);
}

/**
 * THE ENGINE'S `stub` STAYS AN ORDINARY CHECKBOX ON THE RECORD FORM (cr-vscode-004 line 9, operator
 * decision 6a, 2026-10-31). Engine 0.41.0 injects `stub` — a boolean that makes a record yield to any
 * non-stub of its id in another root — into every layerable collection, projected hidden from the list
 * AND the form, so the record page drew it read-only and the edit form had no control for it. Until a
 * later change puts it behind an action, the form draws it as the boolean it is: `form` comes off its
 * `hidden`, and nothing else moves (the list still leaves it out; the row says it in words instead).
 * Only the engine's own field is touched — a boolean named `stub` with no `kind`, which since 0.41.0 no
 * module may declare.
 */
export function stubOnForm(f: FieldRow): FieldRow {
	if (f.field !== 'stub' || f.type !== 'boolean' || f.kind || !f.hidden?.includes('form')) return f;
	return { ...f, hidden: f.hidden.filter((s) => s !== 'form') };
}
