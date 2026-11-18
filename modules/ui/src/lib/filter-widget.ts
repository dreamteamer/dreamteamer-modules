/**
 * Filter value widgets, resolved through the ordinary Edit registry.
 *
 * The filter builder used to hand-roll its own five-way `switch` on `kindOfField` — a `<select>`
 * for enums, a checkbox for booleans, `<input type=number|date|text>` for everything else — which
 * meant a relation field (the most common thing anyone filters a dt collection by) got a raw text
 * box you had to type `contacts/ada.contact.md` into by hand, and every richer Edit the registry
 * gained (tags, select, relation picker) was invisible to filtering.
 *
 * Instead of duplicating that resolution, this maps `(field, operator)` onto a SYNTHETIC `FieldRow`
 * whose `editor` pins the filter-appropriate Edit id, and lets `RenderEdit`/`resolveEdit` do the
 * rest. So the filter value control IS the item-edit control — same component, same choices, same
 * relation search — for every kind the registry knows about, present and future.
 *
 * Why synthesize a row instead of passing the field through untouched (which is what "just reuse
 * the item form's field" would mean):
 *   - The full-size body/code/JSON editors are wrong inside a one-line filter row. A field whose
 *     real Edit is `markdown-body` filters as plain text. Directus makes the same call — its
 *     `input-group.vue` derives the filter interface from the field's TYPE, not from
 *     `meta.interface`, precisely so a WYSIWYG never lands in a filter.
 *   - Text operators (`contains`, `starts with`) are substring matches against the stored string,
 *     so they take free text even on an enum or a relation — again matching Directus, which forces
 *     `interface-input` for that whole operator family.
 *   - `required`, `kind` and `editable` are properties of the record, not of a query about it.
 */
import type { FieldRow } from '../api/types';
import { kindOfField } from './filter-query';

/** `{text, value}` pairs, as `GET …/values/:field` arrives (composables/field-values.ts). */
interface Choice { text: string; value: unknown }

/** Operators that match against the raw stored string, whatever the field's kind. */
const TEXT_OPERATORS = new Set(['_contains', '_icontains', '_starts_with', '_ends_with']);

/** Edit id per field kind, for the operators that compare a real typed value. */
const EDIT_BY_KIND: Record<string, string> = {
	relation: 'relation-picker',
	enum: 'select-dropdown',
	boolean: 'boolean',
	datetime: 'datetime',
	number: 'input-number',
	string: 'input',
};

// One synthetic row per (source row, operator) — RenderEdit resolves off prop identity, and
// rebuilding the object on every keystroke would churn that resolution for no reason. Keyed on the
// source `FieldRow` OBJECT rather than its name: a schema edit refetches `/fields` and produces
// fresh row identities, so an edited field's choices can never be served stale from here.
// The cache key carries whether DERIVED choices were supplied, so the row flips from input to
// select the moment `GET …/values/:field` resolves rather than being pinned to its loading state.
const cache = new WeakMap<FieldRow, Map<string, FieldRow>>();

/**
 * The `FieldRow` to render ONE filter value with. Multi-value operators (`_in`, `_between`) render
 * several widgets from this same row — it always describes a single scalar entry, never the list.
 */
export function filterValueField(field: FieldRow, operator: string, derivedChoices?: Choice[] | null): FieldRow {
	let perOperator = cache.get(field);

	if (!perOperator) {
		perOperator = new Map<string, FieldRow>();
		cache.set(field, perOperator);
	}

	const kind = kindOfField(field);
	const textual = TEXT_OPERATORS.has(operator);
	// A plain string field with a known vocabulary becomes a select — the whole point of
	// `GET …/values/:field`. Only for `string`: an enum already has real choices, a relation has
	// the record picker, and a date/number/boolean has a better control than a list of past values.
	// Text operators stay free text (they're substring matches, not membership).
	const useDerived = !textual && kind === 'string' && !!derivedChoices?.length;
	const cacheKey = useDerived ? `${operator}::derived` : operator;

	const cached = perOperator.get(cacheKey);
	if (cached) return cached;

	const edit = textual ? 'input' : useDerived ? 'select-dropdown' : (EDIT_BY_KIND[kind] ?? 'input');

	// Built from the source row with the record-only keys reset, never spread — a spread would carry
	// `role: body` (the markdown editor in a filter row), `kind` (no control at all) or a `many`
	// relation picker that emits an array, when a rule's list-ness is the OPERATOR's business (`_in`
	// renders N single pickers), not the field's. The relation picker is reached through `editor`
	// below, deliberately in single-pick mode.
	const row: FieldRow = {
		...(field.collection ? { collection: field.collection } : {}),
		field: field.field,
		// a multiline markdown field filters as a single-line string; every other wire type stays
		// as-is so EditDatetime can still tell a `date` field from a `datetime` one.
		type: textual || field.type === 'markdown' ? 'string' : field.type,
		title: field.title,
		required: false,
		editable: true,
		nullable: true,
		editor: edit,
		// EditSelect reads its options from `editor_options.choices` — the derived vocabulary goes in
		// under the same key an enum's real choices use, so the control needs no special case.
		...(useDerived
			? { editor_options: { ...field.editor_options, choices: (derivedChoices ?? []).map((c) => ({ label: c.text, value: String(c.value) })) } }
			: field.editor_options
				? { editor_options: field.editor_options }
				: {}),
	};

	perOperator.set(cacheKey, row);
	return row;
}
