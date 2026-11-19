<!--
	Repeatable list Edit (contract C5, schema-designer facelift). Edits a `value: unknown[]` where
	each element is a row object shaped by the declared sub-fields. Registered `id: 'list'` with
	`types: []` — explicit opt-in only, never kind-inferred (a JSON array is indistinguishable by
	wire type from any other json value). Opted into today by the `select-dropdown` Edit's `choices`
	option (register-defaults.ts), and by Wave-2 field editors that declare repeatable option groups.

	Its `options` prop (the consuming field's `editor_options`) is the display contract's:
	  { fields: FieldRow[];         // the item object's sub-field rows, rendered per row via OptionsForm
	    item_title?: string }       // collapsed-row summary, rendered via lib/template.ts

	Rows are collapsible (summary line from the template, else the first field's value, else a
	positional fallback), added, removed, and reordered by native HTML drag — no new dependencies.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { FieldRow } from '../api/types';
import { tryRenderDisplay } from '../lib/template';
import OptionsForm from '../components/render/OptionsForm.vue';
import DtIcon from '../components/DtIcon.vue';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	autofocus?: boolean;
}>();

const emit = defineEmits<{ 'update:value': [value: unknown] }>();

// Rows are always plain objects — a non-object element (or a non-array value) normalizes to {} so
// the OptionsForm binding never sees a primitive.
const rows = computed<Record<string, unknown>[]>(() =>
	Array.isArray(props.value)
		? props.value.map((r) => (r != null && typeof r === 'object' ? (r as Record<string, unknown>) : {}))
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

// Stable per-row identity: a uid assigned to each row OBJECT (not its array index), so expansion and
// Vue's :key survive a drag reorder or a mid-list removal. Object refs are preserved across those
// ops; only an in-place edit produces a fresh object, so updateRow carries the uid across.
const rowUids = new WeakMap<object, number>();
let uidSeq = 0;
function uidOf(row: object): number {
	let id = rowUids.get(row);
	if (id === undefined) {
		id = ++uidSeq;
		rowUids.set(row, id);
	}
	return id;
}

// Expansion + drag state is view-only (never emitted). Expansion is keyed by row uid; drag tracks the
// dragged row's array position for the duration of the gesture.
const expanded = ref<Set<number>>(new Set());
const dragIndex = ref<number | null>(null);

function isExpanded(row: object): boolean {
	return expanded.value.has(uidOf(row));
}
function toggle(row: object): void {
	const id = uidOf(row);
	if (expanded.value.has(id)) expanded.value.delete(id);
	else expanded.value.add(id);
}

function summary(row: Record<string, unknown>, i: number): string {
	if (template.value) {
		const rendered = (tryRenderDisplay(template.value, row) ?? '').trim();
		if (rendered) return rendered;
	}
	const first = rowFields.value[0];
	if (first) {
		const v = row[first.field];
		if (v != null && v !== '') return typeof v === 'object' ? JSON.stringify(v) : String(v);
	}
	return `Item ${i + 1}`;
}

function commit(next: Record<string, unknown>[]): void {
	emit('update:value', next);
}

function addRow(): void {
	const row: Record<string, unknown> = {};
	commit([...rows.value, row]);
	expanded.value.add(uidOf(row));
}

function removeRow(i: number): void {
	const row = rows.value[i];
	const next = rows.value.slice();
	next.splice(i, 1);
	if (row) expanded.value.delete(uidOf(row));
	commit(next);
}

function updateRow(i: number, next: Record<string, unknown>): void {
	const prev = rows.value[i];
	// An edit yields a fresh object; carry the old row's uid onto it so its expansion state persists.
	if (prev) {
		const id = rowUids.get(prev);
		if (id !== undefined) rowUids.set(next, id);
	}
	const arr = rows.value.slice();
	arr[i] = next;
	commit(arr);
}

function onDragStart(i: number, event: DragEvent): void {
	dragIndex.value = i;
	if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}
function onDrop(i: number): void {
	const from = dragIndex.value;
	dragIndex.value = null;
	if (from == null || from === i) return;
	const arr = rows.value.slice();
	const [moved] = arr.splice(from, 1);
	arr.splice(i, 0, moved);
	commit(arr);
}
</script>

<template>
	<div class="dt-list-edit">
		<div
			v-for="(row, i) in rows"
			:key="uidOf(row)"
			class="dt-list-row"
			:class="{ 'is-dragging': dragIndex === i }"
			@dragover.prevent
			@drop="onDrop(i)"
		>
			<div class="dt-list-row__head">
				<span
					class="dt-list-row__handle codicon codicon-gripper"
					title="Drag to reorder"
					draggable="true"
					@dragstart="onDragStart(i, $event)"
					@dragend="dragIndex = null"
				></span
				>
				<button type="button" class="dt-list-row__summary" @click="toggle(row)">
					<DtIcon class="dt-list-row__chevron" :class="{ 'is-open': isExpanded(row) }" name="chevron-right" />
					<span class="dt-list-row__label">{{ summary(row, i) }}</span>
				</button>
				<button
					type="button"
					class="dt-btn dt-btn--ghost dt-btn--icon dt-btn--sm dt-list-row__remove"
					title="Remove"
					@click="removeRow(i)"
				>
					<DtIcon name="close" />
				</button>
			</div>
			<div v-if="isExpanded(row)" class="dt-list-row__body">
				<OptionsForm :fields="rowFields" :model-value="row" @update:model-value="updateRow(i, $event)" />
			</div>
		</div>

		<button type="button" class="dt-btn dt-btn--secondary dt-btn--sm dt-list-edit__add" @click="addRow">
			<DtIcon name="add" />
			Add item
		</button>
	</div>
</template>

<style scoped>
.dt-list-edit {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.dt-list-row {
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius);
	background: var(--dt-bg);
}
.dt-list-row.is-dragging {
	opacity: 0.5;
}
.dt-list-row__head {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 4px 8px 4px 4px;
}
.dt-list-row__handle {
	color: var(--dt-fg-muted);
	cursor: grab;
	font-size: var(--dt-icon);
	padding: 4px;
	user-select: none;
}
.dt-list-row__handle:active {
	cursor: grabbing;
}
.dt-list-row__summary {
	display: flex;
	align-items: center;
	gap: 4px;
	flex: 1 1 auto;
	min-width: 0;
	border: none;
	background: transparent;
	cursor: pointer;
	padding: 6px 0;
	font: inherit;
	font-size: var(--dt-text);
	color: var(--dt-fg);
	text-align: left;
}
.dt-list-row__chevron {
	font-size: var(--dt-icon);
	color: var(--dt-fg-subtle);
	transition: transform 0.12s ease;
}
.dt-list-row__chevron.is-open {
	transform: rotate(90deg);
}
.dt-list-row__label {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.dt-list-row__body {
	padding: 8px 12px 14px 36px;
	border-top: 1px solid var(--dt-border);
}
.dt-list-edit__add {
	align-self: flex-start;
}
</style>
