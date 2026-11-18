<!--
	Number input as a range slider (phase E scope item 1), `options.min`/`options.max`/`options.step`
	configurable (defaults 0/100/1). Opt-in only (`types: []`) — a bare numeric field defaulting to
	a 0-100 slider would be wrong for most number fields (a year, a count, a price), so this is
	never kind-inferred, only reachable via explicit `editor: slider`.
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

const min = computed(() => Number(props.options?.['min'] ?? 0));
const max = computed(() => Number(props.options?.['max'] ?? 100));
const step = computed(() => Number(props.options?.['step'] ?? 1));
const numeric = computed(() => (typeof props.value === 'number' ? props.value : Number(props.value)));
const display = computed(() => (Number.isFinite(numeric.value) ? numeric.value : min.value));

function onInput(event: Event): void {
	emit('update:value', Number((event.target as HTMLInputElement).value));
}
</script>

<template>
	<div class="dt-slider">
		<input
			class="dt-slider-range"
			type="range"
			:min="min"
			:max="max"
			:step="step"
			:value="display"
			:autofocus="autofocus"
			@input="onInput"
		/>
		<span class="dt-slider-value">{{ display }}</span>
	</div>
</template>

<style scoped>
.dt-slider {
	display: flex;
	align-items: center;
	gap: 12px;
	height: var(--dt-input-height);
}
.dt-slider-range {
	flex: 1 1 auto;
	accent-color: var(--dt-accent);
}
.dt-slider-value {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 36px;
	height: 24px;
	padding: 0 8px;
	border-radius: 999px;
	background: var(--dt-accent-subtle);
	color: var(--dt-accent);
	font-size: var(--dt-text);
	font-weight: 600;
	white-space: nowrap;
}
</style>
