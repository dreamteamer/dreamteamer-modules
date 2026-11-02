<!--
	Thumbnail display for a file-id field (C2 spec item 5). Only reachable via explicit
	`viewer: image` (resolve.ts's new explicit-display check) — never kind-inferred, since
	a file id is just a string indistinguishable from any other string field by type/special.

	`/assets/:pk` (server/src/rest/assets.ts) supports named transform presets; `system-small-cover`
	(64x64 cover-fit) is one of the always-allowed `SYSTEM_ASSET_ALLOW_LIST` entries, so no
	per-workspace settings config is required for this thumbnail to work anywhere.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { FieldRow } from '../api/types';
import { isSquarish } from '../lib/row-size';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
}>();

const fileId = computed(() => (typeof props.value === 'string' && props.value ? props.value : null));
const thumbSrc = computed(() => (fileId.value ? `/assets/${fileId.value}?key=system-small-cover` : null));

// Square-ish by the picture's own natural size, for the comfortable table's circle rule — the same
// decision ViewRelation makes for a file-codec reference (`lib/row-size.ts#isSquarish`).
const square = ref(false);
function onLoad(event: Event): void {
	const img = event.target as HTMLImageElement | null;
	if (img) square.value = isSquarish(img.naturalWidth, img.naturalHeight);
}
</script>

<template>
	<a v-if="fileId" :href="`/assets/${fileId}`" target="_blank" rel="noopener" class="dt-display-image-link">
		<img :src="thumbSrc ?? undefined" alt="" class="dt-display-image" :class="{ 'dt-display-image--square': square }" @load="onLoad" />
	</a>
	<span v-else class="dt-display-image-empty">—</span>
</template>

<style scoped>
.dt-display-image-link {
	display: inline-block;
	line-height: 0;
}
.dt-display-image {
	width: 32px;
	height: 32px;
	object-fit: cover;
	border-radius: 4px;
	border: 1px solid var(--dt-border);
}
.dt-display-image-empty {
	color: var(--dt-fg-subtle);
}
</style>
