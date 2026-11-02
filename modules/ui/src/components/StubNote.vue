<!--
	STUBS, IN THE SOURCE VOCABULARY (cr-vscode-004, line 9; operator decision 6a). Drawn beside a record's
	source mark — the list cell, a card's footer row, the record page's source line:

	  ● my-hq  [● project-a ✎ stub · yields to my-hq]     the shown record shadows a stub in project-a
	  ● my-hq  [stub · yields to any non-stub of its id]   the shown record IS a stub (no non-stub here)
	  ● my-hq  [stub · yields to …] [● project-b also a stub]   …and other roots hold stubs it shadows

	The stub's root is named with the SAME mark every surface uses (its dot, its writability glyph), so
	a stub reads as one more fact about where copies of the record live. `lib/sources.ts` stubNoteOf
	reads the row; the engine's `stub` field itself stays an ordinary checkbox on the form.
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { SourceEntry } from '../api/types';
import { ALSO_STUB_WORDS, SELF_STUB_WORDS, sourceEntry, yieldsWords } from '../lib/sources';
import SourceMark from './SourceMark.vue';

const props = defineProps<{
	/** Roots holding the stubs the shown record shadows. */
	stubs: string[];
	/** The shown record is itself a stub. */
	self?: boolean;
	/** The shown record's own root — what the stubs yield to. */
	winner: string | null;
	/** The collection's sources, for each stub root's glyph. */
	sources?: readonly SourceEntry[];
}>();

const rows = computed(() => props.stubs.map((name) => ({ name, entry: sourceEntry(props.sources, name) })));
</script>

<template>
	<span class="dt-stub-note" data-stub-note>
		<span v-if="self" class="dt-stub-note__item dt-stub-note__words" data-stub-self title="This record is a stub (stub: true): any non-stub of its id, in any root, is read instead — none is read here">{{ SELF_STUB_WORDS }}</span>
		<span
			v-for="r in rows"
			:key="r.name"
			class="dt-stub-note__item"
			:data-stub-root="r.name"
			:title="self ? `${r.name} also holds a stub of this id — this one, read first, shadows it` : `${r.name} holds a stub of this record (stub: true) — it yields to ${winner ?? 'the copy shown'}`"
		>
			<SourceMark :name="r.name" :access="r.entry?.access" :via="r.entry?.via" />
			<span class="dt-stub-note__words">{{ self ? ALSO_STUB_WORDS : yieldsWords(winner) }}</span>
		</span>
	</span>
</template>

<style scoped>
.dt-stub-note {
	display: inline-flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	min-width: 0;
}
/* A pill per stub root. Its pieces WRAP inside it rather than shrink: a long root name and the words
   beside it drew over each other in a 240 px card (measured in the dev host, cr-vscode-004 walk). */
.dt-stub-note__item {
	max-width: 100%;
	display: inline-flex;
	flex-wrap: wrap;
	align-items: center;
	column-gap: 4px;
	padding: 0 6px;
	border: 1px dashed var(--dt-border);
	border-radius: 10px;
}
.dt-stub-note__item > * {
	flex-shrink: 0;
	max-width: 100%;
}
.dt-stub-note__words {
	color: var(--dt-fg-muted);
	font-size: var(--dt-label);
}
</style>
