<!--
	Colored-dot + label display (spec §"Interfaces/displays restyle notes"): status-shaped values
	(open/running/parked, done/success/resolved, failed/rejected) get a semantic dot color; any
	other value gets a neutral dot. Purely a string-match on the resolved label/raw value — no
	schema declares "this is a status field", so this is a best-effort convention, not a contract.
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../api/types';
import { normalizeChoices } from '../lib/choices';
import { choicesOf } from '../lib/field-row';

// The stored value is mapped to its choice row's `label` (and, if the row declares one, `color` as
// the dot) rather than shown raw — falling back to the value itself when no choice matches. The
// choice rows are the field's own (`editor_options.choices`): one enum, declared once.
const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
}>();

const ACCENT_VALUES = new Set(['open', 'running', 'parked']);
const SUCCESS_VALUES = new Set(['done', 'success', 'resolved']);
const DANGER_VALUES = new Set(['failed', 'rejected']);

const raw = computed(() => (props.value === null || props.value === undefined ? '' : String(props.value)));

const choices = computed(() => normalizeChoices(choicesOf(props.field)));

const label = computed(() => choices.value.find((choice) => choice.value === raw.value)?.text ?? raw.value);

/** A choice may declare an explicit `color`: when present it becomes the dot's background,
 *  overriding the string-match convention below. */
const choiceColor = computed(() => choices.value.find((choice) => String(choice.value) === raw.value)?.color ?? null);

const dotClass = computed(() => {
	if (choiceColor.value) return '';
	const key = raw.value.toLowerCase();
	if (ACCENT_VALUES.has(key)) return 'dt-status-dot--accent';
	if (SUCCESS_VALUES.has(key)) return 'dt-status-dot--success';
	if (DANGER_VALUES.has(key)) return 'dt-status-dot--danger';
	return 'dt-status-dot--neutral';
});
</script>

<template>
	<span class="dt-display-label">
		<span class="dt-status-dot" :class="dotClass" :style="choiceColor ? { background: choiceColor } : undefined"></span>
		{{ label }}
	</span>
</template>

<style scoped>
.dt-display-label {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	color: var(--dt-fg);
	white-space: nowrap;
}
.dt-status-dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	flex-shrink: 0;
}
.dt-status-dot--accent {
	background: var(--dt-accent);
}
.dt-status-dot--success {
	background: var(--dt-success);
}
.dt-status-dot--danger {
	background: var(--dt-danger);
}
.dt-status-dot--neutral {
	background: var(--dt-fg-muted);
}
</style>
