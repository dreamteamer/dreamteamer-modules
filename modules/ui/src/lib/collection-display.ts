/**
 * A COLLECTION'S DISPLAY, read off the display contract (descriptor v2, §3.5 / §4.3) — the record
 * header's subtitle and badge, and the `color_by` tint a row, a card and a chip share.
 *
 * Pure, and its own module, so each decision is a tier-1 test rather than a rendered guess. It reads
 * the contract's rows only: a collection row's `record` block, and a field row's
 * `editor_options.choices` (`label` / `value` / `icon` / `color` / `background`). Nothing here falls
 * back to a descriptor key, and nothing invents a decoration the enum map did not author.
 *
 * ⚠ COLOURS ARE THEME COLOUR IDS (`charts.blue`), rendered as `var(--vscode-charts-blue, var(--dt-color-charts-blue, var(--dt-unknown-color)))` — never a
 * hex, which would be authored against one theme and wrong in the other.
 */
import type { CollectionRow, FieldChoice, FieldRow } from '../api/types';
import { choicesOf, isRelationField } from './field-row';

/** What this module reads of a field row: its name, its choices and its role. */
type DisplayField = Pick<FieldRow, 'field' | 'editor_options' | 'role'>;

/** A theme colour id as a CSS value. */
export function themeColor(id: string): string {
	const v = id.replace(/\./g, '-');
	return `var(--vscode-${v}, var(--dt-color-${v}, var(--dt-unknown-color)))`;
}

/** The choice a value is, or null — a value outside the enum is not decorated by guessing. */
export function choiceOf(field: DisplayField | null | undefined, value: unknown): FieldChoice | null {
	if (value === null || value === undefined || value === '' || !field) return null;
	return (choicesOf(field) ?? []).find((c) => String(c.value) === String(value)) ?? null;
}

/** One chip: what it says, and the decoration its choice authored. */
export interface Chip {
	value: string;
	label: string;
	icon?: string;
	color?: string;
	background?: string;
}

function chipOf(field: DisplayField | null | undefined, value: unknown): Chip {
	const choice = choiceOf(field, value);
	const chip: Chip = { value: String(value), label: choice?.label ?? String(value) };
	if (choice?.icon) chip.icon = choice.icon;
	if (choice?.color) chip.color = choice.color;
	if (choice?.background) chip.background = choice.background;
	return chip;
}

/**
 * `display.record.badge` — the named field's value drawn as chips in the record header, one per
 * value of a `many` field. Empty when the collection names no badge or the record holds no value.
 */
export function badgeChips(row: CollectionRow | null | undefined, fields: readonly DisplayField[], record: Record<string, unknown> | null | undefined): Chip[] {
	const name = row?.record.badge;
	if (!name || !record) return [];
	const field = fields.find((f) => f.field === name);
	const raw = record[name];
	const values = (Array.isArray(raw) ? raw : [raw]).filter((v) => v !== null && v !== undefined && v !== '');
	return values.map((v) => chipOf(field, v));
}

/** What a tinted surface needs: the colour id that identifies the value, and its fill when authored. */
export interface Tint {
	color?: string;
	background?: string;
}

/**
 * The tint a record carries under `color_by`: its value's choice colours. Null when the field is
 * not declared, the value is outside the enum, or the choice authored no colour — an undecorated
 * value draws exactly as an untinted one.
 */
export function tintOf(colorBy: string | null | undefined, fields: readonly DisplayField[], record: Record<string, unknown> | null | undefined): Tint | null {
	if (!colorBy || !record) return null;
	const field = fields.find((f) => f.field === colorBy);
	if (!field) return null;
	const raw = record[colorBy];
	const choice = choiceOf(field, Array.isArray(raw) ? raw[0] : raw);
	if (!choice || (!choice.color && !choice.background)) return null;
	const tint: Tint = {};
	if (choice.color) tint.color = choice.color;
	if (choice.background) tint.background = choice.background;
	return tint;
}

/**
 * The CSS custom properties a `.dt-tinted` surface reads: `--dt-tint` is the identifying colour
 * (the accent rail), `--dt-tint-bg` the faint fill. A choice with only one of the two uses it for
 * both, so a colour-only enum still fills and a background-only one still has a rail.
 */
export function tintStyle(tint: Tint | null): Record<string, string> | undefined {
	if (!tint) return undefined;
	const accent = tint.color ?? tint.background!;
	const fill = tint.background ?? tint.color!;
	return { '--dt-tint': themeColor(accent), '--dt-tint-bg': themeColor(fill) };
}

/**
 * Which field tints a list: the layout's own `color_by` option when the view sets one, else the
 * collection's `display.record.color_by` — the view's key wins, the collection's is the default
 * (§3.5: a view's display is merged over the collection's key by key).
 */
export function colorByFor(row: CollectionRow | null | undefined, layoutOptions: Record<string, unknown> | null | undefined): string | null {
	const own = layoutOptions?.['color_by'];
	if (typeof own === 'string' && own) return own;
	return row?.record.color_by ?? null;
}

/** Whether a field holds references — the fields a display template resolves through `record_title`. */
export function isReferenceField(fields: readonly DisplayField[], name: string): boolean {
	const field = fields.find((f) => f.field === name);
	return field ? isRelationField(field) : false;
}
