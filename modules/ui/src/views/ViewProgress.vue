<!--
	Number-as-progress-bar (phase E scope item 2): `options.max` (default 100) sets the bar's full
	scale, clamped to [0, max] for the fill width. Opt-in only (`types: []`) — most number fields
	aren't a 0..max progress value, so this is never kind-inferred, only reachable via explicit
	`viewer: progress`.
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../api/types';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
}>();

const max = computed(() => {
	const m = Number(props.options?.['max'] ?? 100);
	return Number.isFinite(m) && m > 0 ? m : 100;
});

const numeric = computed(() => (typeof props.value === 'number' ? props.value : Number(props.value)));

const pct = computed(() => {
	if (!Number.isFinite(numeric.value)) return null;
	return Math.max(0, Math.min(100, (numeric.value / max.value) * 100));
});
</script>

<template>
	<span v-if="pct === null" class="dt-display-progress-empty">—</span>
	<span v-else class="dt-display-progress">
		<span class="dt-display-progress-track">
			<span class="dt-display-progress-fill" :style="{ width: `${pct}%` }"></span>
		</span>
		<span class="dt-display-progress-label">{{ numeric }}/{{ max }}</span>
	</span>
</template>

<style scoped>
.dt-display-progress {
	display: inline-flex;
	align-items: center;
	gap: 8px;
}
.dt-display-progress-track {
	position: relative;
	width: 72px;
	height: 6px;
	border-radius: 999px;
	background: var(--dt-border);
	overflow: hidden;
}
.dt-display-progress-fill {
	position: absolute;
	inset: 0 auto 0 0;
	height: 100%;
	border-radius: 999px;
	background: var(--dt-accent);
}
.dt-display-progress-label {
	font-size: var(--dt-text);
	color: var(--dt-fg-subtle);
	white-space: nowrap;
}
.dt-display-progress-empty {
	color: var(--dt-fg-subtle);
}
</style>
