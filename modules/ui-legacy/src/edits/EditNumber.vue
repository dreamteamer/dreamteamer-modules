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
	const raw = (event.target as HTMLInputElement).value;
	emit('update:value', raw === '' ? null : Number(raw));
}
</script>

<template>
	<input class="dt-input" type="number" :placeholder="field.placeholder" :value="value == null ? '' : String(value)" :autofocus="autofocus" @input="onInput" />
</template>

<!-- Styling comes entirely from the shared `.dt-input` utility (src/styles/base.css) — no local overrides. -->
