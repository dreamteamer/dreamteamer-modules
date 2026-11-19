<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../api/types';
import { toLocalInputValue, fromLocalInputValue } from '../lib/datetime-input';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	autofocus?: boolean;
}>();

const emit = defineEmits<{ 'update:value': [value: unknown] }>();

/** Date-only fields (`type === 'date'`) get a plain `<input type="date">`; everything else is `datetime-local`. */
const isDateOnly = computed(() => props.field.type === 'date');
const inputType = computed(() => (isDateOnly.value ? 'date' : 'datetime-local'));

const localValue = computed(() => toLocalInputValue(props.value, isDateOnly.value));

// Emits the raw wall clock (`2026-07-28T12:00`), NOT an ISO instant. The engine's temporal
// normalizer stamps the local offset on at validation time, which keeps this write identical to
// the one `dreamteamer <c> set <id> starts=2026-07-28T12:00` produces — and keeps the stored value
// readable as the time the operator actually typed. See lib/datetime-input.ts.
function onInput(event: Event): void {
	emit('update:value', fromLocalInputValue((event.target as HTMLInputElement).value));
}
</script>

<template>
	<input class="dt-input" :type="inputType" :value="localValue" :autofocus="autofocus" @input="onInput" />
</template>

<!-- Styling comes entirely from the shared `.dt-input` utility (src/styles/base.css) — no local overrides. -->
