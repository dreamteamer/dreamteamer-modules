<!--
	Chip-list input for a `many` field of scalars (phase E scope item 1). The display contract says
	`many: true` outright, so resolve.ts reaches it by that SHAPE; registered with `types: []` so no
	single-valued type ever defaults to it.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { FieldRow } from '../api/types';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	autofocus?: boolean;
}>();

const emit = defineEmits<{ 'update:value': [value: unknown] }>();

// Objects stringify as JSON, never String() — "[object Object]" chips helped nobody.
const tags = computed<string[]>(() =>
	Array.isArray(props.value)
		? props.value.map((v) => (v != null && typeof v === 'object' ? JSON.stringify(v) : String(v)))
		: [],
);
const draft = ref('');

/** Enter/comma commits the draft as a new tag; a trailing comma is stripped, not kept as text. */
function commitDraft(): void {
	const raw = draft.value.replace(/,$/, '').trim();
	draft.value = '';
	if (!raw || tags.value.includes(raw)) return;
	emit('update:value', [...tags.value, raw]);
}

function onKeydown(event: KeyboardEvent): void {
	if (event.key === 'Enter' || event.key === ',') {
		event.preventDefault();
		commitDraft();
	} else if (event.key === 'Backspace' && draft.value === '' && tags.value.length > 0) {
		emit('update:value', tags.value.slice(0, -1));
	}
}

function removeTag(index: number): void {
	emit(
		'update:value',
		tags.value.filter((_, i) => i !== index),
	);
}
</script>

<template>
	<div class="dt-tags">
		<span v-for="(tag, i) in tags" :key="`${tag}-${i}`" class="dt-chip">
			{{ tag }}
			<button type="button" class="dt-chip__remove" aria-label="Remove tag" @click="removeTag(i)">×</button>
		</span>
		<input
			dir="auto"
			v-model="draft"
			class="dt-tags-input"
			type="text"
			placeholder="Add tag…"
			:autofocus="autofocus"
			@keydown="onKeydown"
			@blur="commitDraft"
		/>
	</div>
</template>

<style scoped>
.dt-tags {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px;
	min-height: var(--dt-input-height);
	padding: 6px 10px;
	border: 1px solid var(--dt-border-strong);
	border-radius: var(--dt-radius);
	background: var(--dt-bg-subtle);
	transition:
		background-color 0.12s ease,
		border-color 0.12s ease;
}
.dt-tags:focus-within {
	background: var(--dt-bg);
	border-color: var(--dt-accent);
}
.dt-tags-input {
	flex: 1 1 80px;
	min-width: 80px;
	border: none;
	outline: none;
	background: transparent;
	font: inherit;
	font-size: var(--dt-text);
	color: var(--dt-fg);
	padding: 4px;
}
</style>
