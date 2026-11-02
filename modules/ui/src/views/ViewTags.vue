<!--
	Chip-list rendering for a `many` field of scalars (phase E scope item 2), pairing EditTags. The
	display contract says `many: true` outright, so resolve.ts reaches it by that SHAPE; `types: []`
	keeps it off the per-type defaults, where a single scalar would land on it.
-->
<!--
	Compact chip display for table cells (spec: "up to 3 .dt-chip--sm + '+n'"). `.dt-chip--sm` is
	now a shared `base.css` utility (polish wave defect 8 — promoted out of this component's scoped
	style, which is where it originally landed as a noted shared-utility gap).
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../api/types';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
}>();

const MAX_VISIBLE = 3;

// Objects stringify as JSON, never String() — "[object Object]" chips helped nobody.
const tags = computed<string[]>(() =>
	Array.isArray(props.value)
		? props.value.map((v) => (v != null && typeof v === 'object' ? JSON.stringify(v) : String(v)))
		: [],
);
const visible = computed(() => tags.value.slice(0, MAX_VISIBLE));
const overflow = computed(() => Math.max(0, tags.value.length - MAX_VISIBLE));
</script>

<template>
	<span v-if="!tags.length" class="dt-display-tags-empty">—</span>
	<span v-else class="dt-display-tags">
		<span v-for="tag in visible" :key="tag" class="dt-chip dt-chip--sm">{{ tag }}</span>
		<span v-if="overflow > 0" class="dt-display-tags-overflow">+{{ overflow }}</span>
	</span>
</template>

<style scoped>
.dt-display-tags {
	display: inline-flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 4px;
}
.dt-display-tags-overflow {
	font-size: var(--dt-label);
	color: var(--dt-fg-subtle);
}
.dt-display-tags-empty {
	color: var(--dt-fg-subtle);
}
</style>
