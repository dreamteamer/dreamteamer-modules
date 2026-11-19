<!--
	One `scope: collection` ui-view record rendered as a page (ui-views.ts registers a route per view).
	Deliberately a THIN wrapper: all browse behavior — data fetch, search, filter chips, layout
	rendering through the lists registry, pagination — is BrowseView's; this component only
	translates the view record into BrowseView's config props (its `display.list` as compile merged
	it over the collection's — layout, columns, sort, layout options — the base server filter with
	`@me` already resolved by ui-views.ts, and its nav title as the page title). Unregistered layouts degrade to the built-in table inside BrowseView
	(lib/presets.ts#resolveRendererEntry console.warns) — never a blank page.

	The translation itself is `composables/collection-views.ts#viewToConfig`: one function owns the
	split of `display.list` into what the browse state consumes, so a named view, an embedded
	relation view and this page cannot disagree about what a view's keys mean.

	`view-options` stays alongside it: that is the documented module-List `options` prop
	(`(collection, query, options)`), a different contract from the core `listOptions` slice.

	⚠ The prop is the view's ID, not the record. The record is looked up LIVE out of `ui-views.ts`'s
	reactive table, and the browse below is keyed on a fingerprint of it — because `useBrowseState`
	reads its config (filter, columns, sort, layout) once at setup, so a changed record only reaches
	the screen through a remount. Handing the record itself in as a static route prop is what made
	every filtered view render its whole collection when the filter was authored after the tab
	opened: `router.addRoute` froze the boot-time record and navigating back re-used it.
-->
<script setup lang="ts">
import { computed } from 'vue';
import BrowseView from '../components/BrowseView.vue';
import { viewToConfig } from '../composables/collection-views';
import { collectionOf, drawnDisplay, resolvedUiView, uiViewFingerprint, viewLabel } from '../ui-views';
import DtIcon from '../components/DtIcon.vue';
import { useCollections } from '../composables/collections';
import { sourcesKey } from '../lib/sources';

const props = defineProps<{ viewId: string }>();

const view = computed(() => resolvedUiView(props.viewId));

const collection = computed(() => (view.value ? collectionOf(view.value) : ''));

// Note on `sort`: `''` is a real value (explicitly unsorted) and must survive the trip — only a
// missing key means "unset". `viewToConfig` preserves that distinction.
const config = computed(() => (view.value ? viewToConfig(view.value) : undefined));

// Remount when the RECORD changes, not merely when the route does. Stable by value, so a refresh
// that finds the same record re-renders nothing.
// …and when the sources the collection reads change — a layer installed (`sourcesKey`).
const { tree } = useCollections();
const browseKey = computed(() => `${uiViewFingerprint(view.value)}::${sourcesKey(tree.value.find((r) => r.collection === collection.value))}`);
</script>

<template>
	<div v-if="!view" class="dt-empty">
		<DtIcon name="dashboard" />
		<p class="dt-empty__line">ui-view '{{ viewId }}' no longer exists</p>
	</div>
	<div v-else-if="!collection" class="dt-empty">
		<DtIcon name="dashboard" />
		<p class="dt-empty__line">ui-view '{{ view.id }}' references no collection</p>
	</div>
	<BrowseView
		v-else
		:key="browseKey"
		:collection="collection"
		:layout="config?.layout"
		:base-filter="view.filter"
		:columns="config?.columns"
		:sort="config?.sort"
		:list-options="config?.listOptions"
		:view-options="drawnDisplay(view).list?.options"
		:title="viewLabel(view)"
		:view-id="view.id"
	/>
</template>
