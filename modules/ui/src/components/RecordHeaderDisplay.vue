<!--
	The record header's DISPLAY line — what the collection's `display.record` block asks a record page
	to say beneath its title (descriptor v2, §3.5):

	  subtitle   a display template, rendered with the one grammar; a reference in it reads as the
	             target's own `record_title`, so `{{ patient }} · {{ kind }}` says a name, not an id
	  badge      a field drawn as chips, each decorated by its enum choice (label · icon · colour)
	  color_by   the field whose choice colours tint the record — the same tint a row and a card carry

	Read off the display contract only: the collection row's `record` block and the field rows'
	`role` and `editor_options.choices`. Nothing is drawn that the collection did not ask for — a
	collection with no `display.record` keys renders nothing at all.

	Its own component, beside PageHeader rather than inside it, for the reason ReadonlyBanner was: a
	record page mounts reka-ui poppers that need a DOM, so only a component of its own is reachable by
	the webview render tier — and both record layouts (ItemProperties, ItemForm) sit under it, so one
	header serves both.
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { CollectionRow, FieldRow } from '../api/types';
import { useCollections } from '../composables/collections';
import { badgeChips, isReferenceField, themeColor, tintOf, tintStyle } from '../lib/collection-display';
import { referenceTitles } from '../lib/record-titles';
import { tryRenderDisplay } from '../lib/template';
import DtIcon from './DtIcon.vue';

const props = defineProps<{
	/** This collection's row of the display contract. */
	row: CollectionRow | null;
	/** This collection's field rows, as the contract emits them. */
	fields: readonly FieldRow[];
	record: Record<string, unknown> | null;
}>();

const { tree } = useCollections();
const resolve = referenceTitles(() => tree.value);
const isReference = (field: string) => isReferenceField(props.fields, field);

const subtitle = computed(() => {
	const tpl = props.row?.record.subtitle;
	if (!tpl || !props.record) return '';
	return (tryRenderDisplay(tpl, props.record, { resolve, isReference }) ?? '').replace(/\s+/g, ' ').trim();
});

const chips = computed(() => badgeChips(props.row, props.fields, props.record));

const tint = computed(() => tintStyle(tintOf(props.row?.record.color_by, props.fields, props.record)));

function chipStyle(chip: { color?: string; background?: string }): Record<string, string> | undefined {
	if (!chip.color && !chip.background) return undefined;
	const out: Record<string, string> = {};
	if (chip.color) out['--dt-chip-color'] = themeColor(chip.color);
	if (chip.background) out['--dt-chip-bg'] = themeColor(chip.background);
	return out;
}
</script>

<template>
	<div
		v-if="subtitle || chips.length || tint"
		class="dt-record-display"
		:class="{ 'dt-tinted': !!tint }"
		:style="tint"
	>
		<span v-if="subtitle" class="dt-record-subtitle" :title="subtitle">{{ subtitle }}</span>
		<span
			v-for="chip in chips"
			:key="chip.value"
			class="dt-record-badge"
			:class="{ 'has-color': !!chip.color, 'has-bg': !!chip.background }"
			:style="chipStyle(chip)"
		>
			<DtIcon v-if="chip.icon" :name="chip.icon" />
			<span class="dt-record-badge__label">{{ chip.label }}</span>
		</span>
	</div>
</template>

<style scoped>
.dt-record-display {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px;
	padding: 6px 24px;
	border-left: 3px solid transparent;
	font-size: var(--dt-text);
	color: var(--dt-fg-subtle);
}
.dt-record-display.dt-tinted {
	border-left-color: var(--dt-tint);
	background: color-mix(in srgb, var(--dt-tint-bg) 8%, transparent);
}
.dt-record-subtitle {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
}
.dt-record-badge {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	height: 20px;
	padding: 0 8px;
	border-radius: 999px;
	border: 1px solid var(--dt-border);
	font-size: var(--dt-label);
	white-space: nowrap;
	color: var(--dt-fg);
}
.dt-record-badge.has-color {
	border-color: color-mix(in srgb, var(--dt-chip-color) 45%, transparent);
	color: var(--dt-chip-color);
}
.dt-record-badge.has-bg {
	background: color-mix(in srgb, var(--dt-chip-bg) 15%, transparent);
}
</style>
