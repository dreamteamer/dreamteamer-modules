<!--
	Human-readable byte size (phase E scope item 2) — thin UI shell over `lib/format-filesize.ts`'s
	pure formatter (unit-tested directly there). Opt-in only (`types: []`) — only meaningful for a
	byte-count field, only reachable via explicit `viewer: filesize`.
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../api/types';
import { formatFilesize } from '../lib/format-filesize';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
}>();

const text = computed(() => formatFilesize(props.value));
</script>

<template>
	<span class="dt-display-filesize">{{ text }}</span>
</template>

<style scoped>
.dt-display-filesize {
	color: var(--dt-fg);
	white-space: nowrap;
}
</style>
