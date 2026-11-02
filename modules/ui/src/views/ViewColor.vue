<!--
	Color swatch + hex text (phase E scope item 2), pairing EditColor. Opt-in only
	(`types: []`) — a string field defaulting to a color swatch would be wrong for most string
	fields, only reachable via explicit `viewer: color`.
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../api/types';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
}>();

const HEX_RE = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i;
const hex = computed(() => (typeof props.value === 'string' && HEX_RE.test(props.value) ? props.value : null));
</script>

<template>
	<span v-if="hex" class="dt-display-color">
		<span class="dt-display-color-swatch" :style="{ background: hex }"></span>
		{{ hex }}
	</span>
	<span v-else class="dt-display-color-empty">—</span>
</template>

<style scoped>
.dt-display-color {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	color: var(--dt-fg);
	white-space: nowrap;
}
.dt-display-color-swatch {
	display: inline-block;
	width: 14px;
	height: 14px;
	border-radius: 4px;
	border: 1px solid var(--dt-border);
}
.dt-display-color-empty {
	color: var(--dt-fg-subtle);
}
</style>
