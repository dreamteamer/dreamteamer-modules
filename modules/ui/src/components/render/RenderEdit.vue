<!-- Universal editor renderer (research items 1+4): the mirror of RenderView for the write path.
     Resolves the field's Edit and wraps it in the same per-render error boundary — a throwing
     editor degrades to a read-only value display (with a note) instead of blanking the form.
     FormField keeps the label + the resolution-degraded badge (label-adjacent); this owns only
     the editor component and its render-time fault isolation. -->
<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../../api/types';
import { resolveEdit } from '../../registry/resolve';
import DtErrorBoundary from './DtErrorBoundary.vue';

const props = defineProps<{ field: FieldRow; value: unknown; targetCollection?: string }>();
const emit = defineEmits<{ 'update:value': [value: unknown] }>();

const resolved = computed(() => resolveEdit(props.field));
const fallbackText = computed(() => (props.value == null ? '—' : String(props.value)));
</script>

<template>
	<DtErrorBoundary :name="`edit:${resolved.entry.id}:${field.field}`">
		<component
			:is="resolved.entry.component"
			:value="value"
			:field="field"
			:options="field.editor_options"
			:target-collection="targetCollection"
			@update:value="emit('update:value', $event)"
		/>
		<template #fallback>
			<div class="dt-render-edit-fallback">
				<span class="dt-render-fallback">{{ fallbackText }}</span>
				<span class="dt-render-edit-fallback-note">editor failed — value shown read-only</span>
			</div>
		</template>
	</DtErrorBoundary>
</template>

<style scoped>
.dt-render-edit-fallback {
	display: flex;
	flex-direction: column;
	gap: 4px;
}
.dt-render-edit-fallback-note {
	display: inline-block;
	align-self: flex-start;
	background: color-mix(in srgb, var(--dt-danger) 12%, transparent);
	color: var(--dt-danger);
	border: 1px solid color-mix(in srgb, var(--dt-danger) 35%, transparent);
	border-radius: var(--dt-radius);
	padding: 2px 8px;
	font-size: var(--dt-text);
}
</style>
