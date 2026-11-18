<!--
	A RELATION FIELD ON A RECORD PAGE, DRAWN AS THE TARGET COLLECTION'S OWN VIEW.

	Operator ask 2026-09-11: *"allow relation fields in details view mode to show a ui view of that
	object, default to the default view (like in directus)"*. A project's `activities` used to render
	as 52 comma-separated links; it now draws the activities TABLE — the same columns, the same sort,
	the same layout and the same page size the Activities browse page draws — scoped to exactly those
	52 records.

	⚠ It renders `BrowseView`, not a bespoke table. "Apply all settings including paging etc" is only
	true if the real browse machinery runs: the layout registry (so a view pinned to `gantt` draws a
	gantt), the column resolution (view → the collection's `display.list` → heuristic), grouping, the unregistered
	layout/option hints, and server-side paging with its pager. A stripped-down table would have been
	a second answer to every one of those, and it would drift.

	The DECISION is not here. `ItemProperties` computes the plan (`lib/relation-view.ts`) because it
	needs the same answer twice — once to choose this component over `RenderView`, and once to stack
	the row to full width. Deciding it in both places is how a row that fell back to links still ended
	up wearing the table's geometry (measured in the dev host, first cut).
-->
<script setup lang="ts">
import { computed } from 'vue';
import BrowseView from './BrowseView.vue';
import { viewToConfig } from '../composables/collection-views';
import { drawnDisplay, uiViewFingerprint } from '../ui-views';
import type { EmbeddedRelationPlan } from '../lib/relation-view';

const props = defineProps<{ plan: EmbeddedRelationPlan }>();

/**
 * A named view's settings — layout, columns, order, per-layout options — through the SAME
 * translation `UiViewPage` uses, so an embedded view and its own page cannot disagree about what
 * its `options` mean.
 *
 * ⚠ `config.filter` is dropped on purpose. The relation IS the scope; anding the view's own filter
 * underneath would hide related records with no explanation on screen, which is the one outcome
 * worse than a list of links. See `lib/relation-view.ts` for the argument.
 */
const config = computed(() => (props.plan.view ? viewToConfig(props.plan.view) : undefined));

/**
 * Remount when the SET of related records changes, or when the view record does.
 *
 * `useBrowseState` reads its config once at setup — the `baseFilter` included — so a project that
 * gains an activity while the page is open only reaches the screen through a remount. Stable by
 * value, so an unchanged relation re-renders nothing.
 */
const browseKey = computed(() =>
	JSON.stringify([props.plan.view ? uiViewFingerprint(props.plan.view) : null, props.plan.ids]),
);
</script>

<template>
	<BrowseView
		:key="browseKey"
		embedded
		:collection="plan.collection"
		:layout="config?.layout"
		:base-filter="plan.filter"
		:columns="config?.columns"
		:sort="config?.sort"
		:list-options="config?.listOptions"
		:view-options="plan.view ? drawnDisplay(plan.view).list?.options : undefined"
		:view-id="plan.view?.id"
	/>
</template>
