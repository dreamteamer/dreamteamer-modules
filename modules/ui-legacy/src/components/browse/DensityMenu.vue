<!--
	The table's ROW DENSITY, from the page header: one icon button, a three-item menu — Compact,
	Cozy, Comfortable — with the one in force checked. It writes the table layout's `row_size` option
	through the SAME `setListOptions` the Layout options drawer writes, so the drawer's dropdown, the
	Save button and the modified dot all see the pick; nothing is kept here that the view would not
	keep. The pick beats whatever the ui-view or the collection authored (it sits on the browse's
	scratch, over the seed), and the drawer's Save is what makes it durable.

	Drawn by DtMenu (the one menu): hung under its trigger, closed by an outside press, Escape or a pick,
	with the menu keyboard — so the gesture can be pinned by a test that calls the handlers directly.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BrowseState } from '../../composables/browse-state';
import { ROW_SIZES, ROW_SIZE_LABELS, resolveRowSize, type RowSize } from '../../lib/row-size';
import DtIcon from '../DtIcon.vue';
import DtMenu from '../DtMenu.vue';

const props = defineProps<{ state: BrowseState }>();

const LAYOUT = 'table';

const current = computed(() => resolveRowSize(props.state.listOptions.value[LAYOUT]));
const open = ref(false);
const triggerEl = ref<HTMLElement | null>(null);

function pick(size: RowSize): void {
	// Merged over the rest of the table's options, never replacing them — a density pick must not
	// drop the grouping or the page size the same slice holds.
	props.state.setListOptions(LAYOUT, { ...(props.state.listOptions.value[LAYOUT] ?? {}), row_size: size });
	open.value = false;
}

</script>

<template>
	<div class="dt-density">
		<button
			ref="triggerEl"
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

		<DtMenu v-if="open" class="dt-density__menu" label="Row density" align="end" :min-width="160" :trigger="triggerEl" @close="open = false">
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
		</DtMenu>
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

.dt-density__item[aria-checked='true'] {
	color: var(--dt-fg);
}
</style>
