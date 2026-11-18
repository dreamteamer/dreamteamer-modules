<!--
	THE SOURCE PICKER — beside the filter button, replacing the 0.24.0 facet strip under the header
	(operator 2026-10-29: the strip was clunky). Closed, it shows only the SELECTION — "All sources",
	the mark of the one source picked, or the dots of several and how many (names side by side overran
	the button — operator, same day); open, it lists every source the collection reads with the
	records each holds, an "All sources" row first. A click on a source narrows to it from all and
	toggles it after; a selection that empties, or names every source, is all again (`toggleSource`).

	It writes the ordinary filter — ONE `$source` rule (`lib/sources.ts`), the same one a layer's nav
	row opens with — so Save and the URL see it, and nothing narrows the rows outside the filter. The
	chips row draws that rule as `Source is …` (cr-vscode-004), and a click on the chip's words opens
	this picker — it is the chip's editor (`show()`, exposed).

	Each row says its source's class and whether a write lands there — the mark's pencil or lock and the
	words beside it (`record layer · writes`, `installed package · read-only`; cr-vscode-004).

	Counts come from the host (`meta.sources`), counted over the rows the OTHER rules leave, so a
	source you have not picked still says how many it holds. A layer that is not installed is listed
	greyed, with no count and nothing to pick — its records are not read.

	It needs only the two refs it reads and writes, so the Schema tab's hand-built Collections and
	Modules tables hand it their own (`composables/source-filter.ts`) — every list has the picker.
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue';
import type { SourceEntry } from '../../api/types';
import type { FilterGroup } from '../../lib/filter-query';
import { selectedSources, sourceColor, toggleSource, viaWord, withSourceSelection } from '../../lib/sources';
import DtIcon from '../DtIcon.vue';
import SourceMark from '../SourceMark.vue';

/** What a browse's state carries for it — or a hand-built list's (`composables/source-filter.ts`). */
interface SourcePickerState {
	sourceFacets: Readonly<Ref<readonly SourceEntry[]>>;
	filterGroup: Ref<FilterGroup>;
}

const props = defineProps<{ state: SourcePickerState }>();

const open = ref(false);
const anchor = ref<HTMLElement | null>(null);

const facets = computed(() => props.state.sourceFacets.value);
const available = computed(() => facets.value.filter((f) => f.installed).map((f) => f.name));
const selected = computed(() => selectedSources(props.state.filterGroup.value));
const isAll = computed(() => selected.value.length === 0);
const total = computed(() => facets.value.reduce((n, f) => n + (f.installed ? f.count : 0), 0));
const title = computed(() => (isAll.value ? 'Sources — showing all' : `Sources — showing ${selected.value.join(', ')}`));

function pickAll(): void {
	props.state.filterGroup.value = withSourceSelection(props.state.filterGroup.value, null);
}

/** A source row's tick: picked — or, with ONE source, always: all of them IS that one. */
function ticked(name: string): boolean {
	return selected.value.includes(name) || (isAll.value && available.value.length === 1);
}

function pick(name: string): void {
	// one source: picking it is picking all, which is what is shown — nothing to change
	if (available.value.length === 1) return;
	props.state.filterGroup.value = toggleSource(props.state.filterGroup.value, name, available.value);
}

/** A row's class and writability in two words: `record layer · writes`, `installed package · read-only`. */
function pickerWords(facet: SourceEntry): string {
	const access = facet.access === 'write' ? 'writes' : facet.access === 'edit' ? 'edits only' : facet.access === 'read' ? 'read-only' : '';
	return [viaWord(facet.via), access].filter(Boolean).join(' · ');
}

/** Open the panel — the Source chip's words call it, so the picker is the chip's editor. */
function show(): void {
	open.value = true;
}
defineExpose({ show });

function onDocumentMousedown(event: MouseEvent): void {
	if (!open.value) return;
	const target = event.target as Node | null;
	if (target && anchor.value?.contains(target)) return;
	open.value = false;
}

function onDocumentKeydown(event: KeyboardEvent): void {
	if (event.key === 'Escape' && open.value) open.value = false;
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
	<div ref="anchor" class="dt-source-picker">
		<button
			type="button"
			class="dt-btn dt-btn--secondary dt-source-picker__trigger"
			:class="{ 'is-active': open }"
			:aria-expanded="open"
			aria-haspopup="listbox"
			:title="title"
			@click="open = !open"
		>
			<template v-if="isAll">
				<DtIcon name="layers" />
				<span class="dt-source-picker__label">All sources</span>
			</template>
			<SourceMark v-else-if="selected.length === 1" class="dt-source-picker__one" :name="selected[0]!" />
			<template v-else>
				<span class="dt-source-picker__dots" aria-hidden="true">
					<span v-for="name in selected" :key="name" class="dt-source-picker__dot" :style="{ background: sourceColor(name) }"></span>
				</span>
				<span class="dt-source-picker__label">{{ selected.length }} sources</span>
			</template>
			<DtIcon class="dt-source-picker__chevron" name="chevron-down" />
		</button>

		<div v-if="open" class="dt-source-picker__panel" role="listbox" aria-multiselectable="true" aria-label="Sources">
			<button type="button" role="option" class="dt-source-picker__row dt-source-picker__all" :aria-selected="isAll" @click="pickAll">
				<span class="dt-source-picker__check"><DtIcon v-if="isAll" name="check" /></span>
				<span class="dt-source-picker__name">All sources</span>
				<span class="dt-source-picker__count">{{ total }}</span>
			</button>
			<template v-for="facet in facets" :key="facet.name">
				<button
					v-if="facet.installed"
					type="button"
					role="option"
					class="dt-source-picker__row"
					:data-source="facet.name"
					:aria-selected="ticked(facet.name)"
					:aria-disabled="available.length === 1"
					@click="pick(facet.name)"
				>
					<span class="dt-source-picker__check"><DtIcon v-if="ticked(facet.name)" name="check" /></span>
					<SourceMark class="dt-source-picker__name" :name="facet.name" :access="facet.access" :via="facet.via" :note="facet.note" />
					<!-- the root's class and whether a write lands there, in words (cr-vscode-004) -->
					<span v-if="facet.access" class="dt-source-picker__access" :data-access="facet.access" :title="facet.note">{{ pickerWords(facet) }}</span>
					<span class="dt-source-picker__count">{{ facet.count }}</span>
				</button>
				<span
					v-else
					class="dt-source-picker__row dt-source-picker__row--absent"
					:data-source="facet.name"
					:title="`${facet.name} is not installed — its records are not read`"
				>
					<span class="dt-source-picker__check"></span>
					<SourceMark class="dt-source-picker__name" :name="facet.name" :access="facet.access" :via="facet.via" :note="facet.note" />
					<span class="dt-source-picker__note">not installed</span>
				</span>
			</template>
		</div>
	</div>
</template>

<style scoped>
.dt-source-picker {
	position: relative;
	display: flex;
}
.dt-source-picker__trigger {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	max-width: 320px;
	overflow: hidden;
}
.dt-source-picker__trigger.is-active {
	border-color: var(--dt-accent);
}
.dt-source-picker__label {
	white-space: nowrap;
}
/* one long name clips with an ellipsis rather than overrunning the chevron */
.dt-source-picker__one {
	min-width: 0;
	overflow: hidden;
}
.dt-source-picker__one :deep(.dt-source-mark__name) {
	overflow: hidden;
	text-overflow: ellipsis;
}
.dt-source-picker__dots {
	display: inline-flex;
	flex-shrink: 0;
}
.dt-source-picker__dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	box-shadow: 0 0 0 1.5px var(--dt-bg);
}
.dt-source-picker__dot + .dt-source-picker__dot {
	margin-left: -3px;
}
.dt-source-picker__chevron {
	color: var(--dt-fg-subtle);
}
/* Anchored under its trigger, right-aligned — the filter panel's technique (BrowseView). */
.dt-source-picker__panel {
	position: absolute;
	top: calc(100% + 6px);
	right: 0;
	z-index: 30;
	min-width: 240px;
	max-height: min(60vh, 480px);
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	padding: 4px;
	background: var(--dt-bg);
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius-lg);
	box-shadow: var(--dt-shadow-lg);
	text-align: left;
}
.dt-source-picker__row {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 8px;
	border: 0;
	border-radius: var(--dt-radius);
	background: transparent;
	color: var(--dt-fg);
	font: inherit;
	text-align: left;
	cursor: pointer;
}
button.dt-source-picker__row:hover:not([aria-disabled='true']) {
	background: var(--dt-bg-hover);
}
button.dt-source-picker__row[aria-disabled='true'] {
	cursor: default;
}
.dt-source-picker__all {
	border-bottom: 1px solid var(--dt-border);
	border-radius: var(--dt-radius) var(--dt-radius) 0 0;
	margin-bottom: 2px;
}
.dt-source-picker__check {
	display: inline-flex;
	width: 16px;
	flex-shrink: 0;
	color: var(--dt-accent);
}
.dt-source-picker__name {
	flex: 1;
	min-width: 0;
}
.dt-source-picker__access {
	color: var(--dt-fg-muted);
	font-size: var(--dt-label);
	white-space: nowrap;
}
.dt-source-picker__count {
	color: var(--dt-fg-subtle);
	font-size: var(--dt-label);
	font-variant-numeric: tabular-nums;
}
.dt-source-picker__row--absent {
	opacity: 0.6;
	cursor: default;
}
.dt-source-picker__note {
	color: var(--dt-fg-muted);
	font-size: var(--dt-label);
}
</style>
