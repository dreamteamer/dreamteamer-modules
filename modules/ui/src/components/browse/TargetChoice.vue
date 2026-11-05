<!--
	WHERE A NEW RECORD GOES — asked BEFORE the form (cr-vscode-004, decision 2026-10-31 "a popover on the
	New button"). Opened by New on a list that reads two or more roots a record can be added to (or one
	the picker narrows to roots that take none): one row per target — its mark, whose pencil says it
	writes; then each narrowed source that is NOT offered, with its reason (a layer not compiled here, an
	installed package, a layer not installed); then one '+N not offered' line for the rest. A pick opens the
	ordinary create form with `?target=<name>`, whose Saves-to line names the root and whose save writes there.

	ONE LINE PER SOURCE, THE WORDS ON A CARD (cr-vscode-016). A target row is its mark alone — dot, name
	(ellipsised when long, `SourceMark fit`), pencil in a column at the right — so nothing can wrap over the
	glyph. The root's kind, its writability, the host's note and why the other sources are not offered are on
	a card the menu opens the moment the pointer (or focus) is on a line: no timer, no native title. The card is
	the menu's own until cr-vscode-013's HoverCard lands; its lines are that component's `lines` shape
	(`lib/sources.ts` `targetHoverLines` / `excludedHoverLines` / `othersHoverLines`), so the swap is one place.
	It hangs OUTSIDE the scrolling list, beside the menu (`cardPlace`), so the list never clips it.

	Anchored under the header's + (the filter panel's technique: absolute, no portal), closed by Escape,
	an outside click, or a pick. `lib/sources.ts` `targetChoice` decides when it opens and what it lists.
-->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { HoverLine, TargetChoice } from '../../lib/sources';
import { CARD_MAX, cardPlace, excludedHoverLines, othersHoverLines, targetHoverLines } from '../../lib/sources';
import SourceMark from '../SourceMark.vue';

const props = defineProps<{ choice: Extract<TargetChoice, { mode: 'choose' }> }>();
const emit = defineEmits<{ pick: [name: string]; cancel: [] }>();

const panel = ref<HTMLElement | null>(null);

// ---- the card ---------------------------------------------------------------------------------------------
const cardId = `dt-target-choice-card-${Math.random().toString(36).slice(2, 9)}`;
const card = ref<{ key: string; lines: HoverLine[]; place: ReturnType<typeof cardPlace> } | null>(null);

/** Where the card goes for the line under the pointer — measured only where there is layout (a real window). */
function placeFor(line: Element | null): ReturnType<typeof cardPlace> {
	const view = typeof window === 'undefined' ? undefined : (window as Partial<Window>);
	const menu = panel.value;
	if (!line || !menu || typeof view?.innerWidth !== 'number' || typeof menu.getBoundingClientRect !== 'function') return { side: 'left', top: 0 };
	const m = menu.getBoundingClientRect();
	const r = line.getBoundingClientRect();
	const width = Math.min(CARD_MAX, view.innerWidth - 8);
	return cardPlace({ left: m.left, right: m.right, height: m.height }, r.top - m.top, width, view.innerWidth);
}
/** Open synchronously — the card is there in the same frame the pointer arrives. */
function show(key: string, lines: HoverLine[], event?: Event): void {
	card.value = { key, lines, place: placeFor((event?.currentTarget as Element | null) ?? null) };
}
function hide(key: string): void {
	if (card.value?.key === key) card.value = null;
}
function cardStyle(place: ReturnType<typeof cardPlace>): Record<string, string> {
	return place.side === 'below' ? { top: `${place.top}px`, left: `${place.left ?? 0}px` } : { top: `${place.top}px` };
}
function pick(name: string): void {
	card.value = null;
	emit('pick', name);
}

function onDocumentMousedown(event: MouseEvent): void {
	const target = event.target as Node | null;
	// the + itself toggles; a click anywhere else closes
	if (target && (panel.value?.contains(target) || panel.value?.parentElement?.contains(target))) return;
	card.value = null;
	emit('cancel');
}
function onDocumentKeydown(event: KeyboardEvent): void {
	if (event.key !== 'Escape') return;
	card.value = null;
	emit('cancel');
}
onMounted(() => {
	if (typeof document === 'undefined') return;
	document.addEventListener('mousedown', onDocumentMousedown);
	document.addEventListener('keydown', onDocumentKeydown);
});
onUnmounted(() => {
	if (typeof document === 'undefined') return;
	document.removeEventListener('mousedown', onDocumentMousedown);
	document.removeEventListener('keydown', onDocumentKeydown);
});
</script>

<template>
	<div ref="panel" class="dt-target-choice" role="menu" aria-label="New record in…" data-target-choice>
		<p class="dt-target-choice__head">New record in…</p>
		<div class="dt-target-choice__list">
			<button
				v-for="t in props.choice.targets"
				:key="t.name"
				type="button"
				role="menuitem"
				class="dt-target-choice__row"
				:data-target="t.name"
				:aria-describedby="card?.key === `t:${t.name}` ? cardId : undefined"
				@mouseenter="show(`t:${t.name}`, targetHoverLines(t), $event)"
				@mouseleave="hide(`t:${t.name}`)"
				@focus="show(`t:${t.name}`, targetHoverLines(t), $event)"
				@blur="hide(`t:${t.name}`)"
				@click="pick(t.name)"
			>
				<SourceMark fit :name="t.name" :access="t.access" :via="t.via" :note="t.note" />
			</button>
			<p v-if="!props.choice.targets.length" class="dt-target-choice__empty">No source of this list takes a new record from here.</p>
			<template v-if="props.choice.excluded.length">
				<p class="dt-target-choice__subhead">Not offered</p>
				<p
					v-for="x in props.choice.excluded"
					:key="x.source.name"
					class="dt-target-choice__excluded"
					:data-excluded="x.source.name"
					:aria-describedby="card?.key === `x:${x.source.name}` ? cardId : undefined"
					@mouseenter="show(`x:${x.source.name}`, excludedHoverLines(x), $event)"
					@mouseleave="hide(`x:${x.source.name}`)"
				>
					<SourceMark fit :name="x.source.name" :access="x.source.access" :via="x.source.via" />
					<span class="dt-target-choice__reason">{{ x.reason }}</span>
				</p>
			</template>
			<p
				v-if="props.choice.others.length"
				class="dt-target-choice__more"
				tabindex="0"
				:aria-describedby="card?.key === 'more' ? cardId : undefined"
				@mouseenter="show('more', othersHoverLines(props.choice.others), $event)"
				@mouseleave="hide('more')"
				@focus="show('more', othersHoverLines(props.choice.others), $event)"
				@blur="hide('more')"
			>+{{ props.choice.others.length }} not offered</p>
		</div>
		<div v-if="card" :id="cardId" class="dt-target-choice__card" role="tooltip" :data-side="card.place.side" :style="cardStyle(card.place)">
			<div v-for="(line, i) in card.lines" :key="i" :class="`dt-target-choice__line dt-target-choice__line--${line.kind ?? 'body'}`">{{ line.text }}</div>
		</div>
	</div>
</template>

<style scoped>
/* The outer box clips NOTHING (no overflow, no max-height): the card hangs outside it. Only the list scrolls. */
.dt-target-choice {
	position: absolute;
	top: calc(100% + 6px);
	right: 0;
	z-index: 30;
	box-sizing: border-box;
	width: max-content;
	min-width: 180px;
	max-width: min(280px, calc(100vw - 16px));
	display: flex;
	flex-direction: column;
	padding: 4px;
	background: var(--dt-bg);
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius-lg);
	box-shadow: var(--dt-shadow-lg);
	text-align: left;
}
.dt-target-choice__list {
	display: flex;
	flex-direction: column;
	min-width: 0;
	max-height: min(60vh, 480px);
	overflow-y: auto;
}
.dt-target-choice__head,
.dt-target-choice__subhead {
	margin: 0;
	padding: 6px 8px 4px;
	color: var(--dt-fg-subtle);
	font-size: var(--dt-label);
	white-space: nowrap;
}
.dt-target-choice__subhead {
	border-top: 1px solid var(--dt-border);
	margin-top: 4px;
}
.dt-target-choice__row {
	display: flex;
	align-items: center;
	min-width: 0;
	white-space: nowrap;
	padding: 6px 8px;
	border: 0;
	border-radius: var(--dt-radius);
	background: transparent;
	color: var(--dt-fg);
	font: inherit;
	text-align: left;
	cursor: pointer;
}
.dt-target-choice__row:hover,
.dt-target-choice__row:focus-visible {
	background: var(--dt-bg-hover);
}
.dt-target-choice__excluded {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
	margin: 0;
	padding: 4px 8px;
	opacity: 0.8;
}
.dt-target-choice__reason,
.dt-target-choice__empty {
	margin: 0;
	padding: 0 8px;
	color: var(--dt-fg-muted);
	font-size: var(--dt-label);
	white-space: normal;
}
.dt-target-choice__reason {
	padding: 0;
}
.dt-target-choice__more {
	margin: 0;
	padding: 4px 8px 2px;
	color: var(--dt-fg-muted);
	font-size: var(--dt-label);
	white-space: nowrap;
	cursor: default;
}
.dt-target-choice__more:focus-visible {
	outline: 1px solid var(--vscode-focusBorder, var(--dt-border));
	outline-offset: -1px;
}
/* The card: beside the menu (left by default, right or below by `cardPlace`), never taking the pointer. */
.dt-target-choice__card {
	position: absolute;
	right: calc(100% + 4px);
	z-index: 31;
	box-sizing: border-box;
	width: max-content;
	max-width: min(280px, calc(100vw - 8px));
	padding: 6px 8px;
	background: var(--vscode-editorHoverWidget-background, var(--dt-bg));
	border: 1px solid var(--vscode-editorHoverWidget-border, var(--dt-border));
	color: var(--vscode-editorHoverWidget-foreground, var(--dt-fg));
	border-radius: var(--dt-radius);
	box-shadow: var(--dt-shadow-lg);
	font-size: var(--dt-label);
	white-space: normal;
	overflow-wrap: anywhere;
	pointer-events: none;
}
.dt-target-choice__card[data-side='right'] {
	right: auto;
	left: calc(100% + 4px);
}
.dt-target-choice__card[data-side='below'] {
	right: auto;
}
.dt-target-choice__line--title {
	color: var(--vscode-editorHoverWidget-foreground, var(--dt-fg));
	font-weight: 600;
}
.dt-target-choice__line--body {
	color: var(--dt-fg-muted);
}
.dt-target-choice__line--code {
	font-family: var(--vscode-editor-font-family, monospace);
}
</style>
