<!--
	A `dot` node. Two flavours, and the difference is the point:

	- LOADED — a node the provider had the whole of. Titled, openable.
	- GHOST — a node known only from a reference value (`<collection>/<id>`), so its existence and
	  its collection are known without it having been fetched. Outlined rather than filled, to say
	  "known of, not loaded".

	Size grows with degree, which is what makes the hubs in a vault legible at a glance.

	⚠ The label is ABSOLUTELY positioned, and that is load-bearing, not styling. Vue Flow anchors
	edges on handles placed at the node element's own edges (`.vue-flow__handle-right { right: 0 }`)
	and measures node size from that element's box. While the label was a flex sibling of the dot,
	turning it on grew the node box by the width of the text — so at the zoom where names arrive,
	every outgoing edge jumped from the dot to the far end of its label and the minimap's dots
	stretched into dashes (operator 2026-08-11: "lines switch to the label — is disorienting").
	Out of flow, the node box is the dot at every zoom, so labels appearing move nothing.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { Handle, Position } from '@vue-flow/core';

const props = defineProps<{
	data: {
		label: string;
		group: string;
		ghost: boolean;
		accent: string;
		size: number;
		dimmed: boolean;
		/** False when zoomed out — the dots carry the shape, the names would be noise. */
		showLabel: boolean;
	};
}>();

const dot = computed(() => `${props.data.size}px`);
</script>

<template>
	<div
		class="dt-gnode"
		:class="{ '--dimmed': data.dimmed, '--ref': data.ghost }"
		:style="{ width: dot, height: dot }"
		:title="`${data.group}/${data.label}`"
	>
		<Handle type="target" :position="Position.Left" class="dt-gnode__handle" />
		<span
			class="dt-gnode__dot"
			:style="{
				background: data.ghost ? 'transparent' : data.accent,
				borderColor: data.accent,
			}"
		/>
		<span v-if="data.showLabel" class="dt-gnode__label">{{ data.label }}</span>
		<Handle type="source" :position="Position.Right" class="dt-gnode__handle" />
	</div>
</template>

<style scoped>
/* The box IS the dot — see the note at the top of this file. Its size comes from the inline style,
   so the node measures the same whether or not a label is showing. */
.dt-gnode {
	position: relative;
	font-family: var(--dt-font);
	transition: opacity 120ms ease;
	cursor: pointer;
}
.dt-gnode.--dimmed {
	opacity: 0.2;
}
.dt-gnode__dot {
	display: block;
	width: 100%;
	height: 100%;
	border-radius: 50%;
	border: 2px solid;
	box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
}
.dt-gnode__label {
	position: absolute;
	/* Beside the dot, vertically on its centre — the same place the flex row put it, minus the
	   contribution to the node's box. */
	left: calc(100% + 6px);
	top: 50%;
	transform: translateY(-50%);
	font-size: 10.5px;
	line-height: 1.3;
	color: var(--dt-fg);
	white-space: nowrap;
	max-width: 150px;
	overflow: hidden;
	text-overflow: ellipsis;
	/* The label sits ON the canvas, not in a box — it needs to stay readable over the dot grid. */
	text-shadow:
		0 0 3px var(--dt-bg),
		0 0 3px var(--dt-bg);
}
.dt-gnode.--ref .dt-gnode__label {
	color: var(--dt-fg-muted);
}
.dt-gnode__handle {
	opacity: 0;
	width: 1px;
	height: 1px;
	min-width: 0;
	min-height: 0;
	border: 0;
	pointer-events: none;
}
</style>
