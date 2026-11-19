<!--
	Structured single-object Edit: renders a declared sub-field set (options.fields, the same
	sub-field rows EditList rows use) over ONE object value via OptionsForm — so a
	descriptor's `type: object` field with declared properties (ui-views.nav, collections.storage,
	a workflow step's operator) edits as a real sub-form instead of a JSON blob. Registered
	`id: 'nested'`, types: [] — opt-in via the adapter, which derives options.fields from the
	JSON-Schema `properties`. Recursion is free: a sub-field may itself be `edit: 'nested'`/'list'.
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../api/types';
import OptionsForm from '../components/render/OptionsForm.vue';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	autofocus?: boolean;
}>();

const emit = defineEmits<{ 'update:value': [value: unknown] }>();

const model = computed<Record<string, unknown>>(() =>
	props.value != null && typeof props.value === 'object' && !Array.isArray(props.value)
		? (props.value as Record<string, unknown>)
		: {},
);

const fields = computed<FieldRow[]>(() => {
	const declared = props.options?.['fields'];
	return Array.isArray(declared) ? (declared as FieldRow[]) : [];
});
</script>

<template>
	<div class="dt-nested-edit">
		<OptionsForm :fields="fields" :model-value="model" @update:model-value="emit('update:value', $event)" />
	</div>
</template>

<style scoped>
.dt-nested-edit {
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius);
	padding: 10px 12px;
	background: var(--dt-bg);
}
</style>
