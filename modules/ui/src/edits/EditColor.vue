<!--
	Color swatch + native color picker, backed by a plain hex string field (phase E scope item 1).
	Opt-in only (`types: []`) — a string field defaulting to a color picker would be wrong for the
	overwhelming majority of string fields, so only reachable via explicit `editor: color`.
	The native `<input type="color">` requires a strict `#rrggbb` value; the text field alongside it
	accepts anything (so a field mid-edit, or seeded with a 3-digit/named value, is never clobbered)
	and only the swatch itself falls back to a neutral gray when the current value isn't valid.
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../api/types';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	autofocus?: boolean;
}>();

const emit = defineEmits<{ 'update:value': [value: unknown] }>();

const HEX_RE = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i;

const text = computed(() => (typeof props.value === 'string' ? props.value : ''));
const swatchValue = computed(() => (HEX_RE.test(text.value) ? text.value : '#cccccc'));

function onSwatchInput(event: Event): void {
	emit('update:value', (event.target as HTMLInputElement).value);
}

function onTextInput(event: Event): void {
	emit('update:value', (event.target as HTMLInputElement).value);
}
</script>

<template>
	<div class="dt-color">
		<input type="color" class="dt-color-swatch" :value="swatchValue" :autofocus="autofocus" @input="onSwatchInput" />
		<input type="text" class="dt-input dt-color-hex" :value="text" placeholder="#rrggbb" @input="onTextInput" />
	</div>
</template>

<style scoped>
.dt-color {
	display: flex;
	align-items: center;
	gap: 8px;
}
.dt-color-swatch {
	width: 48px;
	height: var(--dt-input-height);
	padding: 3px;
	border: 1px solid var(--dt-border-strong);
	border-radius: var(--dt-radius);
	background: var(--dt-bg-subtle);
	cursor: pointer;
	flex-shrink: 0;
}
.dt-color-hex {
	flex: 1 1 auto;
}
</style>
