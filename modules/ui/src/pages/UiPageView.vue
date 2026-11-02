<!--
	A PAGE ui-view — one that NESTS other ui-views as panels (cr: nested ui-views; decision: dashboards
	are nested ui-views, not a panel vocabulary). Registered by `ui-views.ts` for a `scope: page` view
	whose layout is `page` or `activity`, and drawn by the Schema tab as a module's page
	(`ModulePage.vue`) when a page view names that module.

	What it draws is decided by `lib/page-view.ts` (pure, tier 1): one panel per entry of
	`display.list.options.views`, in a grid of `options.grid_columns` (1 or 2) columns. Each panel IS the
	child view — a collection view through the embedded browse in its own layout (table, kanban,
	cards, counts…), an activity view through the module page's own `ActivityPane`, a nested PAGE as a
	grid of its own panels with no frame around it (a column of counts beside an activity feed is a page
	nested in a page). Each framed panel has the child's title, linking to its full view. A reference
	that names no view, a cycle, or a child a panel cannot draw is refused IN ITS PANEL, by its
	reference — never a blank page, never its siblings taken down.

	`source` scopes the whole page to one record layer (a module folder clicked INSIDE that layer's
	nav folder): every collection panel is narrowed by `$source is <layer>` — opaque, the panel's scope
	rather than a rule of the operator's — the activity reads only that layer's repo, and every link
	out carries the scope as an ordinary removable rule (`PAGE_SOURCE`, read by `ListCounts`).

	`viewId`, not the record: the record is looked up LIVE (`resolvedUiView`), so an edited page or child
	reaches an open tab — the same reason `UiViewPage` takes an id. Each embedded browse is keyed on its
	child's fingerprint, because a browse reads its config once at setup.
-->
<script setup lang="ts">
import { computed, provide, toRef } from 'vue';
import BrowseView from '../components/BrowseView.vue';
import DtIcon from '../components/DtIcon.vue';
import DtLink from '../components/DtLink.vue';
import SourceMark from '../components/SourceMark.vue';
import ActivityPane from './ActivityPane.vue';
import { viewToConfig } from '../composables/collection-views';
import { ACTIVITY_LAYOUT, gridColumns, listLayout, listOptionsOf, PAGE_SOURCE, pageOrigin, pagePanels, panelLink, scopedFilter, type PanelPlan } from '../lib/page-view';
import { useModules } from '../composables/modules';
import { collectionOf, drawnDisplay, resolvedUiView, uiViewFingerprint, uiViews, viewLabel, type UiViewRecord } from '../ui-views';

const props = withDefaults(
	defineProps<{
		viewId: string;
		/** A record layer the page is scoped to — `$source is <layer>` on every panel. */
		source?: string;
		/** Drawn inside another page: no heading, no page padding — the grid alone. */
		nested?: boolean;
		/** The ids of the pages above this one, outermost first — what a cycle is detected against. */
		ancestry?: string[];
	}>(),
	{ source: undefined, nested: false, ancestry: () => [] },
);

provide(PAGE_SOURCE, toRef(props, 'source'));

const view = computed(() => resolvedUiView(props.viewId));
const layout = computed(() => (view.value ? listLayout(view.value) : undefined));
const panels = computed<PanelPlan[]>(() => (view.value ? pagePanels(view.value, uiViews.value, props.ancestry) : []));
const columns = computed(() => (view.value ? gridColumns(view.value) : 1));
/** An activity view opened on its own route: the module's feed, the page around it. */
const activityModule = computed(() => {
	const m = view.value ? listOptionsOf(view.value)['module'] : undefined;
	return typeof m === 'string' && m ? m : undefined;
});

/** Each collection child as the embedded browse needs it, by panel index (undefined for the rest). */
const browses = computed(() => panels.value.map((p) => (p.kind === 'view' ? browseOf(p.view) : undefined)));

/** The module's own title for the activity lead — "Commits to R&D", never the view's title
 *  ("Commits to Activity", review 2026-10-31). The id when the module records have not loaded. */
const { modules } = useModules();
const activityTitle = computed(() => modules.value.find((m) => m.id === activityModule.value)?.title || activityModule.value);

/** A collection child as the embedded browse needs it — `@me` resolved, the page's scope applied. */
function browseOf(child: UiViewRecord) {
	const live = resolvedUiView(child.id) ?? child;
	const config = viewToConfig(live);
	return {
		key: `${uiViewFingerprint(live)}::${props.source ?? ''}`,
		collection: collectionOf(live),
		layout: config.layout,
		columns: config.columns,
		sort: config.sort,
		listOptions: config.listOptions,
		viewOptions: drawnDisplay(live).list?.options,
		baseFilter: scopedFilter(live.filter, props.source),
		title: viewLabel(live),
		viewId: live.id,
	};
}
</script>

<template>
	<div v-if="!view" class="dt-empty">
		<DtIcon name="dashboard" />
		<p class="dt-empty__line">ui-view '{{ viewId }}' no longer exists</p>
	</div>
	<div v-else-if="layout === ACTIVITY_LAYOUT && !nested" class="dt-page-view dt-page-view--activity">
		<ActivityPane :module="activityModule" :module-title="activityTitle" :source="source" />
	</div>
	<div v-else class="dt-page-view" :class="{ 'dt-page-view--nested': nested }" :data-view="view.id">
		<header v-if="!nested" class="dt-page-view__head">
			<h2 class="dt-page-view__title">{{ viewLabel(view) }}</h2>
			<p v-if="view.description" class="dt-page-view__lead">{{ view.description }}</p>
			<p v-if="source" class="dt-page-view__scope">Records from <SourceMark :name="source" /></p>
			<p class="dt-page-view__origin" :title="'The page view drawn here — the nearest one naming this module wins: the workspace\'s own, then a layer\'s, then a package\'s'">{{ pageOrigin(view) }}</p>
		</header>
		<p v-if="!panels.length" class="dt-page-view__empty">This page nests no views yet — list them in <code>display.list.options.views</code>.</p>
		<div v-else class="dt-page-view__grid" :data-columns="columns" :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }">
			<template v-for="(p, i) in panels" :key="`${i}:${p.ref}`">
				<UiPageView v-if="p.kind === 'page'" class="dt-page-view__cell" :view-id="p.view.id" :source="source" :nested="true" :ancestry="[...ancestry, view.id]" />
				<section v-else class="dt-panel" :data-ref="p.ref" :data-kind="p.kind">
					<header class="dt-panel__head">
						<DtLink v-if="p.kind !== 'refused'" class="dt-panel__title" :to="panelLink(p.view, source)" :title="`Open ${viewLabel(p.view)}`">{{ viewLabel(p.view) }}</DtLink>
						<span v-else class="dt-panel__title">{{ p.ref }}</span>
					</header>
					<p v-if="p.kind === 'refused'" class="dt-panel__refused"><DtIcon name="warning" /> {{ p.reason }}</p>
					<ActivityPane v-else-if="p.kind === 'activity'" :module="p.module" :source="source" embedded />
					<BrowseView
						v-else
						:key="browses[i]!.key"
						embedded
						:collection="browses[i]!.collection"
						:layout="browses[i]!.layout"
						:columns="browses[i]!.columns"
						:sort="browses[i]!.sort"
						:list-options="browses[i]!.listOptions"
						:view-options="browses[i]!.viewOptions"
						:base-filter="browses[i]!.baseFilter"
						:title="browses[i]!.title"
						:view-id="browses[i]!.viewId"
					/>
				</section>
			</template>
		</div>
	</div>
</template>

<style scoped>
.dt-page-view {
	padding: var(--dt-page-pad, 24px);
	display: flex;
	flex-direction: column;
	gap: 16px;
	overflow-y: auto;
}
.dt-page-view--nested {
	padding: 0;
	overflow: visible;
}
.dt-page-view__title {
	margin: 0 0 4px;
	font-size: calc(var(--dt-text) + 2px);
	font-weight: 600;
}
.dt-page-view__lead,
.dt-page-view__scope,
.dt-page-view__origin,
.dt-page-view__empty {
	margin: 0;
	color: var(--dt-fg-subtle);
	font-size: var(--dt-text);
}
.dt-page-view__grid {
	display: grid;
	gap: 16px;
	align-items: start;
}
.dt-page-view__cell {
	min-width: 0;
}
.dt-panel {
	min-width: 0;
	padding: 12px;
	border: 1px solid var(--dt-border);
	border-radius: 4px;
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.dt-panel__head {
	display: flex;
	align-items: center;
	gap: 8px;
}
.dt-panel__title {
	font-weight: 600;
	color: var(--dt-fg);
	text-decoration: none;
}
a.dt-panel__title:hover {
	color: var(--vscode-textLink-foreground, var(--dt-link));
	text-decoration: underline;
}
.dt-panel__refused {
	margin: 0;
	display: flex;
	align-items: center;
	gap: 6px;
	color: var(--vscode-editorWarning-foreground, var(--dt-fg-muted));
}
</style>
