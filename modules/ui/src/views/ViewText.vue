<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../api/types';
import { hostNotify } from '../api/transport';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	/** 'cell' (default) truncates to keep rows tight; 'record' (detail view mode) shows the
	 * full value, wrapping — a details sheet must never hide data behind an ellipsis. */
	context?: 'cell' | 'record';
}>();

const MAX_LENGTH = 80;

const full = computed(() => (props.value === null || props.value === undefined ? '' : String(props.value)));
const display = computed(() => {
	if (props.context === 'record') return full.value || '—';
	return full.value.length > MAX_LENGTH ? `${full.value.slice(0, MAX_LENGTH)}…` : full.value;
});

/**
 * A field whose WHOLE value is a URL or an email address becomes a real link on the record page —
 * `conferenceUrl`, `calendar`, `organizer` are strings in the schema, but nobody wants to select
 * and copy a Teams link to open it.
 *
 * Deliberately whole-value-only (anchored regexes, no scanning for links inside prose): a partial
 * match would have to re-render the text as fragments, and a false positive inside a sentence is
 * worse than a missed link. Cells stay inert for the same reason ViewRelation's do — a link nested
 * in a clickable row hijacks the row's own gesture.
 */
const href = computed<string | null>(() => {
	if (props.context !== 'record') return null;
	const value = full.value.trim();
	if (/^https?:\/\/\S+$/i.test(value)) return value;
	if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
	return null;
});

/**
 * A workspace-relative .html value — an `artifacts` record's `local` page — opens in the
 * operator's browser via the host (`dt:open-file`), because a webview can neither iframe a
 * workspace file (CSP) nor link to file:. Whole-value-only and shape-gated for the same reason
 * `href` is; the HOST re-validates (inside the root, exists) before opening anything.
 */
const localPage = computed<string | null>(() => {
	if (props.context !== 'record') return null;
	const value = full.value.trim();
	return /^(?!\/)(?!.*(?:^|[\/\\])\.\.(?:[\/\\]|$))[\w.\/-]+\.html?$/i.test(value) ? value : null;
});
function openLocal(): void {
	if (localPage.value) hostNotify('dt:open-file', { path: localPage.value });
}
</script>

<template>
	<!-- Deliberately NOT also `.dt-display-text`: a scoped class compiles to `.x[data-v-…]`, which
	     outranks the unscoped `.dt-link` and would silently repaint the link in body-text colour. -->
	<!-- `dir="auto"` on the value itself: the webview is dir=ltr, so a Hebrew string rendered
	     without it takes an LTR base and every neutral character in it — the sentence period, a
	     comma, parentheses, the truncation ellipsis — resolves against the wrong direction and
	     lands at the wrong end of the line. Per VALUE, never on a container: a container-level
	     auto reads the first strong character of the whole page and imposes it on every field.
	     (Same measurement as render-md.ts's per-block DIR, 2026-08-09.) -->
	<a v-if="href" class="dt-display-link dt-link" :href="href" dir="auto" rel="noreferrer">{{ display }}</a>
	<a v-else-if="localPage" class="dt-display-link dt-link" href="#" dir="auto" title="Open in browser" @click.prevent="openLocal">{{ display }}</a>
	<span
		v-else
		class="dt-display-text"
		:class="{ 'dt-display-text--record': context === 'record' }"
		:title="context === 'record' ? undefined : full"
		dir="auto"
		>{{ display }}</span
	>
</template>

<style scoped>
.dt-display-text {
	color: var(--dt-fg);
	white-space: nowrap;
}
.dt-display-text--record {
	white-space: pre-wrap;
}
.dt-display-link {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
</style>
