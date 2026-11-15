<script setup lang="ts">
/**
 * The browser host's TAB STRIP (cr-modules-022): pill tabs in a 32px row at the top of the sheet — the nav toolbar's
 * height, so the two still read as one band. A tab's × space is always reserved (the × only shows on hover and on the
 * open tab), so a tab never changes width under the pointer. × or a middle click closes; closing the open tab opens its
 * neighbour. The strip scrolls sideways and fades at its end when the tabs outrun it.
 */
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { closeTab, restoreTabs, saveTabs, tabPath, tabs, visit } from '../lib/tabs';
import DtIcon from './DtIcon.vue';

const route = useRoute();
const router = useRouter();
const activePath = computed(() => tabPath(route.fullPath));

restoreTabs();
watch(() => route.fullPath, (full) => {
	// '/' and the bare '/content/' are transit routes: ContentBrowse sends them on to the first collection
	if (!full || full === '/' || tabPath(full) === '/content') return;
	const next = visit(tabs.value, full);
	if (next !== tabs.value) { tabs.value = next; saveTabs(); }
}, { immediate: true });

function open(route: string) { void router.push(route); }
function close(path: string) {
	const { tabs: rest, next } = closeTab(tabs.value, path, activePath.value);
	tabs.value = rest;
	saveTabs();
	if (next) void router.push(next);
}
function onAux(e: MouseEvent, path: string) {
	if (e.button !== 1) return;
	e.preventDefault();
	close(path);
}
</script>

<template>
	<div class="dt-tabs" role="tablist" aria-label="Open pages">
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
	mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
}
.dt-tabs::-webkit-scrollbar {
	display: none;
}
.dt-tab {
	position: relative;
	flex: 0 1 200px;
	min-width: 96px;
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
