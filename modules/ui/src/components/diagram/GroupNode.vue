<!--
	The container behind a group — the coloured regions that make a diagram readable at a glance.
	Purely decorative: it is a Vue Flow node with `selectable: false` and `zIndex: 0` so it paints
	behind its members and never intercepts a click meant for one.

	Its box comes from `lib/diagram/layout.ts`, which solves each group separately and takes the
	bounding box of the members it actually placed.
-->
<script setup lang="ts">
import DtIcon from '../DtIcon.vue';
const props = defineProps<{ id: string; data: { label: string; accent: string; zoom: number } }>();
const emit = defineEmits<{ (e: 'resize', id: string, size: { w: number; h: number }): void }>();

/**
 * Hand-rolled rather than `@vue-flow/node-resizer`: one corner, ~20 lines, and no new dependency in
 * an extension that ships four Vue Flow packages already.
 *
 * ⚠ Pointer deltas are in SCREEN pixels and the box is in GRAPH coordinates, so every delta is
 * divided by the current zoom — without it a drag at 0.2 resizes five times too fast.
 */
function onGrab(event: PointerEvent): void {
	event.stopPropagation(); // never let the container's own drag start from the handle
	event.preventDefault();
	const el = (event.target as HTMLElement).closest('.dt-diagram-group') as HTMLElement | null;
	if (!el) return;
	const startX = event.clientX;
	const startY = event.clientY;
	const zoom = props.data.zoom || 1;
	const w0 = el.offsetWidth;
	const h0 = el.offsetHeight;

	const move = (e: PointerEvent) => {
		const w = Math.max(120, w0 + (e.clientX - startX) / zoom);
		const h = Math.max(80, h0 + (e.clientY - startY) / zoom);
		emit('resize', props.id, { w: Math.round(w), h: Math.round(h) });
	};
	const up = () => {
		window.removeEventListener('pointermove', move);
		window.removeEventListener('pointerup', up);
	};
	window.addEventListener('pointermove', move);
	window.addEventListener('pointerup', up);
}
</script>

<template>
	<div class="dt-diagram-group" :style="{ '--group-accent': data.accent } as Record<string, string>">
		<DtIcon class="dt-diagram-group__grip" name="gripper" />
		<span class="dt-diagram-group__label">{{ data.label }}</span>
		<span class="dt-diagram-group__resize" title="Resize" @pointerdown="onGrab" />
	</div>
</template>

<style scoped>
.dt-diagram-group {
	position: relative;
	width: 100%;
	height: 100%;
	box-sizing: border-box;
	border: 1.5px solid var(--group-accent);
	border-radius: 12px;
	/* The tint has to read on both themes, so it is the accent at low alpha over the page rather
	   than a fixed pastel — `color-mix` keeps one declaration doing both. */
	background: color-mix(in srgb, var(--group-accent) 7%, transparent);
	padding: 8px 12px;
	display: flex;
	align-items: flex-start;
	gap: 4px;
	/* Draggable, so it must receive the pointer. It sits at zIndex 0 behind its members, so a click
	   on a table still reaches the table — only the space BETWEEN members grabs the container. */
	cursor: grab;
}
.dt-diagram-group:active {
	cursor: grabbing;
}
.dt-diagram-group__grip {
	font-size: 14px;
	color: var(--group-accent);
	opacity: 0.7;
	margin-top: -1px;
}
.dt-diagram-group__resize {
	position: absolute;
	right: 2px;
	bottom: 2px;
	width: 14px;
	height: 14px;
	cursor: nwse-resize;
	border-right: 2px solid var(--group-accent);
	border-bottom: 2px solid var(--group-accent);
	border-bottom-right-radius: 10px;
	opacity: 0.6;
}
.dt-diagram-group__label {
	font-family: var(--dt-font);
	font-size: 12px;
	font-weight: 600;
	color: var(--group-accent);
	letter-spacing: 0.01em;
}
</style>
