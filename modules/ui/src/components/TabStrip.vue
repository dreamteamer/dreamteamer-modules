<script setup lang="ts">
/**
 * The browser host's TAB STRIP (cr-modules-022): pill tabs in a 32px row at the top of the sheet — the nav toolbar's
 * height, so the two still read as one band. A tab's × space is always reserved (the × only shows on hover and on the
 * open tab), so a tab never changes width under the pointer. × or a middle click closes; closing the open tab opens its
 * neighbour. Tabs shrink to a minimum before the strip scrolls sideways (a wheel scrolls it too, and the open tab is
 * always scrolled into view); it fades at its end when the tabs outrun it. At most TAB_CAP tabs (lib/tabs.ts).
 *
 * A RELOAD restores the tabs and the selected one: the list and the selected path are kept (lib/tabs.ts), the page's
 * own address (its hash) wins when it names a page, and a page that opens on a transit route (`/`, `/content/` — a
 * fresh `dt web open`) goes to the tab that was selected instead of opening a tab for the first collection.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { closeTab, isTransit, openTab, restoreActive, restoreTabs, saveActive, saveTabs, startTabs, tabPath, tabs } from '../lib/tabs';
import DtIcon from './DtIcon.vue';

const route = useRoute();
const router = useRouter();
const activePath = computed(() => tabPath(route.fullPath));
const strip = ref<HTMLElement | null>(null);

restoreTabs();
startTabs();
watch(() => route.fullPath, (full) => {
	if (isTransit(full)) {
		// a fresh page or Home: back to the tab that was selected, when there still is one
		const kept = restoreActive();
		const tab = kept ? tabs.value.find((t) => t.path === kept) : undefined;
		if (tab) void router.replace(tab.route);
		return;
	}
	openTab(full);
	void nextTick(showActive);
}, { immediate: true });

/** The open tab is never scrolled out of sight. */
function showActive() {
	const el = strip.value?.querySelector?.('.dt-tab.is-active') as { scrollIntoView?: (o: unknown) => void } | null | undefined;
	el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}
/** A vertical wheel over the strip scrolls it sideways. */
function onWheel(e: WheelEvent) {
	const el = strip.value;
	if (!el || Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
	e.preventDefault();
	el.scrollLeft += e.deltaY;
}

function open(route: string) { void router.push(route); }
function close(path: string) {
	const { tabs: rest, next } = closeTab(tabs.value, path, activePath.value);
	tabs.value = rest;
	saveTabs();
	if (next) void router.push(next);
	else if (!rest.length) saveActive('');
}
function onAux(e: MouseEvent, path: string) {
	if (e.button !== 1) return;
	e.preventDefault();
	close(path);
}
</script>

<template>
	<div ref="strip" class="dt-tabs" role="tablist" aria-label="Open pages" @wheel="onWheel">
		<div
			v-for="t in tabs"
			:key="t.path"
			class="dt-tab"
			:class="{ 'is-active': t.path === activePath }"
			role="tab"
			:aria-selected="t.path === activePath ? 'true' : 'false'"
			:title="t.title"
			@mousedown.middle.prevent
			@auxclick="onAux($event, t.path)"
		>
			<button type="button" class="dt-tab__open" :tabindex="t.path === activePath ? 0 : -1" @click="open(t.route)">
				<DtIcon v-if="t.icon" :name="t.icon" />
				<span class="dt-tab__label">{{ t.title }}</span>
			</button>
			<button type="button" class="dt-tab__close" :aria-label="`Close ${t.title}`" title="Close" @click.stop="close(t.path)">
				<DtIcon name="close" />
			</button>
		</div>
	</div>
</template>

<style scoped>
.dt-tabs {
	flex: none;
	display: flex;
	align-items: center;
	gap: var(--dt-space-1);
	height: 32px;
	padding: 4px var(--dt-space-3) 0;
	overflow-x: auto;
	overflow-y: hidden;
	scrollbar-width: none;
	/* the strip's end fades when the tabs outrun it */
	mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent); /* literal-ok: a mask's opacity, never a colour anyone sees */
}
.dt-tabs::-webkit-scrollbar {
	display: none;
}
.dt-tab {
	position: relative;
	/* shrink first (the label ellipsises, the × keeps its room), scroll only past the minimum */
	flex: 0 1 200px;
	min-width: 72px;
	max-width: 200px;
	height: 26px;
	display: flex;
	align-items: center;
	border-radius: var(--dt-radius-pill);
	color: var(--dt-fg-subtle);
	transition:
		background-color var(--dt-dur-fast) var(--dt-ease),
		color var(--dt-dur-fast) var(--dt-ease);
}
.dt-tab:hover {
	background: var(--dt-ink-2);
	color: var(--dt-fg);
}
.dt-tab.is-active {
	background: var(--dt-ink-4);
	color: var(--dt-fg);
	font-weight: var(--dt-weight-medium);
}
.dt-tab__open {
	flex: 1;
	min-width: 0;
	height: 100%;
	display: flex;
	align-items: center;
	gap: 6px;
	/* the × is laid over the right end: its 22px are reserved here whether it shows or not */
	padding: 0 26px 0 10px;
	border: 0;
	border-radius: inherit;
	background: transparent;
	color: inherit;
	font: inherit;
	cursor: default;
	text-align: left;
}
.dt-tab__open .codicon {
	flex: none;
}
.dt-tab__label {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.dt-tab__close {
	position: absolute;
	right: 4px;
	top: 50%;
	transform: translateY(-50%);
	width: 18px;
	height: 18px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 0;
	border: 0;
	border-radius: var(--dt-radius-pill);
	background: transparent;
	color: var(--dt-fg-subtle);
	opacity: 0;
	cursor: default;
}
.dt-tab__close .codicon {
	font-size: var(--dt-text-sm);
}
.dt-tab:hover .dt-tab__close,
.dt-tab.is-active .dt-tab__close,
.dt-tab__close:focus-visible {
	opacity: 1;
}
.dt-tab__close:hover {
	background: var(--dt-ink-4);
	color: var(--dt-fg);
}
</style>
