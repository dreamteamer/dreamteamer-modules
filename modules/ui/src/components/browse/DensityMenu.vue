<!--
	The table's ROW DENSITY, from the page header: one icon button, a three-item menu — Compact,
	Cozy, Comfortable — with the one in force checked. It writes the table layout's `row_size` option
	through the SAME `setListOptions` the Layout options drawer writes, so the drawer's dropdown, the
	Save button and the modified dot all see the pick; nothing is kept here that the view would not
	keep. The pick beats whatever the ui-view or the collection authored (it sits on the browse's
	scratch, over the seed), and the drawer's Save is what makes it durable.

	Not reka-ui's DropdownMenu: that portals to <body> and needs pointer events to open, which the
	webview render tier cannot send. This is the filter panel's own pattern — an anchored panel under
	its trigger, closed by an outside mousedown, Escape or a pick — so the gesture can be pinned by a
	test that calls the handlers directly.
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { BrowseState } from '../../composables/browse-state';
import { ROW_SIZES, ROW_SIZE_LABELS, resolveRowSize, type RowSize } from '../../lib/row-size';
import DtIcon from '../DtIcon.vue';

const props = defineProps<{ state: BrowseState }>();

const LAYOUT = 'table';

const current = computed(() => resolveRowSize(props.state.listOptions.value[LAYOUT]));
const open = ref(false);
const anchorEl = ref<HTMLElement | null>(null);

function pick(size: RowSize): void {
	// Merged over the rest of the table's options, never replacing them — a density pick must not
	// drop the grouping or the page size the same slice holds.
	props.state.setListOptions(LAYOUT, { ...(props.state.listOptions.value[LAYOUT] ?? {}), row_size: size });
	open.value = false;
}

function onDocumentMousedown(event: MouseEvent): void {
	if (!open.value) return;
	const target = event.target as Node | null;
	if (target && anchorEl.value?.contains(target)) return;
	open.value = false;
}

function onDocumentKeydown(event: KeyboardEvent): void {
	if (event.key === 'Escape' && open.value) open.value = false;
}

onMounted(() => {
	document.addEventListener('mousedown', onDocumentMousedown);
	document.addEventListener('keydown', onDocumentKeydown);
});

onUnmounted(() => {
	document.removeEventListener('mousedown', onDocumentMousedown);
	document.removeEventListener('keydown', onDocumentKeydown);
});
</script>

<template>
	<div ref="anchorEl" class="dt-density">
		<button
			type="button"
			class="dt-btn dt-btn--secondary dt-btn--icon dt-density__trigger"
			:class="{ 'is-active': open }"
			:title="`Row density — ${ROW_SIZE_LABELS[current]}`"
			aria-haspopup="menu"
			:aria-expanded="open"
			@click="open = !open"
		>
			<DtIcon name="list-flat" />
		</button>

		<div v-if="open" class="dt-menu dt-density__menu" role="menu" aria-label="Row density">
			<button
				v-for="size in ROW_SIZES"
				:key="size"
				type="button"
				class="dt-menu-item dt-density__item"
				role="menuitemradio"
				:aria-checked="size === current"
				:data-size="size"
				@click="pick(size)"
			>
				<span class="dt-menu-item__check">
					<DtIcon v-if="size === current" name="check" />
				</span>
				{{ ROW_SIZE_LABELS[size] }}
			</button>
		</div>
	</div>
</template>

<style scoped>
.dt-density {
	position: relative;
	display: flex;
}

.dt-density__trigger.is-active {
	background: var(--dt-accent-subtle);
	color: var(--dt-accent);
}

/* Anchored under the trigger, right-aligned to it, over the rows — the filter panel's placement.
   `.dt-menu` (base.css) supplies the chrome; this only positions. */
.dt-density__menu {
	position: absolute;
	top: calc(100% + 6px);
	right: 0;
	min-width: 160px;
	display: flex;
	flex-direction: column;
}

/* `.dt-menu-item` is written for reka-ui's items (`data-highlighted`); a real <button> needs the
   reset and its own hover. */
.dt-density__item {
	width: 100%;
	border: none;
	background: none;
	font-family: inherit;
	text-align: left;
}
.dt-density__item:hover,
.dt-density__item:focus-visible {
	background: var(--dt-bg-subtle);
}
.dt-density__item[aria-checked='true'] {
	color: var(--dt-fg);
}
</style>
