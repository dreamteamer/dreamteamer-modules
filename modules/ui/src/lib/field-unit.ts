/**
 * A field's UNIT (descriptor v2 §3.4.2 `display.unit` / `display.unit_field`) — how a number reads
 * on the record page, and what sits beside its control on the form.
 *
 *   currency  the value is an amount; the ISO 4217 code is the SIBLING field `unit_field` names on
 *             the same record (`fee` + `currency: ILS` → `₪120.00`, in the viewer's locale)
 *   percent   the value IS the percentage (`12` → `12%`), never a fraction
 *   bytes     a byte count (`1536` → `1.50 KB`, binary units, as the `filesize` View draws it)
 *   other     a literal suffix (`min`, `kg`) after a space
 *
 * Pure, so tier 1 pins each branch. A value that is not a number is not formatted at all — the
 * caller draws it with the field's own View, because a unit on a value it does not describe is a
 * wrong answer, not a decoration.
 */
import { formatFilesize } from './format-filesize';

/** The two display keys a unit is read from — a field row's `unit` and `unit_field`. */
interface UnitField {
	unit?: string;
	unit_field?: string;
}

function numeric(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

/** The ISO code a currency field's sibling holds, upper-cased; null when it holds none. */
export function currencyCodeOf(field: UnitField, record: Record<string, unknown> | null | undefined): string | null {
	if (field.unit !== 'currency' || !field.unit_field) return null;
	const code = record?.[field.unit_field];
	return typeof code === 'string' && /^[A-Za-z]{3}$/.test(code.trim()) ? code.trim().toUpperCase() : null;
}

/**
 * The value as it reads with its unit, or null when there is no unit to apply (no `unit`, or a value
 * that is not a number). `locale` is the viewer's; undefined means the runtime's default.
 */
export function formatWithUnit(field: UnitField, value: unknown, record: Record<string, unknown> | null | undefined, locale?: string): string | null {
	if (!field.unit) return null;
	const n = numeric(value);
	if (n === null) return null;
	switch (field.unit) {
		case 'currency': {
			const code = currencyCodeOf(field, record);
			// No code on the record: the amount alone, never a guessed currency.
			if (!code) return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
			try {
				return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(n);
			} catch {
				// A three-letter code Intl does not know: the amount and the code as written.
				return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ${code}`;
			}
		}
		case 'percent':
			return `${new Intl.NumberFormat(locale).format(n)}%`;
		case 'bytes':
			return formatFilesize(n);
		default:
			return `${new Intl.NumberFormat(locale).format(n)} ${field.unit}`;
	}
}

/**
 * What sits beside the CONTROL on the form, so the operator knows what the number means while typing
 * it: the currency's code (or `currency`, while the sibling is still empty), `%`, `bytes`, or the
 * literal suffix. Empty for a field with no unit.
 */
export function unitSuffix(field: UnitField, record: Record<string, unknown> | null | undefined): string {
	switch (field.unit) {
		case undefined:
		case '':
			return '';
		case 'currency':
			return currencyCodeOf(field, record) ?? 'currency';
		case 'percent':
			return '%';
		case 'bytes':
			return 'bytes';
		default:
			return field.unit;
	}
}
