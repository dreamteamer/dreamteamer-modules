<!--
	Monospace textarea for yaml/json-shaped string fields (phase E scope item 1), with a simple
	tab-capture: Tab inserts a literal tab character at the caret instead of moving focus out of the
	field (the normal textarea behavior, which makes editing structured text painful). Opt-in only
	(`types: []`) — plain `text`/`json` fields already default to `textarea`/`input`; this is a
	deliberate upgrade for fields the descriptor explicitly marks `interface: 'code'`.
-->
<script setup lang="ts">
import type { FieldRow } from '../api/types';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	autofocus?: boolean;
}>();

const emit = defineEmits<{ 'update:value': [value: unknown] }>();

function onInput(event: Event): void {
	emit('update:value', (event.target as HTMLTextAreaElement).value);
}

/** Tab inserts `\t` at the caret and restores caret position after Vue re-renders the (now
 * controlled) value, rather than tabbing focus away — see the header comment. */
function onKeydown(event: KeyboardEvent): void {
	if (event.key !== 'Tab') return;
	event.preventDefault();

	const el = event.target as HTMLTextAreaElement;
	const start = el.selectionStart ?? el.value.length;
	const end = el.selectionEnd ?? el.value.length;
	const next = `${el.value.slice(0, start)}\t${el.value.slice(end)}`;
	emit('update:value', next);

	requestAnimationFrame(() => {
		el.selectionStart = el.selectionEnd = start + 1;
	});
}
</script>

<template>
	<textarea
		class="dt-code"
		:value="value == null ? '' : String(value)"
		:autofocus="autofocus"
		rows="10"
		spellcheck="false"
		@input="onInput"
		@keydown="onKeydown"
	></textarea>
</template>

<style scoped>
.dt-code {
	width: 100%;
	min-height: 200px;
	padding: 14px;
	border: 1px solid var(--dt-border-strong);
	border-radius: var(--dt-radius);
	font-family: var(--dt-font-mono);
	font-size: 12.5px;
	line-height: 1.6;
	color: var(--dt-fg);
	background: var(--dt-bg-subtle);
	resize: vertical;
	tab-size: 2;
	transition:
		background-color 0.12s ease,
		border-color 0.12s ease;
}
.dt-code:focus {
	outline: none;
	background: var(--dt-bg);
	border-color: var(--dt-accent);
}
</style>
