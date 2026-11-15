<!--
	Right PANEL — inline, collapsible, non-modal (operator 2026-07-27: "replace right drawer with a
	panel that can expand collapse. the drawer is confusing to use with checkboxes").

	It was a DtDrawer (reka Dialog: overlay + focus trap) through 0.6.4. That was wrong for what the
	panel now holds: the Commands tab evaluates over the table's checkbox SELECTION, and a modal
	makes the table unreachable while open — you could not tick a row without dismissing the thing
	that was reading your ticks. So it lives in the shell's flex row instead, exactly like VS Code's
	own side panels: the page narrows, nothing is trapped, selection and commands stay live together.

	Collapsed it is a slim icon rail (one icon per registered section, click to expand on that tab);
	expanded it is a 320px column with a TAB BAR (registration order = tab order, so pages lead with
	Commands), an actions toolbar row beneath it (Teleport target `.dt-drawer__actions`, kept under
	that name so LayoutOptionsSection's Save button needs no change), and the section body.

	Fed by `composables/page-sidebar.ts`'s module-level store — this component never talks to a
	specific view. Expanded/collapsed state survives navigation (see the note on `open` there).
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import { useSidebarStore } from '../composables/page-sidebar';
import DtIcon from './DtIcon.vue';

const { sections, activeId, open, openSection, close } = useSidebarStore();

const hasSections = computed(() => sections.value.length > 0);
const active = computed(() => sections.value.find((section) => section.id === activeId.value) ?? null);

/*
 * SLIDE-OVER (cr-modules-022), under a host that draws the app's own nav (dt web) only: the rail stays in the row, and
 * the open panel is laid OVER the sheet's right edge instead of taking a column, so opening it never changes the page's
 * width (a table keeps its columns). It is still non-modal — no overlay, no focus trap — because the Commands tab reads
 * the table's ticks while it is open. Escape closes it, unless a menu or a dialog is open and the Escape is theirs.
 * Inside VS Code it is the inline column it always was.
 */
const overlay = (window as any).__DT_HOST__?.nav === 'app';
function onKey(e: KeyboardEvent) {
	if (e.key !== 'Escape' || e.defaultPrevented || !open.value) return;
	if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"], .dt-nav-menu, .dt-pane-menu')) return;
	close();
}
if (overlay) {
	watch(open, (o) => (o ? window.addEventListener('keydown', onKey) : window.removeEventListener('keydown', onKey)), { immediate: true });
	onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
}
</script>

<template>
	<aside v-if="hasSections" class="dt-rsb" :class="{ 'is-open': open, 'dt-rsb--over': overlay }">
		<!-- Collapsed: icon rail. Clicking an icon expands on that section. A slide-over keeps the rail beside it. -->
		<div v-if="!open || overlay" class="dt-rsb-rail">
			<button
				v-for="section in sections"
				:key="section.id"
				type="button"
				class="dt-rsb-rail-btn"
				:class="{ 'is-active': overlay && open && section.id === activeId }"
				:title="`${section.title} — click to ${overlay && open && section.id === activeId ? 'close' : 'expand'}`"
				@click="overlay && open && section.id === activeId ? close() : openSection(section.id)"
			>
				<DtIcon :name="section.icon" />
			</button>
		</div>

		<!-- Expanded: tabs + actions row + body. -->
		<Transition :name="overlay ? 'dt-rsb-slide' : 'dt-rsb-none'">
		<div v-if="open" class="dt-rsb-panel" role="complementary" aria-label="Page panel">
			<header class="dt-rsb-head">
				<nav class="dt-rsb-tabs" role="tablist">
					<button
						v-for="section in sections"
						:key="section.id"
						type="button"
						role="tab"
						class="dt-rsb-tab"
						:class="{ active: section.id === activeId }"
						:aria-selected="section.id === activeId"
						@click="openSection(section.id)"
					>
						{{ section.title }}
					</button>
				</nav>
				<button type="button" class="dt-rsb-collapse" title="Collapse panel" @click="close">
					<DtIcon name="chevron-right" />
				</button>
			</header>

			<!-- Kept as `.dt-drawer__actions` so section Teleports keep working unchanged. -->
			<div class="dt-drawer__actions dt-rsb-actions"></div>

			<div class="dt-rsb-body">
				<component :is="active.component" v-if="active" v-bind="active.props ?? {}" />
			</div>
		</div>
		</Transition>
	</aside>
</template>

<style scoped>
.dt-rsb {
	flex-shrink: 0;
	display: flex;
	flex-direction: column;
	min-height: 0;
	background: var(--dt-bg-subtle);
	border-left: 1px solid var(--dt-border);
}

/* collapsed rail vs expanded column — a plain width change, no transform/overlay */
.dt-rsb:not(.is-open) {
	width: 36px;
}
.dt-rsb.is-open {
	width: 320px;
}

.dt-rsb-rail {
	display: flex;
	flex-direction: column;
	align-items: center;
	padding-top: var(--dt-space-1);
	gap: 2px;
}

.dt-rsb-rail-btn {
	width: var(--dt-control-height);
	height: var(--dt-control-height);
	border: none;
	border-radius: var(--dt-radius);
	background: transparent;
	color: var(--dt-fg-subtle);
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
}

.dt-rsb-rail-btn:hover {
	background: var(--dt-bg-hover);
	color: var(--dt-fg);
}

/* the expanded panel's own box: inline, it fills the 320px column */
.dt-rsb-panel {
	flex: 1 1 auto;
	min-height: 0;
	display: flex;
	flex-direction: column;
}

/* ---- the slide-over (browser host) ---------------------------------------------------------- */
/* The aside stays a 36px rail on the canvas — no ground, no line — and the panel is fixed over the sheet's right edge,
   below the shell's top inset, so the page under it keeps its width. */
.dt-rsb--over,
.dt-rsb--over.is-open {
	width: 36px;
	background: transparent;
	border-left: 0;
}
.dt-rsb--over .dt-rsb-rail-btn:hover {
	background: var(--dt-ink-3);
}
.dt-rsb--over .dt-rsb-rail-btn.is-active {
	background: var(--dt-accent-tint);
	color: var(--dt-accent);
}
.dt-rsb--over .dt-rsb-panel {
	position: fixed;
	z-index: 40;
	top: var(--dt-space-2);
	right: 36px;
	bottom: 0;
	width: min(380px, calc(100vw - 72px));
	background: var(--dt-surface);
	border-top-left-radius: var(--dt-radius-xl);
	box-shadow: var(--dt-shadow-menu);
	overflow: hidden;
}
.dt-rsb-slide-enter-active,
.dt-rsb-slide-leave-active {
	transition:
		transform var(--dt-dur-med) var(--dt-ease),
		opacity var(--dt-dur-med) var(--dt-ease);
}
.dt-rsb-slide-enter-from,
.dt-rsb-slide-leave-to {
	transform: translateX(16px);
	opacity: 0;
}

/* header bar at the workbench's own pane-header height */
.dt-rsb-head {
	flex: 0 0 auto;
	display: flex;
	align-items: stretch;
	height: var(--dt-header-height);
	padding-right: var(--dt-space-1);
	border-bottom: 1px solid var(--dt-border);
}

.dt-rsb-tabs {
	display: flex;
	align-items: stretch;
	gap: 2px;
	min-width: 0;
	overflow-x: auto;
}

.dt-rsb-tab {
	border: none;
	background: transparent;
	padding: 0 var(--dt-space-2);
	font-size: var(--dt-label);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--dt-fg-subtle);
	cursor: pointer;
	white-space: nowrap;
	flex-shrink: 0;
	/* underline via inset shadow, not border — a border shifts the row's baseline */
	box-shadow: inset 0 -2px 0 transparent;
}

.dt-rsb-tab:hover {
	color: var(--dt-fg);
}

.dt-rsb-tab.active {
	color: var(--dt-fg);
	box-shadow: inset 0 -2px 0 var(--dt-accent);
}

.dt-rsb-collapse {
	align-self: center;
	margin-left: auto;
	width: 22px;
	height: 22px;
	display: flex;
	align-items: center;
	justify-content: center;
	border: none;
	border-radius: var(--dt-radius);
	background: transparent;
	color: var(--dt-fg-subtle);
	cursor: pointer;
	flex-shrink: 0;
}

.dt-rsb-collapse:hover {
	background: var(--dt-bg-hover);
	color: var(--dt-fg);
}

/* actions toolbar row under the tabs; :empty collapses it (Commands teleports nothing) */
.dt-rsb-actions {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	gap: var(--dt-space-1);
	padding: var(--dt-space-1) var(--dt-space-3);
	border-bottom: 1px solid var(--dt-border);
}

.dt-rsb-actions:empty {
	display: none;
}

.dt-rsb-body {
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
	padding: var(--dt-space-3);
}
</style>
