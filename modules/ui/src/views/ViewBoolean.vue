<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../api/types';
import DtIcon from '../components/DtIcon.vue';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
}>();

const icon = computed(() => (props.value ? 'check' : 'close'));
</script>

<template>
	<DtIcon class="dt-display-boolean" :class="{ 'dt-display-boolean--off': !value }" :name="icon" />
</template>

<style scoped>
.dt-display-boolean {
	font-size: var(--dt-icon);
	color: var(--dt-fg-subtle);
}
.dt-display-boolean--off {
	color: var(--dt-fg-muted);
}
</style>
