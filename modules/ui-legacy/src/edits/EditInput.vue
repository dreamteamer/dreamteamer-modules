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
	emit('update:value', (event.target as HTMLInputElement).value);
}
</script>

<template>
	<!-- Ultimate-fallback guard: an object landing here (mis-typed field) shows JSON, not "[object Object]". -->
	<!-- `dir`: the field's declared `direction` when it has one, else `auto` — the webview is dir=ltr
	     and the VIEW side already resolves direction per value (ViewText, render-md), so without it a
	     Hebrew value flips to LTR the moment it is edited. -->
	<input
		class="dt-input"
		type="text"
		:dir="field.direction ?? 'auto'"
		:placeholder="field.placeholder"
		:value="value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)"
		:autofocus="autofocus"
		@input="onInput"
	/>
</template>

<!-- Styling comes entirely from the shared `.dt-input` utility (src/styles/base.css) — no local overrides. -->
