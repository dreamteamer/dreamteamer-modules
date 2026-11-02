<!--
	THE NOTE MARK (cr-vscode-005, acceptance 1) — one glyph on a record's row when an extension says
	something about it: core's "in session by <worker> since <t> (sessions/<id>)" for a record a running
	session holds. Its tooltip is the sentence, verbatim, one per line (`lib/next-notes.ts markTitle`).
	One glyph whatever the words say (design D3): held, lapsed and stage-done are told apart by the
	sentence the person reads, never by parsing it here. Drawn where a row's other per-record marks are:
	the table's first cell, a card's and a kanban card's footer row.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { markTitle, type NextNote } from '../lib/next-notes';
import DtIcon from './DtIcon.vue';

const props = defineProps<{ notes: readonly NextNote[] }>();
const title = computed(() => markTitle(props.notes));
</script>

<template>
	<span class="dt-note-mark" :title="title" role="img" aria-label="note from an extension" data-next-notes>
		<DtIcon name="broadcast" />
	</span>
</template>

<style scoped>
.dt-note-mark {
	flex-shrink: 0;
	display: inline-flex;
	align-items: center;
	color: var(--vscode-charts-blue, var(--dt-color-charts-blue, var(--dt-unknown-color)));
}
.dt-note-mark :deep(.codicon) {
	font-size: 12px;
}
</style>
