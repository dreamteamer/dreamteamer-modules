/**
 * Field rows of the display contract (descriptor v2 §4.3), hand-written for fixtures in the shape the
 * engine's `presentation()` emits — flat, with the four keys every row carries (`title`, `required`,
 * `editable`, `nullable`) defaulted the way the engine defaults them. Shared by tier 1 and the render
 * tier so no fixture spells a row its own way.
 *
 * The engine's own `test/unit/presentation-contract.test.js` pins the key list from the other side;
 * these helpers only fill in what a fixture does not care about.
 */
import type { FieldChoice, FieldRow } from '../../src/api/types';

/** Title-case a field name the way compile does when no `title` is authored. */
function titleOf(name: string): string {
	return name
		.split(/[_\-\s]+/)
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

export function fieldRow(field: string, overrides: Partial<FieldRow> = {}): FieldRow {
	const required = overrides.required ?? false;
	return {
		field,
		type: 'string',
		title: titleOf(field),
		required,
		editable: true,
		nullable: !required,
		...overrides,
	};
}

/** An enum field: its choice rows on `editor_options` and `viewer_options` alike, as the engine
 *  carries them. A bare string is a value whose label is the value. */
export function enumRow(field: string, choices: Array<string | FieldChoice>, overrides: Partial<FieldRow> = {}): FieldRow {
	const rows = choices.map((c) => (typeof c === 'string' ? { label: c, value: c } : c));
	return fieldRow(field, { editor_options: { choices: rows }, viewer_options: { choices: rows }, ...overrides });
}

/** A reference to another collection — `many` makes it a list. */
export function referenceRow(field: string, many = false, overrides: Partial<FieldRow> = {}): FieldRow {
	return fieldRow(field, { role: many ? 'reference_many' : 'reference', ...(many ? { many: true as const } : {}), ...overrides });
}

/** The generated mirror of `mirrorOf` on the collection the relation targets. */
export function mirrorRow(field: string, mirrorOf: string, many = true): FieldRow {
	return fieldRow(field, { kind: 'mirror', role: 'mirror', editable: false, mirror_of: mirrorOf, ...(many ? { many: true as const } : {}) });
}

/** The markdown page field. */
export function bodyRow(field = 'body'): FieldRow {
	return fieldRow(field, { type: 'markdown', role: 'body' });
}

/** The three injected fields, exactly as presentation emits them. */
export const injected = {
	id: (): FieldRow => fieldRow('id', { title: 'Id', kind: 'virtual', editable: false, hidden: ['list', 'form', 'record'] }),
	created: (): FieldRow => fieldRow('created', { type: 'datetime', kind: 'derived', editable: false, hidden: ['form'] }),
	last_modified: (): FieldRow => fieldRow('last_modified', { type: 'datetime', title: 'Last Modified', kind: 'virtual', editable: false, hidden: ['form'] }),
};
