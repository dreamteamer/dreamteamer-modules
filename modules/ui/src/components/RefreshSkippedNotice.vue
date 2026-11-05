<!--
	The line a record page draws when the refresh button did NOT reload it, because it holds unsaved
	edits (`useItem`'s `refreshSkipped`). A refresh that silently does nothing reads as a broken button;
	one that reloads anyway throws the operator's typing away. Its own component so the render tier can
	mount it — ContentDetail reaches `document` and cannot be mounted there.
-->
<script setup lang="ts">
defineProps<{ show: boolean }>();
</script>

<template>
	<p v-if="show" class="dt-refresh-skipped">Not reloaded — this record has unsaved changes. Save or discard them, then refresh.</p>
</template>

<style scoped>
.dt-refresh-skipped {
	margin: 0;
	padding: 4px 24px 8px;
	font-size: 12px;
	color: var(--dt-fg-muted);
}
</style>
