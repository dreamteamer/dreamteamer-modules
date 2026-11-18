/**
 * Template-prefill pure logic (C2 spec item 4).
 *
 * Contract gap (see the plan's own escape hatch, exercised before writing this): the server has
 * no dedicated template-file mechanism. `_templates/*` paths are invisible to the items engine
 * end-to-end — verified with `curl` against the demo workspace: descriptors.ts excludes any
 * `_`-prefixed file/folder from both the record scan AND collection-path registration, so
 * `GET /items/<collection>/_templates` never resolves to a listable sub-collection (it 404s/403s
 * as an ordinary, nonexistent pk on the PARENT collection instead). Per the plan's documented
 * fallback, "templates" are implemented client-side as "duplicate an existing record" — the
 * create flow lets an operator pick any existing record of the collection as a starting point.
 *
 * `prefillFromRecord` is the mapping at the center of that flow: given a source record and the
 * collection's field descriptors, produce the subset of field values worth copying into a new
 * (unsaved) record.
 */
import type { FieldRow, ItemRecord } from '../api/types';
import { hasControl } from './field-row';

/**
 * Copy exactly what the CREATE form offers a control for — a duplicate is the create form, prefilled.
 * So never: the record's address (`id`, injected and virtual), anything the engine owns (`kind`:
 * a `created` stamp, a computed value, a generated mirror — every writer is refused, so copying one
 * turns Duplicate into a refused save), a field the UI locks (`editable: false`), and `$`-prefixed
 * synthetic fields (`$path`, `$size` — filesystem metadata, not data). Everything else copies
 * through verbatim, the body included.
 */
export function prefillFromRecord(record: ItemRecord, fields: FieldRow[]): ItemRecord {
	const prefill: ItemRecord = {};

	for (const field of fields) {
		if (field.field === 'id') continue;
		if (!hasControl(field, { create: true })) continue;
		if (field.field.startsWith('$')) continue;
		if (!(field.field in record)) continue;
		prefill[field.field] = record[field.field];
	}

	return prefill;
}
