<!--
	Read View for a single structured object (ui-views.nav, collections.storage/id…) — the read-side
	twin of EditNested: a compact key/value grid, declared sub-fields (options.fields) first, then
	extras. Registered `id: 'nested'`, types: [] — opt-in via the adapter for `type: object` fields
	with declared properties. Open objects (no properties) keep ViewJson's {…} chip default.
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../api/types';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
}>();

const model = computed<Record<string, unknown> | null>(() =>
	props.value != null && typeof props.value === 'object' && !Array.isArray(props.value)
		? (props.value as Record<string, unknown>)
		: null,
);

// The sub-field rows of the item object — full field rows of the display contract.
const rowFields = computed<FieldRow[]>(() => {
	const declared = props.options?.['fields'];
	return Array.isArray(declared) ? (declared as FieldRow[]) : [];
});

const show = (v: unknown): string => {
	if (v == null || v === '') return '—';
	return typeof v === 'object' ? JSON.stringify(v, null, 1) : String(v);
};

const entries = computed<Array<[string, unknown]>>(() => {
	if (!model.value) return [];
	const row = model.value;
	const declared = rowFields.value.map((f) => f.field).filter((f) => f in row);
	const extras = Object.keys(row).filter((k) => !declared.includes(k));
	return [...declared, ...extras].map((k) => [k, row[k]]);
});
</script>

<template>
	<span v-if="!model || entries.length === 0" class="dt-nested-view__empty">—</span>
	<dl v-else class="dt-nested-view">
		<template v-for="[key, val] in entries" :key="key">
			<dt>{{ key }}</dt>
			<dd>{{ show(val) }}</dd>
		</template>
	</dl>
</template>

<style scoped>
.dt-nested-view {
	display: grid;
	grid-template-columns: minmax(90px, max-content) 1fr;
	gap: 4px 14px;
	margin: 0;
}
.dt-nested-view__empty {
	color: var(--dt-fg-subtle);
}
.dt-nested-view dt {
	color: var(--dt-fg-muted);
	font-size: var(--dt-text);
	padding-top: 1px;
}
.dt-nested-view dd {
	margin: 0;
	font-size: var(--dt-text);
	white-space: pre-wrap;
	word-break: break-word;
}
</style>
