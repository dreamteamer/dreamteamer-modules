<!--
	ONE NOTE'S SENTENCE (cr-vscode-005), verbatim, with each reference the host marked as held here drawn
	as a link to that record — core's `(sessions/<id>)` opens the session. A reference to a record this
	workspace does not hold stays text (`lib/next-notes.ts textParts`). An extension's failure line reads
	`<by>: <text>`, as `dt next` prints it. Drawn by the record page (`NextNotes`).
-->
<script setup lang="ts">
import { computed } from 'vue';
import { textParts, type NextNote } from '../lib/next-notes';
import DtLink from './DtLink.vue';

const props = defineProps<{ note: NextNote }>();
const parts = computed(() => (props.note.error ? [{ text: `${props.note.by}: ${props.note.text}` }] : textParts(props.note)));
</script>

<template>
	<span class="dt-next-notes__text"><template v-for="(p, i) in parts" :key="i"><DtLink v-if="p.ref" :to="`/content/${p.ref}`">{{ p.text }}</DtLink><template v-else>{{ p.text }}</template></template></span>
</template>
