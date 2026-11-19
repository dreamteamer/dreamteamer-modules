<!--
	Field picker for an extension's declared option (operator 2026-07-29: "group by - should be a
	drop down, allow selecting from fields"). Registered as `field-select`; consumed by the kanban's
	`group_by`, the calendar's `start` and the map's lat/lng options — the same control in all
	four places instead of four free-text inputs whose valid values you had to already know.

	The candidate fields come from the ambient field context (lib/field-context.ts), which
	LayoutOptionsSection provides. Two declarative knobs, read off the option's own `editor_options`:
	`types` narrows by wire type (the calendar only wants dates), `prefer: 'choices'` floats
	enum-ish fields to the top (a board's natural group axis) without HIDING the others — a plain
	string column is a legitimate board axis, the kanban just derives the columns from the data
	instead of the schema.

	No context (EditList rows, the schema designer's per-Edit option panels) → a plain text input,
	so the option is still editable by hand rather than a dropdown with nothing in it.
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../api/types';
import { hasChoices, selectableFields, useFieldContext } from '../lib/field-context';
import DtSelect from '../components/DtSelect.vue';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	autofocus?: boolean;
}>();

const emit = defineEmits<{ 'update:value': [value: unknown] }>();

/**
 * What an empty selection MEANS, declared by the option rather than guessed from it.
 *
 * ⚠ This used to be `note ? 'Auto' : '—'` — note-truthiness standing in for a real
 * declaration — and it was wrong as soon as two options with notes meant different things by blank.
 * A blank column axis on a kanban really is automatic (it falls back to the first field declaring
 * choices); a blank ROW axis is not automatic and never was, it means no bands at all. The control
 * said "Auto" directly above its own note saying "blank leaves the list ungrouped".
 *
 * The heuristic is kept as the fallback so every other `field-select` renders exactly as before.
 */
const placeholder = computed(() => {
	const declared = props.field.editor_options?.['placeholder'];
	if (typeof declared === 'string' && declared) return declared;
	return props.field.description ? 'Auto' : '—';
});

const context = useFieldContext();

const candidates = computed<FieldRow[]>(() =>
	context ? selectableFields(context.fields.value, props.field.editor_options) : [],
);

/** Enum-ish fields get a marker: it is the difference between schema-ordered columns and columns
 *  derived from whatever values happen to be in the data. */
function labelFor(row: FieldRow): string {
	return hasChoices(row) ? `${row.field} — choices` : row.field;
}

const current = computed(() => (props.value == null ? '' : String(props.value)));

/** A value the schema no longer has (renamed field, hand-edited view record) must stay visible
 *  rather than silently reading as "auto" — otherwise Save would quietly rewrite it. */
const orphaned = computed(() => current.value !== '' && !candidates.value.some((f) => f.field === current.value));

function onChange(event: Event): void {
	const next = (event.target as HTMLSelectElement | HTMLInputElement).value;
	emitValue(next);
}

function emitValue(next: string): void {
	emit('update:value', next === '' ? null : next);
}

/** The dropdown's options. An ORPHANED value keeps a row of its own so the control shows what is
 *  actually stored instead of falling back to the placeholder and letting Save rewrite it. */
const fieldChoices = computed(() => [
	...(orphaned.value ? [{ text: `${current.value} (not in schema)`, value: current.value }] : []),
	...candidates.value.map((row) => ({ text: labelFor(row), value: row.field })),
]);
</script>

<template>
	<input
		v-if="!context"
		class="dt-input"
		type="text"
		:value="current"
		:autofocus="autofocus"
		placeholder="field name"
		@input="onChange"
	/>
	<DtSelect
		v-else
		:model-value="current"
		:choices="fieldChoices"
		:placeholder="placeholder"
		:autofocus="autofocus"
		:aria-label="field.title || field.field"
		@update:model-value="emitValue(String($event ?? ''))"
	/>
</template>

<!-- Styling is the shared `.dt-select` / `.dt-input` utility (styles/base.css) — no local overrides. -->
