<!--
	Safe default Edit for wire-type `json` fields with no explicit Edit (the write-side twin of
	ViewJson, same defect family: the old kind default was `input`, whose `String(value)` renders
	"[object Object]" for any real object/array — collections.schema, ui-views.options/filter…).
	A monospace textarea holding pretty-printed JSON; emits ONLY when the text parses, so a
	half-typed edit can never corrupt the record. Invalid text stays local and flags the border.
	Registered as the kind default for `json` (registry/index.ts) — explicit Edits (tags, list,
	nested, relation specials) still win per resolveEdit's chain.
-->
<script setup lang="ts">
import { ref, watch } from 'vue';
import type { FieldRow } from '../api/types';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	autofocus?: boolean;
}>();

const emit = defineEmits<{ 'update:value': [value: unknown] }>();

const stringify = (v: unknown): string => (v == null ? '' : JSON.stringify(v, null, 2));

const text = ref(stringify(props.value));
const invalid = ref(false);

// External value changes (record load, revert) reset the buffer — but never while the operator is
// mid-edit on an invalid draft, which would eat their keystrokes.
watch(
	() => props.value,
	(v) => {
		if (!invalid.value && stringify(v) !== text.value) text.value = stringify(v);
	},
);

function onInput(event: Event): void {
	text.value = (event.target as HTMLTextAreaElement).value;
	if (text.value.trim() === '') {
		invalid.value = false;
		emit('update:value', null);
		return;
	}
	try {
		const parsed = JSON.parse(text.value);
		invalid.value = false;
		emit('update:value', parsed);
	} catch {
		invalid.value = true;
	}
}
</script>

<template>
	<textarea
		class="dt-code dt-json-edit"
		:class="{ 'is-invalid': invalid }"
		:value="text"
		:autofocus="autofocus"
		rows="8"
		spellcheck="false"
		@input="onInput"
	></textarea>
</template>

<style scoped>
.dt-json-edit {
	width: 100%;
	font-family: var(--dt-font-mono);
	font-size: var(--dt-text);
	resize: vertical;
}
.dt-json-edit.is-invalid {
	border-color: var(--dt-danger, #e35169);
	outline-color: var(--dt-danger, #e35169);
}
</style>
