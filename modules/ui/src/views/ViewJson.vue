<!--
	Display for `object` and `map` fields (polish wave defect 2): DataTable used to render these via
	the ultimate 'text' fallback, which is just `String(value)` — for an object that's the
	infamous "[object Object]". The type's default View (registry/index.ts `kindDefaultViews`) —
	safe because this component branches on the VALUE's actual shape rather than assuming one —
	arrays get "N items" regardless
	of whether they're a tag-list or a list of objects, and any non-array object gets a compact `{…}`
	chip with a `title` tooltip preview. An authored `viewer` (e.g. `tags`) still wins per
	resolveView's chain, so this only ever fires as the un-opted-in default.
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../api/types';

// `context` is bound by RenderView only because it's declared here: cells keep the compact
// count/{…} chips, record pages get the full pretty-printed value (a collections.schema field
// hiding behind a {…} chip on its own detail page "makes sense" to nobody).
const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	context?: 'cell' | 'record';
}>();

const PREVIEW_LENGTH = 120;

const pretty = computed(() => {
	try {
		return JSON.stringify(props.value, null, 2);
	} catch {
		return String(props.value);
	}
});

const kind = computed<'empty' | 'array' | 'object'>(() => {
	const value = props.value;
	if (value === null || value === undefined) return 'empty';
	if (Array.isArray(value)) return 'array';
	if (typeof value === 'object') return 'object';
	return 'empty';
});

const itemCount = computed(() => (Array.isArray(props.value) ? props.value.length : 0));

const preview = computed(() => {
	if (kind.value !== 'object') return '';
	try {
		const json = JSON.stringify(props.value);
		return json.length > PREVIEW_LENGTH ? `${json.slice(0, PREVIEW_LENGTH)}…` : json;
	} catch {
		return String(props.value);
	}
});
</script>

<template>
	<span v-if="kind === 'empty'" class="dt-display-json-empty">—</span>
	<pre v-else-if="context === 'record'" class="dt-display-json-pre">{{ pretty }}</pre>
	<span v-else-if="kind === 'array'" class="dt-display-json-count">{{ itemCount }} item{{ itemCount === 1 ? '' : 's' }}</span>
	<span v-else class="dt-chip dt-chip--sm dt-display-json-chip" :title="preview">{…}</span>
</template>

<style scoped>
.dt-display-json-pre {
	margin: 0;
	padding: 10px 12px;
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius);
	background: var(--dt-bg);
	font-family: var(--dt-font-mono);
	font-size: 12.5px;
	line-height: 1.5;
	max-height: 420px;
	overflow: auto;
	white-space: pre-wrap;
	word-break: break-word;
}
.dt-display-json-empty {
	color: var(--dt-fg-subtle);
}
.dt-display-json-count {
	color: var(--dt-fg);
	font-size: var(--dt-text);
}
.dt-display-json-chip {
	font-family: var(--dt-font-mono);
	cursor: default;
}
</style>
