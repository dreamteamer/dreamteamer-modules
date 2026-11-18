/**
 * "Which collection's fields am I configuring?" — provided by whoever draws an options form, and
 * injected by the Edits that need to OFFER fields rather than have them typed in (kanban wave
 * follow-up, 2026-07-29; operator: "group by - should be a drop down, allow selecting from fields").
 *
 * Why provide/inject and not a prop: an extension's declared settings are a static
 * `OptionFieldDef[]` (registry/index.ts) rendered by OptionsForm → FormField → RenderEdit. None of
 * those three has any business knowing about collections, and threading a `context` prop through
 * all of them to reach one leaf Edit would put collection awareness in the generic form machinery.
 * The context is genuinely ambient — exactly what inject is for.
 *
 * Absence is a normal state, not an error: EditList/EditNested rows and the schema designer's
 * per-Edit option panels draw option forms where no collection context exists (an EditList row's
 * "fields" are the row's own shape, not a collection's). `useFieldContext()` returns null there and
 * the consuming Edits fall back to a plain text input, so a field-select in that position still
 * accepts a hand-typed name instead of rendering an empty, useless dropdown.
 */
import { inject, provide, type InjectionKey, type Ref } from 'vue';
import type { FieldRow } from '../api/types';
import { choicesOf } from './field-row';

export interface FieldContext {
	/** Collection whose fields these are — for labels/notes, not for fetching (fields arrive resolved). */
	collection: string;
	/** The collection's selectable fields, already filtered to what a human should see. */
	fields: Ref<FieldRow[]>;
}

const FIELD_CONTEXT: InjectionKey<FieldContext> = Symbol('dt-field-context');

export function provideFieldContext(context: FieldContext): void {
	provide(FIELD_CONTEXT, context);
}

export function useFieldContext(): FieldContext | null {
	return inject(FIELD_CONTEXT, null);
}

/** True when `field` declares a fixed vocabulary — a natural board/group axis. */
export function hasChoices(field: FieldRow): boolean {
	return choicesOf(field) !== null;
}

/**
 * Fields an option should offer, honoring three `editor_options` knobs an option may declare:
 *   `types`  — keep only these wire types (`['date','datetime']` for a calendar's date field)
 *   `roles`  — keep only fields playing one of these roles (`['reference','reference_many']`)
 *   `prefer` — `'choices'` floats enum-ish fields to the top (a kanban's group-by axis)
 * Order is otherwise the schema's own field order, which is the order the operator reads
 * everywhere else.
 */
export function selectableFields(fields: FieldRow[], options?: Record<string, unknown>): FieldRow[] {
	const types = options?.['types'];
	const wanted = Array.isArray(types) ? types.map(String) : null;
	let filtered = wanted ? fields.filter((f) => wanted.includes(f.type)) : [...fields];

	// `roles` narrows by the display contract's `role` rather than by wire type — which is how a
	// diagram asks for "the reference fields" without knowing what a reference is stored as (they
	// travel as plain strings; `role` is what makes one a relation).
	const roles = options?.['roles'];
	if (Array.isArray(roles) && roles.length) {
		const wantedRoles = roles.map(String);
		filtered = filtered.filter((f) => f.role !== undefined && wantedRoles.includes(f.role));
	}

	if (options?.['prefer'] !== 'choices') return filtered;
	return filtered.sort((a, b) => Number(hasChoices(b)) - Number(hasChoices(a)));
}
