/**
 * Field → Material Symbols icon name, for the properties layout's leading glyph (the Obsidian
 * look: `≡ name`, `📅 date` — the icon says what KIND of value this is at a glance, before you
 * read the label).
 *
 * Resolution mirrors registry/resolve.ts's precedence deliberately, so the icon and the widget
 * never disagree: the authored `editor` id, then the field's SHAPE (the body, a relation, a list, an
 * enum, an object), then the wire type. Anything unrecognized lands on `note`, the neutral "some
 * text" glyph, never a blank cell.
 *
 * Every name below is checked against the bundled font's manifest (lib/icon-names.ts); a name the
 * font can't render would show as literal ligature text, which is worse than no icon at all.
 */
import type { FieldRow } from '../api/types';
import { choicesOf, isBodyField, isRelationField } from './field-row';

const FALLBACK = 'note';

/** Authored `editor` id → glyph. Ids are the register-defaults.ts contracts, verbatim. */
const BY_EDIT: Record<string, string> = {
	input: 'note',
	textarea: 'symbol-text',
	'markdown-body': 'symbol-text',
	'input-number': 'symbol-numeric',
	boolean: 'checklist',
	datetime: 'calendar',
	'select-dropdown': 'list-unordered',
	'relation-picker': 'link',
	tags: 'tag',
	slider: 'settings',
	color: 'symbol-color',
	code: 'code',
	list: 'list-ordered',
	nested: 'json',
	json: 'json',
	'field-select': 'tag',
	'display-template': 'code',
};

/** Wire type → glyph, the last resort before FALLBACK. */
const BY_TYPE: Record<string, string> = {
	string: 'note',
	markdown: 'symbol-text',
	number: 'symbol-numeric',
	integer: 'symbol-numeric',
	boolean: 'checklist',
	date: 'calendar',
	datetime: 'calendar',
	url: 'link-external',
	email: 'mail',
	object: 'json',
	map: 'json',
	position: 'list-ordered',
};

export function fieldIcon(field: FieldRow): string {
	const editor = field.editor;
	if (typeof editor === 'string' && editor in BY_EDIT) return BY_EDIT[editor] as string;

	if (isBodyField(field)) return 'symbol-text';
	if (isRelationField(field)) return 'link';
	if (field.many) return field.type === 'object' ? 'list-ordered' : 'tag';
	// Same enum inference resolveEdit makes — a field with choices reads as a picker.
	if (choicesOf(field)) return 'list-unordered';

	return BY_TYPE[field.type] ?? FALLBACK;
}
