<!--
	Right-sliding drawer panel (contract C4, schema-designer facelift). A reka-ui Dialog dressed as
	an edge-anchored sheet rather than a centered modal — it keeps the Dialog a11y guarantees (focus
	trap, Escape-to-close, overlay-click dismiss, background scroll lock via the modal default) while
	sliding in from the right. `--dt-*` tokened; portals to <body> like the other dialogs, so its
	scoped styles ride the data-v attribute onto the portaled nodes.

	Props: open (controlled by the parent), title (header text — omit and use the #header slot to
	replace the whole bar), width (any CSS length, default 480px). Emits 'close' whenever reka
	requests dismissal (Escape / overlay / the built-in close button). Slots: default (body), header
	(replaces the title bar), footer (sticky bottom action bar). Consumed by Wave-2 Agent F's
	FieldDrawer; generic enough for any drawer surface.
-->
<script setup lang="ts">
import { useSlots } from 'vue';
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, VisuallyHidden } from 'reka-ui';
import DtIcon from './DtIcon.vue';

withDefaults(defineProps<{ open: boolean; title?: string; width?: string }>(), { title: undefined, width: '480px' });

const emit = defineEmits<{ close: [] }>();
const slots = useSlots();

// reka drives open state through update:open; this is a controlled component, so the parent owns
// `open` — we only translate a request-to-close into the 'close' event and let the parent flip it.
function onOpenChange(next: boolean): void {
	if (!next) emit('close');
}
</script>

<template>
	<DialogRoot :open="open" @update:open="onOpenChange">
		<DialogPortal>
			<DialogOverlay class="dt-drawer-overlay" />
			<DialogContent class="dt-drawer" :style="{ width }">
				<!-- A DialogTitle must exist for a11y; when #header replaces the bar we keep a
				     visually-hidden one so reka stays quiet and screen readers still get a name. -->
				<template v-if="slots.header">
					<VisuallyHidden as-child>
						<DialogTitle>{{ title ?? 'Drawer' }}</DialogTitle>
					</VisuallyHidden>
					<header class="dt-drawer__header">
						<slot name="header" />
					</header>
				</template>
				<header v-else class="dt-drawer__header">
					<DialogTitle class="dt-drawer__title">{{ title }}</DialogTitle>
					<!-- Teleport target: a drawer's CONTENT can put its primary action up here
					     (`<Teleport to=".dt-drawer__actions">`) without this component knowing what
					     the action is, or the parent plumbing a component through as a prop.
					     Operator ask 2026-07-27: "move save to view to a button on the header". -->
					<div class="dt-drawer__actions"></div>
					<button type="button" class="dt-drawer__close" title="Close" @click="emit('close')">
						<DtIcon name="close" />
					</button>
				</header>

				<div class="dt-drawer__body">
					<slot />
				</div>

				<footer v-if="slots.footer" class="dt-drawer__footer">
					<slot name="footer" />
				</footer>
			</DialogContent>
		</DialogPortal>
	</DialogRoot>
</template>

<style scoped>
.dt-drawer-overlay {
	position: fixed;
	inset: 0;
	background: rgb(0 0 0 / 0.42);
	z-index: 200;
}
.dt-drawer-overlay[data-state='open'] {
	animation: dt-drawer-overlay-in 0.18s ease;
}
.dt-drawer-overlay[data-state='closed'] {
	animation: dt-drawer-overlay-out 0.15s ease;
}

.dt-drawer {
	position: fixed;
	top: 0;
	right: 0;
	bottom: 0;
	z-index: 201;
	max-width: calc(100vw - 32px);
	display: flex;
	flex-direction: column;
	background: var(--dt-bg);
	border-left: 1px solid var(--dt-border);
	box-shadow: var(--dt-shadow-lg);
}
.dt-drawer[data-state='open'] {
	animation: dt-drawer-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.dt-drawer[data-state='closed'] {
	animation: dt-drawer-out 0.16s ease;
}

/* VS Code panel-header proportions: a 35px bar with an 11px uppercase label, not an 18px
   page title in 18px of padding (operator 2026-07-27: "header - too big"). */
.dt-drawer__header {
	display: flex;
	align-items: center;
	gap: 8px;
	height: 35px;
	flex: 0 0 auto;
	padding: 0 4px 0 12px;
	border-bottom: 1px solid var(--dt-border);
}
.dt-drawer__title {
	font-size: var(--dt-label);
	font-weight: 400;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--dt-fg-subtle);
	white-space: nowrap;
}
.dt-drawer__actions {
	display: flex;
	align-items: center;
	gap: 4px;
	margin-left: auto;
}
.dt-drawer__close {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 22px;
	height: 22px;
	border: none;
	border-radius: 4px;
	background: transparent;
	color: var(--dt-fg-subtle);
	cursor: pointer;
	flex-shrink: 0;
}
.dt-drawer__close:hover {
	background: var(--dt-bg-hover);
	color: var(--dt-fg);
}
.dt-drawer__close .codicon {
	font-size: var(--dt-icon);
}
.dt-drawer__body {
	flex: 1 1 auto;
	overflow-y: auto;
	padding: 12px;
}
.dt-drawer__footer {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 8px;
	padding: 10px 12px;
	border-top: 1px solid var(--dt-border);
	background: var(--dt-bg);
}

@keyframes dt-drawer-in {
	from {
		transform: translateX(100%);
	}
	to {
		transform: translateX(0);
	}
}
@keyframes dt-drawer-out {
	from {
		transform: translateX(0);
	}
	to {
		transform: translateX(100%);
	}
}
@keyframes dt-drawer-overlay-in {
	from {
		opacity: 0;
	}
	to {
		opacity: 1;
	}
}
@keyframes dt-drawer-overlay-out {
	from {
		opacity: 1;
	}
	to {
		opacity: 0;
	}
}
</style>
