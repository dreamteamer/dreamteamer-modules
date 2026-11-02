<!--
	Read View for arrays of structured rows (workflows.steps and friends) — the read-side twin of
	EditList: same options contract ({ fields, item_title? }), rendered as collapsible summary rows
	instead of "[object Object]" chips. Registered `id: 'list'`, types: [] — opt-in via the adapter
	when a descriptor declares `type: array` with object items.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { FieldRow } from '../api/types';
import { tryRenderDisplay } from '../lib/template';
import DtIcon from '../components/DtIcon.vue';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
}>();

const rows = computed<Record<string, unknown>[]>(() =>
	Array.isArray(props.value)
		? props.value.map((r) => (r != null && typeof r === 'object' ? (r as Record<string, unknown>) : { value: r }))
		: [],
);

// The sub-field rows of the item object — full field rows of the display contract.
const rowFields = computed<FieldRow[]>(() => {
	const declared = props.options?.['fields'];
	return Array.isArray(declared) ? (declared as FieldRow[]) : [];
});
// `item_title` labels each row (descriptor v2 §3.4.1: rows of a `many` object).
const template = computed<string | null>(() => {
	const t = props.options?.['item_title'];
	return typeof t === 'string' && t.length > 0 ? t : null;
});

const expanded = ref<Set<number>>(new Set());
function toggle(i: number): void {
	if (expanded.value.has(i)) expanded.value.delete(i);
	else expanded.value.add(i);
}

const show = (v: unknown): string => {
	if (v == null || v === '') return '—';
	return typeof v === 'object' ? JSON.stringify(v, null, 1) : String(v);
};

function summary(row: Record<string, unknown>, i: number): string {
	if (template.value) {
		const rendered = (tryRenderDisplay(template.value, row) ?? '').trim();
		if (rendered) return rendered;
	}
	const first = rowFields.value[0]?.field ?? Object.keys(row)[0];
	if (first != null) {
		const v = row[first];
		if (v != null && v !== '') return typeof v === 'object' ? JSON.stringify(v) : String(v);
	}
	return `Item ${i + 1}`;
}

/** Row detail: declared sub-fields first (in declared order), then any undeclared extras. */
function entries(row: Record<string, unknown>): Array<[string, unknown]> {
	const declared = rowFields.value.map((f) => f.field).filter((f) => f in row);
	const extras = Object.keys(row).filter((k) => !declared.includes(k));
	return [...declared, ...extras].map((k) => [k, row[k]]);
}
</script>

<template>
	<span v-if="rows.length === 0" class="dt-list-view__empty">—</span>
	<div v-else class="dt-list-view">
		<div v-for="(row, i) in rows" :key="i" class="dt-list-view__row">
			<button type="button" class="dt-list-view__summary" @click="toggle(i)">
				<DtIcon class="dt-list-view__chevron" :class="{ 'is-open': expanded.has(i) }" name="chevron-right" />
				<span class="dt-list-view__index">{{ i + 1 }}</span>
				<span class="dt-list-view__label">{{ summary(row, i) }}</span>
			</button>
			<dl v-if="expanded.has(i)" class="dt-list-view__detail">
				<template v-for="[key, val] in entries(row)" :key="key">
					<dt>{{ key }}</dt>
					<dd>{{ show(val) }}</dd>
				</template>
			</dl>
		</div>
	</div>
</template>

<style scoped>
.dt-list-view {
	display: flex;
	flex-direction: column;
	gap: 4px;
}
.dt-list-view__empty {
	color: var(--dt-fg-subtle);
}
.dt-list-view__row {
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius);
	background: var(--dt-bg);
}
.dt-list-view__summary {
	display: flex;
	align-items: center;
	gap: 6px;
	width: 100%;
	border: none;
	background: transparent;
	cursor: pointer;
	padding: 7px 10px;
	font: inherit;
	font-size: var(--dt-text);
	color: var(--dt-fg);
	text-align: left;
}
.dt-list-view__chevron {
	font-size: var(--dt-icon);
	color: var(--dt-fg-subtle);
	transition: transform 0.12s ease;
}
.dt-list-view__chevron.is-open {
	transform: rotate(90deg);
}
.dt-list-view__index {
	color: var(--dt-fg-subtle);
	font-size: var(--dt-text);
	font-family: var(--dt-font-mono);
}
.dt-list-view__label {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.dt-list-view__detail {
	display: grid;
	grid-template-columns: minmax(90px, max-content) 1fr;
	gap: 4px 14px;
	margin: 0;
	padding: 8px 12px 12px 36px;
	border-top: 1px solid var(--dt-border);
}
.dt-list-view__detail dt {
	color: var(--dt-fg-muted);
	font-size: var(--dt-text);
	padding-top: 1px;
}
.dt-list-view__detail dd {
	margin: 0;
	font-size: var(--dt-text);
	white-space: pre-wrap;
	word-break: break-word;
}
</style>
