<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../api/types';
import { normalizeChoices } from '../lib/choices';
import { choicesOf } from '../lib/field-row';
import DtSelect from '../components/DtSelect.vue';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	autofocus?: boolean;
}>();

const emit = defineEmits<{ 'update:value': [value: unknown] }>();

// The enum's choice rows, as the display contract carries them on `editor_options.choices`.
const choices = computed(() => normalizeChoices(choicesOf(props.field)));
</script>

<template>
	<!-- The searchable dropdown, not a native <select>. This is the control every enum and every
	     derived vocabulary lands on — including an analyte enum of ~100 values, which as a native
	     select was a scrolling wall with no way to type at it. -->
	<DtSelect
		:model-value="value"
		:choices="choices"
		:autofocus="autofocus"
		:aria-label="field.title || field.field"
		@update:model-value="emit('update:value', $event)"
	/>
</template>
