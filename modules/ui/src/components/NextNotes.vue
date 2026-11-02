<!--
	WHAT EXTENSIONS SAY ABOUT THIS RECORD (cr-vscode-005, acceptance 2) — under the record page's header,
	one line per note `GET /notes/<collection>?ids=<id>` answers: the glyph, the sentence (`NoteText`,
	references linked) and the extension's name in the description colour. Core's lines are a session
	holding the record: "in session by …", "was in session … the claim has lapsed", "… stage done …"; an
	ended session yields none. The words are the extension's and are not read here. No note, nothing drawn.
-->
<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '../api/client';
import type { NextNote } from '../lib/next-notes';
import DtIcon from './DtIcon.vue';
import NoteText from './NoteText.vue';

const props = defineProps<{ collection: string; id: string }>();
const notes = ref<NextNote[]>([]);

let seq = 0;
async function load(): Promise<void> {
	const mine = ++seq;
	try {
		const { data } = await api.get<{ notes: NextNote[] }>(`/notes/${encodeURIComponent(props.collection)}?ids=${encodeURIComponent(props.id)}`);
		if (mine === seq) notes.value = Array.isArray(data?.notes) ? data.notes : [];
	} catch {
		// a note is context, never the page: a failed read draws nothing rather than an error band
		if (mine === seq) notes.value = [];
	}
}
watch(() => [props.collection, props.id], load, { immediate: true });
</script>

<template>
	<div v-if="notes.length" class="dt-next-notes" aria-label="Notes from extensions">
		<p v-for="(n, i) in notes" :key="i" class="dt-next-notes__line" :class="{ 'dt-next-notes__line--error': n.error }">
			<DtIcon class="dt-next-notes__icon" :name="n.error ? 'warning' : 'broadcast'" />
			<NoteText :note="n" />
			<span v-if="!n.error" class="dt-next-notes__by">{{ n.by }}</span>
		</p>
	</div>
</template>

<style scoped>
.dt-next-notes {
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: 4px 24px 6px;
	font-size: 12px;
}
.dt-next-notes__line {
	display: flex;
	align-items: baseline;
	gap: 6px;
	margin: 0;
	min-width: 0;
}
.dt-next-notes__icon {
	flex-shrink: 0;
	color: var(--vscode-charts-blue, var(--dt-color-charts-blue, var(--dt-unknown-color)));
}
.dt-next-notes__line--error .dt-next-notes__icon {
	color: var(--vscode-editorWarning-foreground, var(--dt-warning));
}
.dt-next-notes__by {
	flex-shrink: 0;
	color: var(--vscode-descriptionForeground, var(--dt-fg-subtle));
}
</style>
