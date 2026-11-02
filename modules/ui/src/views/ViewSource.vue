<!--
	The `$source` column's View (registered as `source`): the mark for a record read from a layer or a
	module-owned list, NOTHING for one from the workspace's own root — design rule 1, mark only the
	exception, so a mixed table's own rows stay plain. Which name is the workspace's own, which
	`repos` record a source links to and whether a write lands there (the glyph, cr-vscode-004) ride on
	the field row's `viewer_options` (`lib/sources.ts`
	`sourceFieldRow`), so this View needs no composable and renders the same in a cell, a card and
	the render tier.
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow, SourceEntry } from '../api/types';
import SourceMark from '../components/SourceMark.vue';
import StubNote from '../components/StubNote.vue';
import { stubNoteOf } from '../lib/sources';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	context?: 'cell' | 'record';
	/** The row — RenderView hands it to a View that declares it — for the stubs it shadows (line 9). */
	record?: Record<string, unknown>;
}>();

const name = computed(() => (typeof props.value === 'string' && props.value ? props.value : ''));
const own = computed(() => (typeof props.options?.['own'] === 'string' ? (props.options['own'] as string) : null));
const sources = computed(() => (Array.isArray(props.options?.['sources']) ? (props.options['sources'] as SourceEntry[]) : []));
const entry = computed(() => sources.value.find((s) => s.name === name.value));
const repoRecord = computed(() => entry.value?.record ?? null);
const foreign = computed(() => !!name.value && name.value !== own.value);
// a row that shadows a stub, or IS one, says so beside its mark — even an own row, which has no mark
const stub = computed(() => stubNoteOf(props.record));
</script>

<template>
	<span v-if="foreign || stub" class="dt-source-cell">
		<SourceMark v-if="foreign" :name="name" :record="repoRecord" :context="context ?? 'cell'" :access="entry?.access" :via="entry?.via" :note="entry?.note" />
		<StubNote v-if="stub" :stubs="stub.stubs" :self="stub.self" :winner="stub.winner" :sources="sources" />
	</span>
	<span v-else class="dt-source-own" aria-hidden="true"></span>
</template>

<style scoped>
.dt-source-cell {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
}
</style>
