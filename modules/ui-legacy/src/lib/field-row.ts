/**
 * The questions every surface asks of ONE field row of the display contract (engine
 * `presentation()`, descriptor v2 §4.3), answered in one place so no component re-derives them.
 *
 * Pure and import-free beyond the type, so tier 1 can pin each answer without a renderer.
 *
 * Four facts the contract states and these helpers read verbatim:
 *  - `role` — `body` (the page field), `reference` / `reference_many` (a foreign key), `mirror` (the
 *    generated far side of a relation).
 *  - `kind` — `derived` · `virtual` · `mirror`: the engine refuses every writer, so NO surface offers
 *    a control, on any form, in any mode. Nothing relaxes it.
 *  - `editable` — the UI's own lock: `false` draws no control, `create` draws one on the create form
 *    only. The CLI and syncs still write such a field; only this surface declines to.
 *  - `hidden` — the surfaces not to draw it on: `list`, `form` (edit and create), `record` (the read).
 */
import type { FieldChoice, FieldRow, FieldSurface } from '../api/types';

/** The record's prose — drawn last, label-less, as the page. */
export function isBodyField(field: Pick<FieldRow, 'role'>): boolean {
	return field.role === 'body';
}

/** A foreign key, single or list. A mirror is not one: it is generated, never written. */
export function isReferenceField(field: Pick<FieldRow, 'role'>): boolean {
	return field.role === 'reference' || field.role === 'reference_many';
}

/** The generated far side of a relation. */
export function isMirrorField(field: Pick<FieldRow, 'kind'>): boolean {
	return field.kind === 'mirror';
}

/** Any field whose value names records of another collection — a key, or the mirror of one. */
export function isRelationField(field: Pick<FieldRow, 'role'>): boolean {
	return isReferenceField(field) || field.role === 'mirror';
}

/** A relation holding a LIST of references (a `many` key, or a mirror of a non-unique key). */
export function isRelationList(field: Pick<FieldRow, 'role' | 'many'>): boolean {
	return isRelationField(field) && field.many === true;
}

/** Whether a surface draws the field at all. */
export function drawnOn(field: Pick<FieldRow, 'hidden'>, surface: FieldSurface): boolean {
	return !(field.hidden ?? []).includes(surface);
}

/**
 * Whether the form offers a CONTROL for this field — as against drawing its value read-only.
 *
 * Any `kind` refuses: the engine owns the value. `editable: create` is a control on the create form
 * and a value everywhere else (the id-like field an operator types once). `editable: false` is never
 * a control.
 */
export function hasControl(field: Pick<FieldRow, 'kind' | 'editable'>, opts: { create: boolean }): boolean {
	if (field.kind !== undefined) return false;
	if (field.editable === 'create') return opts.create;
	return field.editable === true;
}

/**
 * THE ONE COMPUTED RULE — why a field cannot be written on this form, or null when it can (operator
 * 2026-10-30: computed values are drawn DIMMED and read-only, never labelled "(computed)"). Every
 * surface that draws a record — `ItemProperties`, `ItemForm`/`FormField`, a table header, the column
 * picker — asks this and nothing else, so a mirror, an engine-derived or virtual field (`created`,
 * `last_modified`, a binary record's `ext`/`bytes`, `$source`, `$module`), an authored
 * `editable: false` and a create-only field on the edit form all look and explain themselves alike.
 * The answer is the TOOLTIP; the dimming is the signal. A field with a control here returns null.
 */
export function computedReason(
	field: Pick<FieldRow, 'kind' | 'editable' | 'mirror_of' | 'description'>,
	opts: { create: boolean; target?: string },
): string | null {
	if (hasControl(field, opts)) return null;
	if (isMirrorField(field)) {
		const owner = field.mirror_of ? (opts.target ? `${opts.target}.${field.mirror_of}` : field.mirror_of) : 'the other side of the link';
		return `Generated from ${owner} — set that field.`;
	}
	if (field.kind !== undefined) return (field.description ?? '').trim() || 'Computed — never written by hand.';
	if (field.editable === 'create') return 'Set when the record is created; read-only afterwards.';
	return 'Read-only — the schema does not let it be edited here.';
}

/**
 * Does an EXISTING record offer anything to edit? A `format: binary` record's fields (`ext`, `bytes`)
 * are all read from its file, so its page used to offer Edit and open a form with no control in it and a
 * Save that could never enable — a dead end that said nothing about why. No control, no Edit.
 */
export function editsAnything(fields: readonly Pick<FieldRow, 'kind' | 'editable'>[]): boolean {
	return fields.some((f) => hasControl(f, { create: false }));
}

/** The enum's choice rows, or null for a field with no enum. */
export function choicesOf(field: Pick<FieldRow, 'editor_options'>): FieldChoice[] | null {
	const choices = field.editor_options?.choices;
	return Array.isArray(choices) ? choices : null;
}

/** An object's sub-field rows — each a full field row of the contract. */
export function subFieldsOf(field: Pick<FieldRow, 'editor_options'>): FieldRow[] {
	const fields = field.editor_options?.fields;
	return Array.isArray(fields) ? fields : [];
}

/**
 * The form's SECTIONS (descriptor v2 §3.5): each entry of the row's `form.sections` in order, with
 * its fields in the order the section lists them; then one LAST, unnamed section holding every field
 * no section claims, in field order. The engine lists the authored sections first and then any
 * section only a field's `form_section` names, in the order of its first field (0.33.0), so no
 * section is rebuilt here out of the field rows. The body is never in a section — the caller draws it after all of
 * them. A section none of whose fields reach the caller (hidden on this surface, deprecated) is
 * dropped rather than drawn as an empty heading.
 *
 * A field's `form_section` and the section's `fields` list are the same fact from two sides; the
 * engine already folds one into the other, so the section's list is what decides membership and
 * order here (`test/unit/api-form-sections.test.ts` proves it against a real compile).
 */
export interface FormSection {
	/** `''` for the trailing unnamed section. */
	title: string;
	fields: FieldRow[];
	/** Drawn SHUT until opened, and AFTER every other field — the unclaimed ones included: what a
	 *  person rarely reads and an agent writes (the provenance quad). Authored `collapsed: true`. */
	collapsed?: true;
}

export function formSections(fields: readonly FieldRow[], sections: ReadonlyArray<{ title: string; fields: readonly string[]; collapsed?: boolean }> | undefined): FormSection[] {
	const byName = new Map(fields.filter((f) => !isBodyField(f)).map((f) => [f.field, f]));
	const claimed = new Set<string>();
	const out: FormSection[] = [];
	for (const s of sections ?? []) {
		const rows: FieldRow[] = [];
		for (const name of s.fields) {
			const row = byName.get(name);
			if (!row || claimed.has(name)) continue;
			claimed.add(name);
			rows.push(row);
		}
		if (rows.length) out.push({ title: s.title, fields: rows, ...(s.collapsed === true ? { collapsed: true as const } : {}) });
	}
	const rest = [...byName.values()].filter((f) => !claimed.has(f.field));
	if (rest.length) out.push({ title: '', fields: rest });
	// a collapsed section goes last — below the unclaimed fields too — so shutting it costs nothing above it
	return [...out.filter((s) => !s.collapsed), ...out.filter((s) => s.collapsed)];
}
