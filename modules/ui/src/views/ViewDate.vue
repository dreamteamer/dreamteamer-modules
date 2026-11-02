<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../api/types';
import { relativeTime } from '../lib/relative-time';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
}>();

const text = computed(() => {
	if (typeof props.value !== 'string' || !props.value) return '—';
	const raw = props.value;
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return raw;
	if (props.options?.['relative']) return relativeTime(date);
	// Date-only fields (`type: date`) must not show a spurious time or shift a day across
	// timezones — format the calendar date in UTC. Timestamps keep a compact local date+time.
	if (props.field?.type === 'date') {
		return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
	}
	return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
});
</script>

<template>
	<span class="dt-display-date">{{ text }}</span>
</template>

<style scoped>
.dt-display-date {
	color: var(--dt-fg);
	white-space: nowrap;
}
</style>
