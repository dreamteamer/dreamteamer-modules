<!-- Universal read renderer (research items 3+4): resolves the field's View and hands it the
     field's `viewer_options`. A View that needs the enum reads the field's own choice rows. -->
<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../../api/types';
import { resolveView } from '../../registry/resolve';
import DtErrorBoundary from './DtErrorBoundary.vue';

/** `context` steers resolution: 'record' (detail page fields) may pick record-sized Views like
 * rendered markdown; 'cell' (default — table/card cells) never does. */
/** `record` is the row the value belongs to — handed only to a View that declares it (the stage checks
 *  place a review by the row's own fields); every other View gets nothing extra. */
const props = defineProps<{ field: FieldRow; value: unknown; context?: 'cell' | 'record'; record?: Record<string, unknown> | null }>();
const resolved = computed(() => resolveView(props.field, props.context ?? 'cell'));
const fallbackText = computed(() => (props.value == null ? '—' : String(props.value)));

/**
 * `context` is bound only when the resolved View declares it (batched-review smell: unconditional
 * binding fell through onto non-consuming Views' root elements as literal DOM attributes).
 * `<script setup>` type-only defineProps compiles to a runtime `props` option, so inspection is
 * reliable.
 */
const editContext = computed<Record<string, unknown>>(() => {
	const decl = (resolved.value.entry.component as { props?: unknown }).props;
	const has = (name: string) => (Array.isArray(decl) ? decl.includes(name) : decl != null && typeof decl === 'object' && name in decl);
	const extra: Record<string, unknown> = {};
	// Same declared-props gate for `context`: only Views that adapt to cell vs record sizing
	// (e.g. ViewText's truncation) declare it — everyone else must not get a stray DOM attribute.
	if (has('context')) extra['context'] = props.context ?? 'cell';
	// The ROW, to a View that declares it and only then — the `$source` View, for the stubs a row
	// shadows (cr-vscode-004), and the stage checks, which place a review by the row's own fields
	// (cr-rnd-003): a value is all most Views need, and an undeclared prop would fall through as a
	// DOM attribute, exactly the smell the `context` gate above exists for.
	if (has('record') && props.record) extra['record'] = props.record;
	return extra;
});
</script>

<template>
	<DtErrorBoundary :name="`view:${resolved.entry.id}:${field.field}`">
		<component
			:is="resolved.entry.component"
			:value="value"
			:field="field"
			:options="field.viewer_options"
			v-bind="editContext"
		/>
		<template #fallback><span class="dt-render-fallback">{{ fallbackText }}</span></template>
	</DtErrorBoundary>
</template>
