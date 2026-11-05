<!--
	AN INSTANT HOVER CARD (cr-vscode-013). The browser's native `title` tooltip shows after the
	browser's own delay, which a page cannot shorten — the operator: "tooltip loads very slow, should
	be immediate when mouse over". This draws the explanation itself, the moment the pointer enters:
	`open` is set synchronously in `mouseenter` — no timer, no transition — so the card is laid out in
	the next frame. A trigger wrapped here must carry NO `title` of its own, or the slow native copy
	would follow the instant one.

	The caller's element IS the trigger (`tag`, its classes and attributes fall through), so wrapping a
	cell changes none of its geometry. The card renders inside it, `position: fixed`, placed by
	`lib/hover-place.ts` against the trigger's rect: first at a provisional size, then — in a post-flush
	watcher, which runs after the DOM update and before the browser paints, so it costs no frame and no
	timer — re-placed at its MEASURED size, so a wrapped line can never push it off the bottom edge.
	Mouse only: `pointer-events: none`, so it never takes the pointer from the row beneath it.
-->
<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import { hoverPlace } from '../lib/hover-place';

export interface HoverLine {
	text: string;
	kind?: 'title' | 'body' | 'code';
}

const props = withDefaults(defineProps<{ lines: HoverLine[]; tag?: string }>(), { tag: 'span' });

const id = `dt-hover-${useId()}`;

const shown = computed(() => props.lines.filter((l) => l.text.trim() !== ''));
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const card = ref<HTMLElement | null>(null);
const at = ref({ top: 0, left: 0 });

/** The provisional size the first placement uses, before the card is measured. */
const PROVISIONAL = { width: 360, height: 120 };

function place(size: { width: number; height: number }): void {
	const w = (globalThis as { window?: { innerWidth?: unknown; innerHeight?: unknown } }).window;
	const el = root.value as (HTMLElement & { getBoundingClientRect?: () => DOMRect }) | null;
	if (!el?.getBoundingClientRect || typeof w?.innerWidth !== 'number' || typeof w.innerHeight !== 'number') {
		at.value = { top: 0, left: 0 };
		return;
	}
	const { top, left } = hoverPlace(el.getBoundingClientRect(), size, { width: w.innerWidth, height: w.innerHeight });
	at.value = { top, left };
}

function show(): void {
	if (!shown.value.length) return;
	place(PROVISIONAL);
	open.value = true;
}

function hide(): void {
	open.value = false;
}

// Measured, not estimated: after the card is in the DOM (flush 'post'), before paint.
watch(
	open,
	(isOpen) => {
		if (!isOpen) return;
		const el = card.value;
		if (el && typeof el.offsetWidth === 'number' && el.offsetWidth > 0) place({ width: el.offsetWidth, height: el.offsetHeight });
	},
	{ flush: 'post' },
);

// a lines change while open (the count arriving) re-measures too
watch(shown, () => {
	if (open.value) void nextTick(() => card.value && card.value.offsetWidth > 0 && place({ width: card.value.offsetWidth, height: card.value.offsetHeight }));
});
</script>

<template>
	<component :is="tag" ref="root" :aria-describedby="open ? id : undefined" @mouseenter="show" @mouseleave="hide">
		<slot />
		<div v-if="open" :id="id" ref="card" role="tooltip" class="dt-hover-card" :style="{ top: `${at.top}px`, left: `${at.left}px` }">
			<div v-for="(line, i) in shown" :key="i" class="dt-hover-card__line" :class="`dt-hover-card__line--${line.kind ?? 'body'}`">{{ line.text }}</div>
		</div>
	</component>
</template>

<style scoped>
.dt-hover-card {
	position: fixed;
	z-index: 50;
	max-width: 360px;
	padding: 6px 9px;
	border: 1px solid var(--vscode-editorHoverWidget-border, var(--dt-border));
	border-radius: var(--dt-radius);
	background: var(--vscode-editorHoverWidget-background, var(--dt-bg));
	color: var(--vscode-editorHoverWidget-foreground, var(--dt-fg));
	box-shadow: var(--dt-shadow-lg);
	font-size: var(--dt-label);
	font-weight: normal;
	line-height: 1.45;
	text-align: start;
	text-transform: none;
	letter-spacing: normal;
	white-space: normal;
	overflow-wrap: anywhere;
	pointer-events: none;
	cursor: default;
}

/* base.css paints every descendant of a computed value `--dt-fg-subtle !important`; a card opened from a
   generated row's empty cell must read the same as one opened from the field's name. */
.dt-computed .dt-hover-card,
.dt-computed .dt-hover-card * {
	color: var(--vscode-editorHoverWidget-foreground, var(--dt-fg)) !important;
}

.dt-hover-card__line + .dt-hover-card__line {
	margin-top: 3px;
}

.dt-hover-card__line--title {
	font-weight: 600;
}

.dt-hover-card__line--code {
	font-family: var(--dt-font-mono);
	opacity: 0.8;
}
</style>
