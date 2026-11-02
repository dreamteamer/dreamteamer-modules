<!--
	Owns ONE `useBrowseState` instance (phase E) for a collection's browse — header actions
	(search, filter, batch-delete, create), the `FilterBuilder` popover, active-filter chips, and
	whichever layout renderer (DataTable / ListCards) is active, plus pagination footer. Layout
	switcher / column chooser / saved-views moved into a right-sidebar "Layout options" section
	(see `components/browse/LayoutOptionsSection.vue`) per the spec placement conventions —
	they never lived in the page header at all this wave.

	The browse restyle (BROWSE wave) genericized this component beyond ContentBrowse's per-
	`/content/:path` mount: `collection` is an optional prop (falls back to a `:collection` route
	param for any future router-level binding that supplies one; ContentBrowse always passes it
	explicitly, so the fallback is a safety net, not the primary path). `rowTo` lets a caller
	redirect row-clicks to a bespoke detail page.
-->
<script setup lang="ts">
import { computed, markRaw, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, type RouteLocationRaw } from 'vue-router';
import {
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogOverlay,
	AlertDialogPortal,
	AlertDialogRoot,
	AlertDialogTitle,
} from 'reka-ui';
import CommitButton from './CommitButton.vue';
import FilterBuilder from './FilterBuilder.vue';
import PageHeader from './PageHeader.vue';
import LayoutOptionsSection from './browse/LayoutOptionsSection.vue';
import DensityMenu from './browse/DensityMenu.vue';
import SourcePicker from './browse/SourcePicker.vue';
import TargetChoice from './browse/TargetChoice.vue';
import SourceMark from './SourceMark.vue';
import CommandsSection from './sidebar/CommandsSection.vue';
import type { ItemRecord } from '../api/types';
import { useBrowseState } from '../composables/browse-state';
import { useCollections } from '../composables/collections';
import { useSavedViews } from '../composables/saved-views';
import { useSidebarSections } from '../composables/page-sidebar';
import { displayValue, filterToProse, operatorLabel, operatorTakesPair } from '../lib/filter-query';
import { SOURCE_FIELD, hasForeignSource, isSourceRule, selectedSources, sourceChipLabel, sourceColor } from '../lib/sources';
import { formatTitle } from '../lib/format-title';
import { resolveRendererEntry, resolvePreset, type PresetRecord } from '../lib/presets';
import { lists } from '../registry/index';
import DtIcon from './DtIcon.vue';
import UnknownOptionsHint from './browse/UnknownOptionsHint.vue';

const props = defineProps<{
	collection?: string;
	rowTo?: (record: ItemRecord) => RouteLocationRaw;
	/** ui-view config (UiViewPage): pinned initial layout id. */
	layout?: string;
	/** ui-view config: server filter always applied under the user's own filters. */
	baseFilter?: Record<string, unknown>;
	/** ui-view config: pinned column set + order (skips localStorage selection). */
	columns?: string[];
	/** ui-view config: pinned sort (`field` / `-field`, `''` = explicitly unsorted). */
	sort?: string;
	/** ui-view config: per-List declared option values, keyed by list id — what CORE Lists read off
	 *  `state.listOptions` (kanban's group_by/template, cards' image_fit, …). Distinct from
	 *  `viewOptions` below, which is the module-List `options` prop. */
	listOptions?: Record<string, Record<string, unknown>>;
	/** ui-view `options` — passed to the active List as its `options` prop (beats presets). */
	viewOptions?: Record<string, unknown>;
	/** Page-header title override (a ui-view's nav label). */
	title?: string;
	/** Record id of a NAMED ui-view — lets "Save" in Layout options write back to it. */
	viewId?: string;
	/**
	 * This browse is INSIDE another page — a relation field on a record (`RelationField.vue`),
	 * rather than the page itself. Three things follow, and each of them is a defect if skipped:
	 *
	 *  - **No PageHeader.** The property row's own label already names it, and a second page title
	 *    (with its own search box, filter and create button) parked inside a property row reads as a
	 *    second page rather than as a value.
	 *  - **No sidebar sections.** `useSidebarSections` REPLACES the rail wholesale, so an embedded
	 *    browse registering "Layout options" would delete the record page's own Commands / Info /
	 *    Revisions — and a record with two embedded relations would race for the rail besides.
	 *  - **No URL sync, and its own scratch scope** (see `BrowseViewConfig.urlSync`): the browse
	 *    shares the record's route but does not own it.
	 *
	 * Everything else is unchanged — the same layout registry, the same view/`display.list` column
	 * resolution, the same grouping, the same server-side paging and the same pager.
	 */
	embedded?: boolean;
	/** A filter the PAGE narrows by, under everything the operator does and never shown as a rule of
	 *  theirs — the Schema tab opened on one module (`lib/module-scope.ts`). Opaque, like an embedded
	 *  browse's base filter. */
	scopeFilter?: Record<string, unknown>;
}>();

const route = useRoute();

// Route-param fallback: only ever exercised by a router binding that passes `:collection` as a
// path param instead of an explicit `props` function — ContentBrowse passes `collection`
// explicitly.
const collection = computed(() => props.collection ?? (typeof route.params['collection'] === 'string' ? route.params['collection'] : ''));

// `useBrowseState`/`useSavedViews` are read once at setup time, same "destroy/recreate on
// collection change" contract as before (ContentBrowse/router.ts mount this component with a
// `:key` tied to the collection so a change always remounts fresh rather than reusing state).
// A NAMED view arrives as props (UiViewPage pins its layout/filter/columns); a bare
// /content/<collection> is the collection's OWN display — its `display.list` seeds the browse in
// `useBrowseState` (`lib/list-seed.ts`), so there is no default view record to resolve here.
const state = useBrowseState(collection.value, props.rowTo, {
	layout: props.layout,
	baseFilter: props.scopeFilter ?? props.baseFilter,
	columns: props.columns,
	// `??`-safe: a view that says "unsorted" stores `''`, which must beat the collection's sort.
	sort: props.sort,
	listOptions: props.listOptions,
	viewId: props.viewId,
	urlSync: !props.embedded,
	...(props.embedded ? { scratchScope: 'embedded', baseFilterOpaque: true } : {}),
	...(props.scopeFilter ? { baseFilterOpaque: true } : {}),
});
const savedViews = useSavedViews(collection.value);

// ---- List resolution through the registry (spec §8) -------------------------------------------
// The List the browse renders is resolved from the registry by id (`state.layout` — 'table'/
// 'cards' or a module-provided List), degrading to the built-in table if the id names an
// unregistered List (e.g. a module that failed to load — resolveRendererEntry warns).
const listRendererEntry = computed(() => resolveRendererEntry(state.layout.value, 'list'));

/**
 * The view names a layout no registry has. The engine no longer rejects this at compile (decision
 * 195: it validates what it interprets, and it never interprets `layout`), so telling the operator
 * is THIS surface's job — and a `console.warn` is not telling anyone. Usually a module whose
 * `ui/app.js` failed to load, or a plain typo.
 */
const unregisteredLayout = computed(() => {
	const id = state.layout.value;
	return id && id !== 'table' && !lists.get(id) ? id : null;
});

// A List that declares `fillsHeight` (the kanban) gets a height-constrained box and owns its own
// scrolling; the page's vertical scrollbar disappears for the duration. Everything else keeps
// growing the page as before — see ListDefinition.fillsHeight.
const listFillsHeight = computed(() => (listRendererEntry.value as { fillsHeight?: boolean }).fillsHeight === true);
// A List that SUMMARIZES every row (`counts`) has no page to turn — no pager under it.
const listSummarizes = computed(() => (listRendererEntry.value as { summarizes?: boolean }).summarizes === true);

// A `.schema/presets` record marked default (workspace-local beats module-shipped, see
// lib/presets.ts) seeds the initial List + its `options` for this collection. Applied once, the
// first time the preset records load, and only when the URL didn't explicitly pin a layout (?layout=…).
const listPreset = ref<PresetRecord | undefined>();
const listOptions = computed<Record<string, unknown>>(() => props.viewOptions ?? listPreset.value?.options ?? {});
// Module Lists (spec §8) own their own fetching from (collection, query, options); the
// built-in table/cards read `state` instead. Both prop sets are provided — built-ins declare
// `inheritAttrs: false`, so the extras they ignore never leak onto their root element.
// `query.filter` is the EFFECTIVE server filter (`items.filter` — base ui-view filter + the
// user's compiled rules), so a module List can pass it straight to `?filter=` on the records API.
const listQuery = computed(() => ({ search: state.items.search.value, filter: state.items.filter.value, sort: state.items.sort.value }));

let defaultApplied = false;
watch(
	() => savedViews.records.value,
	(records) => {
		if (defaultApplied || !records.length) return;
		defaultApplied = true;
		const resolved = resolvePreset(records, collection.value, 'list');
		if (resolved.preset) {
			listPreset.value = resolved.preset;
			// A ui-view's pinned layout (props.layout) beats a preset default, as does an explicit URL.
			if (!route.query['layout'] && !props.layout && resolved.rendererId) state.setLayout(resolved.rendererId);
		}
	},
	{ immediate: true },
);

// `state`/`savedViews` must be `markRaw`'d before going into `props`: the sidebar store's
// `sections` is a plain `ref([])` (composables/page-sidebar.ts), so anything pushed into it gets
// deep-reactive-wrapped — and Vue's reactive() proxy auto-unwraps top-level ref PROPERTIES of a
// wrapped object (e.g. `state.layout` would silently become the raw string instead of the Ref),
// which breaks every `.value` access this composable's callers rely on. `markRaw` keeps the
// composable-instance objects themselves un-proxied so their own refs stay refs; the refs' own
// reactivity is independent of their container and works exactly the same either way.
// Commands first (operator ask 2026-07-27): collection-target commands are always runnable;
// record-target commands evaluate over the checkbox SELECTION (a live computed ref — the
// section re-fetches, debounced, as rows are ticked). Single top-level ref, per the
// double-unwrap note above.
const selectedIdList = computed(() => [...state.selectedIds.value]);
// ⚠ Guarded, not merged: registration REPLACES the rail (composables/page-sidebar.ts), so an
// embedded browse would wipe the record page's own sections. See the `embedded` prop.
if (!props.embedded) useSidebarSections([
	{
		id: 'commands',
		title: 'Commands',
		icon: 'terminal',
		component: markRaw(CommandsSection),
		props: { collection: collection.value, ids: selectedIdList },
	},
	{
		id: 'layout-options',
		title: 'Layout options',
		icon: 'tune',
		component: markRaw(LayoutOptionsSection),
		props: { state: markRaw(state), collection: collection.value },
	},
]);

// ---- header title / breadcrumb (namespace segment → breadcrumb, last segment → title) --------
// Polish wave defect 9: PageHeader's icon used to be hardcoded 'database' for every collection —
// `useCollections().tree` is the same module-level-cached `/collections` fetch NavSidebar/
// DataModelList already read `meta.icon` from (server commit 32bb83f), so this just looks up this
// browse's own collection in it rather than re-fetching.
const { tree: collectionTree } = useCollections();
const collectionRow = computed(() => collectionTree.value.find((row) => row.collection === collection.value));
const collectionIcon = computed(() => collectionRow.value?.nav.icon ?? 'database');

const collectionSegments = computed(() => collection.value.split('/').filter(Boolean));
// the collection's own label, resolved by the engine's compile — `formatTitle` is the fallback for
// a path segment that names no registered collection.
const pageTitle = computed(
	() =>
		props.title ??
		collectionRow.value?.title ??
		formatTitle(collectionSegments.value[collectionSegments.value.length - 1] ?? collection.value),
);
const breadcrumb = computed(() => {
	const segments = collectionSegments.value;
	return segments.length > 1 ? [{ label: segments.slice(0, -1).join('/') }] : [];
});

// ---- search: icon button that expands into an input, collapses again once emptied on blur -----
const searchOpen = ref(false);
const searchInputEl = ref<HTMLInputElement | null>(null);
const searchExpanded = computed(() => searchOpen.value || Boolean(state.searchInput.value));

function openSearch(): void {
	searchOpen.value = true;
	void nextTick(() => searchInputEl.value?.focus());
}

function onSearchBlur(): void {
	if (!state.searchInput.value) searchOpen.value = false;
}

// ---- active-filter chips ---------------------------------------------------------------------
// Labels come from `lib/filter-query.ts`'s shared `operatorLabel`. This used to be a hand-copy of
// FilterBuilder's private map, and it drifted the moment the operator set grew — a `_between` rule
// showed as the raw "Date _between …" on the chip while the dropdown said "is between".
// The collection reads anything SHARED — a layer, a module-owned list, one source or many: the source
// picker sits beside the filter button, ONE control for every such collection (operator 2026-10-29: a
// module-owned list still drew 0.24.0's "shared from …" line while a layered one drew the picker).
const sourcePicker = computed(() => !props.embedded && hasForeignSource(state.sources.value));
const sourcePickerEl = ref<{ show: () => void } | null>(null);
// EVERY rule is a chip and counts on the badge — the picker's `$source` rule included (cr-vscode-004:
// "why isn't source filter displayed as standard filter bubble below collection name?"). It used to be
// the picker's alone to show, so a narrowed list said so only in the picker's closed state. The rule
// draws as ONE chip whatever it names (`Source is project-a · project-b`, decision 2026-10-31), its ×
// removes it like any rule, and a click on its words opens the picker, which is the chip's editor.
const chipRules = computed(() => state.filterGroup.value.rules);

const filterChips = computed(() =>
	chipRules.value.map((rule) => {
		if (isSourceRule(rule)) {
			const names = selectedSources({ logic: '_and', rules: [rule] });
			return { id: rule.id, label: sourceChipLabel(names), sources: names };
		}
		const operator = operatorLabel(rule.operator);
		const hasValue = Array.isArray(rule.value)
			? rule.value.length > 0
			: rule.value !== '' && rule.value !== null && rule.value !== undefined;
		// A range reads as "a → b"; every other multi-value operator is a plain comma list.
		const value = Array.isArray(rule.value)
			? rule.value.map(displayValue).join(operatorTakesPair(rule.operator) ? ' → ' : ', ')
			: displayValue(rule.value);
		return { id: rule.id, label: `${pathLabel(rule.field)} ${operator}${hasValue ? ' ' + value : ''}`, sources: null as string[] | null };
	}),
);

/** A click on the Source chip's words: the picker is its editor. */
function editSourceChip(): void {
	sourcePickerEl.value?.show();
}

/**
 * A field PATH as the operator reads it: `person.name` → `Person › Name`.
 *
 * Each segment gets the label the collection actually authored where we know it (the root segment is
 * a real field of this collection); deeper segments fall back to title-casing, because their fields
 * belong to another collection whose rows this component has not fetched. `›` rather than `.` so a
 * path reads as a route through records instead of as a property access.
 */
function pathLabel(path: string): string {
	// `$source` is the extension's own column, offered only while the collection reads a foreign
	// source — a rule on it can outlive that (a layer's nav row, after the layer is uninstalled)
	if (path === SOURCE_FIELD) return 'Source';
	const segments = path.split('.');
	const root = state.fields.visibleFields.value.find((f) => f.field === segments[0]);
	const head = root?.title ?? formatTitle(segments[0] ?? '');
	return [head, ...segments.slice(1).map((s) => formatTitle(s))].join(' › ');
}

/**
 * The filter in words, for the button's tooltip — `Flag is any of high, low, abnormal, positive`.
 * A plain function, no model involved: it has to be instant and identical every time.
 */
const filterTooltip = computed(() => {
	const prose = filterToProse(state.filterGroup.value, pathLabel);
	return prose ? `Filtered — ${prose}` : 'Filter';
});

function removeFilterChip(id: string): void {
	state.filterGroup.value = { ...state.filterGroup.value, rules: state.filterGroup.value.rules.filter((r) => r.id !== id) };
}

function clearFilters(): void {
	state.filterGroup.value = { ...state.filterGroup.value, rules: [] };
}

// ---- filter panel: floats, never reflows the page --------------------------------------------
// It used to be an in-flow block between the header and the table, so opening it shoved every row
// down by its height (operator 2026-07-28). Now it's `position: absolute` under its own trigger
// button — the same anchored-popover technique EditRelation.vue uses, and for the same reason its
// header documents: reka-ui's Popover teleports content to <body>, which buys nothing for a
// button-anchored panel and costs the usual portal z-index/position math. Directus's filter drops
// out of the search box exactly this way (`search-input.vue`'s `.filter { position: absolute }`).
const filterAnchorEl = ref<HTMLElement | null>(null);

function onDocumentMousedown(event: MouseEvent): void {
	if (!state.filterOpen.value) return;
	const target = event.target as Node | null;
	if (target && filterAnchorEl.value?.contains(target)) return;
	state.filterOpen.value = false;
}

function onDocumentKeydown(event: KeyboardEvent): void {
	if (event.key === 'Escape' && state.filterOpen.value) state.filterOpen.value = false;
}

onMounted(() => {
	document.addEventListener('mousedown', onDocumentMousedown);
	document.addEventListener('keydown', onDocumentKeydown);
});

onUnmounted(() => {
	document.removeEventListener('mousedown', onDocumentMousedown);
	document.removeEventListener('keydown', onDocumentKeydown);
});

// ---- batch delete (danger button appears in the header actions once rows are selected) --------
const confirmDeleteOpen = ref(false);

async function onConfirmDelete(): Promise<void> {
	await state.deleteSelected();
	confirmDeleteOpen.value = false;
}
</script>

<template>
	<div class="dt-browse" :class="{ 'dt-browse--fill': listFillsHeight, 'dt-browse--embedded': embedded }">
		<PageHeader v-if="!embedded" :icon="collectionIcon" :title="pageTitle" :breadcrumb="breadcrumb">
			<template #search>
				<div class="dt-browse-search">
					<button v-if="!searchExpanded" type="button" class="dt-btn dt-btn--ghost dt-btn--icon dt-btn--sm" title="Search" @click="openSearch">
						<DtIcon name="search" />
					</button>
					<label v-else class="dt-browse-search-field">
						<DtIcon class="dt-browse-search-icon" name="search" />
						<input
							ref="searchInputEl"
							class="dt-browse-search-input"
							type="search"
							placeholder="Search…"
							:value="state.searchInput.value"
							@input="state.onSearchInput(($event.target as HTMLInputElement).value)"
							@blur="onSearchBlur"
						/>
					</label>
				</div>
			</template>

			<!-- Leftmost of the actions and absent unless something is pending: publishing is a
			     workspace-wide fact that showed up here, not this collection's own gesture. The
			     reload afterwards is for `last-modified`, which is read off git. -->
			<CommitButton @committed="state.items.reload()" />

			<SourcePicker v-if="sourcePicker" ref="sourcePickerEl" :state="state" />

			<div ref="filterAnchorEl" class="dt-browse-filter">
				<button
					type="button"
					class="dt-btn dt-btn--secondary dt-btn--icon"
					:class="{ 'is-active': state.filterOpen.value }"
					:title="filterTooltip"
					@click="state.filterOpen.value = !state.filterOpen.value"
				>
					<DtIcon name="filter" />
					<span v-if="chipRules.length" class="dt-browse-filter-badge">{{ chipRules.length }}</span>
				</button>

				<div v-if="state.filterOpen.value" class="dt-browse-filter-panel">
					<div class="dt-browse-filter-panel-head">
						<span class="dt-browse-filter-panel-title">Filter</span>
						<button v-if="state.filterGroup.value.rules.length" type="button" class="dt-btn dt-btn--ghost dt-btn--sm" @click="clearFilters">Clear all</button>
						<button type="button" class="dt-btn dt-btn--ghost dt-btn--icon dt-btn--sm" aria-label="Close filter" @click="state.filterOpen.value = false">
							<DtIcon name="close" />
						</button>
					</div>
					<FilterBuilder
						v-model="state.filterGroup.value"
						:fields="state.fields.visibleFields.value"
						:relation-targets="state.fields.relationTargets.value"
						:collection="collection"
					/>
				</div>
			</div>

			<!-- Row density, for the table alone: the one layout whose rows have a height to choose. It
			     writes the table's `row_size` option — the Layout options drawer shows the same pick. -->
			<DensityMenu v-if="state.layout.value === 'table'" :state="state" />

			<span v-if="state.selectedIds.value.size" class="dt-browse-selection-count">{{ state.selectedIds.value.size }} selected</span>

			<button
				v-if="state.selectedIds.value.size"
				type="button"
				class="dt-btn dt-btn--danger dt-btn--icon"
				title="Delete selected"
				:disabled="state.deleting.value"
				@click="confirmDeleteOpen = true"
			>
				<DtIcon name="trash" />
			</button>

			<!-- `createRecord()`, not `createRecord`: it takes an optional prefill object now, and a
			     bare handler reference would hand it the MouseEvent. Where several roots take a new record
			     it opens the TARGET CHOICE under this button first (cr-vscode-004); every other "Create
			     record" button, the kanban column's + included, opens the same popover here. -->
			<div class="dt-browse-create">
				<button type="button" class="dt-btn dt-btn--icon" title="Create" :aria-expanded="!!state.pendingCreate.value" @click="state.pendingCreate.value ? state.cancelCreate() : state.createRecord()">
					<DtIcon name="add" />
				</button>
				<TargetChoice v-if="state.pendingCreate.value" :choice="state.pendingCreate.value.choice" @pick="state.chooseTarget" @cancel="state.cancelCreate" />
			</div>
		</PageHeader>

		<!-- An EMBEDDED browse (a relation on a record page) has no header and so no + to hang the target
		     choice from — but its lists' own create gestures (a kanban column's +, the empty state's
		     "Create record") still call `createRecord()`, which asks first on two writable roots. The
		     choice draws HERE, at the top of the embedded list, so the click is never swallowed
		     (cr-vscode-004 review, embedded-browse-create-goes-dead). -->
		<div v-if="embedded && state.pendingCreate.value" class="dt-browse-target-anchor">
			<TargetChoice :choice="state.pendingCreate.value.choice" @pick="state.chooseTarget" @cancel="state.cancelCreate" />
		</div>

<!-- a record just created from this list, which the Sources selection would have hidden: the
     selection widened to its root (`lib/created-visibility.ts`), said once -->
<p v-if="state.createdNotice.value" class="dt-browse-created" data-created-notice>
	<span>Showing</span>
	<SourceMark :name="state.createdNotice.value.source" />
	<span>too — the new record {{ state.createdNotice.value.id }} was saved there.</span>
	<button type="button" class="dt-btn dt-btn--ghost dt-btn--icon dt-btn--sm" title="Dismiss" @click="state.createdNotice.value = null">
		<DtIcon name="close" />
	</button>
</p>
<div v-if="filterChips.length" class="dt-browse-chips">
			<span v-for="chip in filterChips" :key="chip.id" class="dt-chip" :class="{ 'dt-chip--source': chip.sources }" :data-source-chip="chip.sources ? chip.sources.join(',') : undefined">
				<template v-if="chip.sources">
					<button type="button" class="dt-chip__edit" :title="sourcePicker ? 'Change the sources' : chip.label" @click="editSourceChip">
						<span v-for="name in chip.sources" :key="name" class="dt-chip__dot" :style="{ background: sourceColor(name) }" aria-hidden="true"></span>
						{{ chip.label }}
					</button>
				</template>
				<template v-else>{{ chip.label }}</template>
				<button type="button" class="dt-chip__remove" aria-label="Remove filter" @click="removeFilterChip(chip.id)">
					<DtIcon name="close" />
				</button>
			</span>
		</div>

		<div class="dt-page-body" :class="{ 'dt-page-body--fill': listFillsHeight }">
			<p v-if="state.fields.error.value || state.items.error.value" class="dt-browse-error">{{ state.fields.error.value || state.items.error.value }}</p>

			<p v-if="unregisteredLayout" class="dt-browse-degraded">
				<DtIcon name="info" />
				layout <code>{{ unregisteredLayout }}</code> isn’t registered — showing the table instead. A module
				that provides it may have failed to load.
			</p>
			<!-- one level down: the layout IS registered but the view names an option this build does not
			     declare for it (lane_by on a pre-lanes build, or a typo). Quiet when the layout itself is
			     unregistered — that is the hint above. -->
			<UnknownOptionsHint :layout="state.layout.value" :options="state.listOptions.value[state.layout.value]" />

			<!-- Wrapper so a `fillsHeight` List can be handed the page's leftover height without this
			     component knowing which List it is (and without a positional CSS selector). -->
			<div class="dt-browse-list" :class="{ 'dt-browse-list--fill': listFillsHeight }">
				<component :is="listRendererEntry.component" :state="state" :collection="collection" :query="listQuery" :options="listOptions" />
			</div>

			<footer v-if="!listSummarizes" class="dt-browse-footer">
				<!-- Refetch indicator lives HERE, not over the table: swapping the rows for a big
				     loading block on every filter/sort/page shifted the whole layout. A fixed-width
				     slot (visibility, not v-if) so the pager itself never moves either. -->
				<span class="dt-browse-spinner" :class="{ 'is-loading': state.items.loading.value }" aria-hidden="true">
					<DtIcon name="loading" />
				</span>
				<span class="dt-browse-count">{{ state.from.value }}–{{ state.to.value }} of {{ state.items.total.value }}</span>
				<button type="button" class="dt-btn dt-btn--secondary dt-btn--sm dt-btn--icon" :disabled="!state.hasPrev.value" @click="state.prevPage">
					<DtIcon name="chevron-left" />
				</button>
				<button type="button" class="dt-btn dt-btn--secondary dt-btn--sm dt-btn--icon" :disabled="!state.hasNext.value" @click="state.nextPage">
					<DtIcon name="chevron-right" />
				</button>
			</footer>
		</div>

		<AlertDialogRoot v-model:open="confirmDeleteOpen">
			<AlertDialogPortal>
				<AlertDialogOverlay class="dt-dialog-overlay" />
				<AlertDialogContent class="dt-dialog">
					<AlertDialogTitle class="dt-dialog__title">Delete {{ state.selectedIds.value.size }} record(s)?</AlertDialogTitle>
					<AlertDialogDescription class="dt-browse-confirm-copy">This can't be undone.</AlertDialogDescription>
					<div class="dt-browse-confirm-actions">
						<AlertDialogCancel as-child>
							<button type="button" class="dt-btn dt-btn--secondary">Cancel</button>
						</AlertDialogCancel>
						<AlertDialogAction as-child>
							<button type="button" class="dt-btn dt-btn--danger" @click="onConfirmDelete">Delete</button>
						</AlertDialogAction>
					</div>
				</AlertDialogContent>
			</AlertDialogPortal>
		</AlertDialogRoot>
	</div>
</template>

<style scoped>
.dt-browse {
	display: flex;
	flex-direction: column;
	min-height: 100%;
}

/* EMBEDDED in a property row: it is a VALUE, not a page. No page-height floor (it is exactly as
   tall as its rows) and no page padding (the property row already supplies the inset).
   ⚠ And deliberately NO max-height. The first cut capped it at 60vh with `overflow: auto`, which
   read fine in a screenshot and was wrong in the hand: the nested scroller swallowed the wheel over
   the table, so the page stopped short and the embedded PAGER — the thing "apply all settings
   including paging" is about — sat below the fold, unreachable (measured in the dev host over a
   52-row relation). PAGE SIZE is what bounds the height, and it comes from the view. One scrollbar
   per screen. */
.dt-browse--embedded {
	min-height: 0;
}

.dt-browse--embedded .dt-page-body {
	padding: 0;
}

.dt-browse--embedded .dt-browse-footer {
	margin-top: 8px;
}

/* `fillsHeight` List (the kanban): the browse box is exactly as tall as the page area and never
   taller, so the PAGE stops scrolling vertically and the List scrolls its own innards instead.
   `min-height: 0` is what lets a flex item shrink below its content — without it the box would
   still grow and the page scrollbar would come back. */
.dt-browse--fill {
	flex: 1 1 auto;
	min-height: 0;
	overflow: hidden;
}

/* The list gets everything the header, chips and pager don't: `flex: 1; min-height: 0` on the body,
   and the list itself is the only child that may consume the slack. Keeps `--dt-page-pad` intact,
   so the gap above the board (and below it, before the pager) is the page padding it always was. */
.dt-page-body--fill {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	overflow: hidden;
}

.dt-browse-list--fill {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
}

/* The List's own root is the thing that must fill the slack (the kanban's wrap element). */
.dt-browse-list--fill > * {
	flex: 1 1 auto;
	min-height: 0;
}

.dt-browse-search {
	display: flex;
	justify-content: flex-end;
}

.dt-browse-search-field {
	display: flex;
	align-items: center;
	gap: var(--dt-space-1);
	width: 260px;
	height: var(--dt-control-height);
	padding: 0 var(--dt-space-2);
	border: 1px solid var(--dt-border-strong);
	border-radius: var(--dt-radius);
	background: var(--dt-bg-subtle);
}

.dt-browse-search-field:focus-within {
	background: var(--dt-bg);
	border-color: var(--dt-accent);
}

.dt-browse-search-icon {
	font-size: var(--dt-icon);
	color: var(--dt-fg-subtle);
}

.dt-browse-search-input {
	flex: 1 1 auto;
	min-width: 0;
	border: none;
	background: none;
	outline: none;
	font: inherit;
	font-size: var(--dt-text);
	color: var(--dt-fg);
}

.dt-btn--icon.is-active {
	background: var(--dt-accent-subtle);
	color: var(--dt-accent);
}

.dt-browse-filter-badge {
	position: absolute;
	top: 4px;
	right: 4px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 16px;
	height: 16px;
	padding: 0 4px;
	border-radius: 999px;
	background: var(--dt-accent);
	color: #fff;
	font-size: var(--dt-label);
	font-weight: 700;
}

.dt-btn--icon {
	position: relative;
}

.dt-browse-selection-count {
	font-size: var(--dt-text);
	color: var(--dt-fg-subtle);
	white-space: nowrap;
}

.dt-browse-created {
	display: flex;
	align-items: center;
	gap: 6px;
	margin: 12px 32px 0;
	font-size: var(--dt-text);
	color: var(--dt-fg-muted);
}

.dt-browse-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	padding: 12px 32px 0;
}

/* the Source chip (cr-vscode-004): its words open the picker, its dots are the sources' own colours */
.dt-chip__edit {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 0;
	border: 0;
	background: transparent;
	color: inherit;
	font: inherit;
	cursor: pointer;
}
.dt-chip__edit:hover {
	text-decoration: underline;
}
.dt-chip__dot {
	width: 7px;
	height: 7px;
	border-radius: 50%;
	flex-shrink: 0;
}

.dt-browse-filter {
	position: relative;
	display: flex;
}

/* an embedded browse's target choice: hung from a zero-height strip at the top of the list, so it
   floats over the rows like the header's popover does rather than pushing them down */
.dt-browse-target-anchor {
	position: relative;
	height: 0;
	z-index: 30;
}

/* the + and the target choice it anchors (cr-vscode-004) */
.dt-browse-create {
	position: relative;
	display: flex;
}

/* Right-aligned to its trigger and pinned above the table. The page header is `position: sticky;
   z-index: 10` (PageHeader.vue) and clips nothing, so this paints over the rows below without
   needing a portal. `overflow-y: auto` caps a long rule list at the viewport — the trade-off is
   that a relation picker's own popover clips at the panel edge when it opens near the bottom;
   scrolling brings it into view, which beat letting 15 rules run off-screen entirely. The cap is
   set high enough (720px) that a couple of rules plus a fully-open record picker never scroll —
   at the first 560px cap the picker's list was visibly cut off with a single rule on screen. */
.dt-browse-filter-panel {
	position: absolute;
	top: calc(100% + 6px);
	right: 0;
	z-index: 30;
	width: 480px;
	max-width: calc(100vw - 32px);
	max-height: min(80vh, 720px);
	overflow-y: auto;
	background: var(--dt-bg);
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius-lg);
	box-shadow: var(--dt-shadow-lg);
	padding: 12px;
	text-align: left;
}

.dt-browse-filter-panel-head {
	display: flex;
	align-items: center;
	gap: 4px;
	margin-bottom: 10px;
}

.dt-browse-filter-panel-title {
	flex: 1;
	font-size: var(--dt-text);
	font-weight: 600;
	color: var(--dt-fg);
}

.dt-browse-degraded {
	display: flex;
	align-items: center;
	gap: 6px;
	margin: 0 0 12px;
	padding: 8px 12px;
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius);
	background: var(--dt-bg-subtle);
	color: var(--dt-fg-muted);
	font-size: 12px;
}
.dt-browse-degraded .codicon {
	font-size: 16px;
	color: var(--dt-warning);
}
.dt-browse-error {
	color: var(--dt-danger);
	margin-bottom: 12px;
}

.dt-browse-footer {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 8px;
	margin-top: 16px;
	color: var(--dt-fg-subtle);
	font-size: var(--dt-text);
}

.dt-browse-spinner {
	width: 20px;
	height: 20px;
	visibility: hidden;
}

.dt-browse-spinner.is-loading {
	visibility: visible;
}

.dt-browse-spinner .codicon {
	font-size: var(--dt-icon);
	color: var(--dt-accent);
	animation: dt-spin 0.9s linear infinite;
	display: inline-block;
}

@keyframes dt-spin {
	to {
		transform: rotate(360deg);
	}
}

.dt-browse-confirm-copy {
	font-size: var(--dt-text);
	color: var(--dt-fg-subtle);
	margin-bottom: 20px;
}

.dt-browse-confirm-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
}
</style>
