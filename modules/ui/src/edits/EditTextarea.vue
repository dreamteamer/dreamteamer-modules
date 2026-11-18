<script setup lang="ts">
import type { FieldRow } from '../api/types';

defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	autofocus?: boolean;
}>();

const emit = defineEmits<{ 'update:value': [value: unknown] }>();

function onInput(event: Event): void {
	emit('update:value', (event.target as HTMLTextAreaElement).value);
}
</script>

<template>
	<!-- `dir="auto"` for the same reason EditInput carries it: the edit side must not flip a Hebrew value to LTR. -->
	<textarea class="dt-textarea" :dir="field.direction ?? 'auto'" :placeholder="field.placeholder" :value="value == null ? '' : String(value)" :autofocus="autofocus" rows="4" @input="onInput"></textarea>
</template>

<!-- Styling comes entirely from the shared `.dt-textarea` utility (src/styles/base.css) — no local overrides. -->
