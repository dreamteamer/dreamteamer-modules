/**
 * An enum's choice rows (the display contract's `{label, value, description, icon, color,
 * background}`, §4.3) → the dropdown's own `{text, value}` rows (`lib/listbox.ts`). One translation,
 * in one place: the contract says `label`, the widget vocabulary the whole app's dropdowns share says
 * `text`, and nothing reads a choice row's label anywhere else.
 */
import type { FieldChoice } from '../api/types';
import type { Choice } from './listbox';

export function normalizeChoices(raw: readonly FieldChoice[] | null | undefined): Choice[] {
	return (raw ?? []).map((c) => ({
		text: c.label,
		value: c.value,
		// Carried BY NAME, like everywhere else this vocabulary travels.
		...(c.icon ? { icon: c.icon } : {}),
		...(c.color ? { color: c.color } : {}),
	}));
}
