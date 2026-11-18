<script setup lang="ts">
import { themeColor } from '../../lib/collection-display';
/**
 * The band header a grouped layout draws: a glyph, the label, the count, and an optional
 * description — the whole visible payoff of a field's enum map (descriptor v2 §3.4.1), whose
 * decoration the engine projects onto the choice rows.
 *
 * ONE component for all three layouts. A table draws it inside a full-width cell, cards and the
 * kanban above their band; what a band IS differs per layout, what a band SAYS does not, and two
 * copies of this would be two answers to "what does a group look like".
 *
 * ⚠ `icon` is EITHER a codicon name OR a reference to a record of a `storage.format: binary`
 * collection, and the discriminator is `fileRecordRef` — the host-injected list of binary collections, never a
 * hard-coded name and never the slash on its own. `contacts/ada` has a slash and names no bytes, so
 * it falls through to the codicon branch rather than rendering a broken image.
 *
 * The file branch takes two steps because a reference names bytes but not their EXTENSION:
 * `pictures/icons/lucide/anchor` says nothing about `.svg` vs `.png`, so the record is fetched for
 * its derived `ext` before a src can exist. That fetch goes through the shared `record-cache`, so
 * six bands naming three distinct icons cost three requests, once, for the life of the webview.
 */
import { computed } from 'vue';
import { useFileSrc } from '../../lib/use-file-src';
import DtIcon from '../DtIcon.vue';

const props = defineProps<{
	label: string;
	count: number;
	description?: string;
	/** codicon name, or a reference into a `storage.format: binary` collection */
	icon?: string;
	/** VS Code theme colour ids — never hex, so the band survives both themes */
	color?: string;
	background?: string;
}>();

// The shared resolver (`lib/use-file-src.ts`) — this component had the only copy until `FileThumb`
// needed the same thing and grew a second. One answer to "where are this reference's bytes".
const { src } = useFileSrc(() => props.icon);

/** A theme colour id can only reach the DOM as a `var(--vscode-…)`: a class would need one rule per
 *  possible colour, which is the coupling an enum map's theme colour ids exist to avoid. Absent keys emit nothing at
 *  all rather than an empty declaration. */
const style = computed(() => {
	const out: Record<string, string> = {};
	if (props.color) out['--dt-group-color'] = themeColor(props.color);
	if (props.background) out['--dt-group-bg'] = themeColor(props.background);
	return out;
});
</script>

<template>
	<div class="dt-group-header" :class="{ 'has-color': !!color, 'has-bg': !!background }" :style="style">
		<img v-if="src" class="dt-group-header__img" :src="src" alt="" aria-hidden="true" />
		<DtIcon v-else-if="icon" :name="icon" />
		<span class="dt-group-header__label">{{ label }}</span>
		<span class="dt-group-header__count">{{ count }}</span>
		<span v-if="description" class="dt-group-header__desc">{{ description }}</span>
	</div>
</template>

<style scoped>
.dt-group-header {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 10px;
	font-weight: 600;
	border-left: 3px solid transparent;
}
/* Both are opt-in: a band whose enum value declares no colour draws no stripe. */
.dt-group-header.has-color {
	border-left-color: var(--dt-group-color);
	color: var(--dt-group-color);
}
/* The fill is deliberately faint — a saturated band behind text is unreadable in one of the two
   themes whichever colour is picked, and the accent bar already carries the identity. */
.dt-group-header.has-bg {
	background: color-mix(in srgb, var(--dt-group-bg) 12%, transparent);
}
.dt-group-header__img {
	width: 16px;
	height: 16px;
	object-fit: contain;
	flex: 0 0 auto;
}
.dt-group-header__count {
	font-weight: 400;
	color: var(--dt-fg-subtle);
	font-variant-numeric: tabular-nums;
}
/* Pushed away from the count so the two numbers never read as one string, and allowed to shrink —
   a long description must never push the count off a narrow band. */
.dt-group-header__desc {
	margin-left: 8px;
	font-weight: 400;
	font-size: var(--dt-label);
	color: var(--dt-fg-subtle);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
}
</style>
