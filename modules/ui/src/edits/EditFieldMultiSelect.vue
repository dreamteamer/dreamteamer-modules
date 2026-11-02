<!--
	Several of a collection's fields, as checkboxes. The plural of `field-select`, and it exists for
	the same reason: you should not have to already know the field names.

	Registered as `field-multi-select`; the diagram's "which relations to draw" uses it. Checkboxes
	rather than a `<select multiple>` because the sidebar is narrow and a multi-select there is a
	scroll box you have to cmd-click into — the choices are few (a collection's reference fields
	number in the handful) and seeing them all at once IS the affordance.

	Empty means ALL, not none. A diagram that draws nothing until you tick something reads as broken;
	the useful default is everything, narrowed by choice. The note under the control says so.

	Honors the same `editor_options` knobs as `field-select` (`types`, `roles`), and degrades to a
	comma-separated text input with no field context — same fallback, same reason.
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../api/types';
import { selectableFields, useFieldContext } from '../lib/field-context';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	autofocus?: boolean;
}>();

const emit = defineEmits<{ 'update:value': [value: unknown] }>();

const context = useFieldContext();

const candidates = computed<FieldRow[]>(() =>
	context ? selectableFields(context.fields.value, props.field.editor_options) : [],
);

const selected = computed<string[]>(() => (Array.isArray(props.value) ? props.value.map(String) : []));

function toggle(name: string): void {
	const next = selected.value.includes(name)
		? selected.value.filter((f) => f !== name)
		: [...selected.value, name];
	// An empty selection is stored as null rather than `[]` so the saved view record says "not
	// narrowed" instead of carrying an empty array that reads like a deliberate nothing.
	emit('update:value', next.length ? next : null);
}

function onText(event: Event): void {
	const raw = (event.target as HTMLInputElement).value;
	const next = raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	emit('update:value', next.length ? next : null);
}
</script>

<template>
	<input
		v-if="!context"
		class="dt-input"
		type="text"
		:value="selected.join(', ')"
		:autofocus="autofocus"
		placeholder="field names, comma separated"
		@change="onText"
	/>
	<div v-else-if="!candidates.length" class="dt-field-multi__empty">no matching fields on this collection</div>
	<div v-else class="dt-field-multi">
		<label v-for="row in candidates" :key="row.field" class="dt-field-multi__row">
			<input type="checkbox" :checked="selected.includes(row.field)" @change="toggle(row.field)" />
			<span class="dt-field-multi__name">{{ row.field }}</span>
		</label>
	</div>
</template>

<style scoped>
.dt-field-multi {
	display: flex;
	flex-direction: column;
	gap: 2px;
}
.dt-field-multi__row {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 12px;
	color: var(--dt-fg);
	cursor: pointer;
}
.dt-field-multi__name {
	font-family: var(--dt-font-mono);
	font-size: 11px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.dt-field-multi__empty {
	font-size: 11px;
	color: var(--dt-fg-subtle);
}
</style>
