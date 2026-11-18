<!--
	Route dispatcher for '/content/:path(.*)' — see router.ts's header for the full resolver
	contract. Splits into home / unknown-collection / browse / detail-or-create, and mounts
	BrowseView or ContentDetail with `:key` tied to the resolved collection (and record id, for the
	detail branch) so each navigation gets a fresh composable instance instead of reactively
	rewiring one shared instance's internals (BrowseView's own header, and
	`composables/browse-state.ts`'s, explain why that's the simpler, more idiomatic choice here).
	BrowseView (phase E) owns the browse toolbar — search/filters/columns/layout-toggle/saved-views
	— and picks between the DataTable/ListCards renderers; this file never touches either.
-->
<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BrowseView from '../components/BrowseView.vue';
import { useCollections } from '../composables/collections';
import { sourcesKey } from '../lib/sources';
import { resolveContentPath } from '../lib/content-path';
import { isUserCollection } from '../lib/okf';
import ContentDetail from './ContentDetail.vue';
import DtIcon from '../components/DtIcon.vue';

/** The Schema tab narrowed to one module: the filter every list here applies (`lib/module-scope.ts`). */
const props = defineProps<{ scopeFilter?: Record<string, unknown> }>();

const route = useRoute();
const router = useRouter();
const { tree, loading, error } = useCollections();

const rawPath = computed(() => {
	const param = route.params['path'];
	return Array.isArray(param) ? param.join('/') : ((param as string | undefined) ?? '');
});

const isHome = computed(() => rawPath.value === '');
const resolved = computed(() => resolveContentPath(rawPath.value, tree.value));

// '/' → '/content/' (router.ts) lands here with an empty path. Once the collections tree has
// loaded, jump to the first non-`.schema/*` OKF collection, preferring LOCAL collections over
// dep-bundle-supplied ones (the system namespace is nav-collapsed by default, so it must never
// be the landing page either); a workspace with none (only `.schema/*`, or no collections at
// all) falls through to the empty state in the template below instead of redirect-looping.
watch(
	[isHome, loading, () => tree.value],
	([home, isLoading, rows]) => {
		if (!home || isLoading) return;
		const first = rows.find((row) => isUserCollection(row) && !row.layer) ?? rows.find(isUserCollection);
		if (first) void router.replace(`/content/${first.collection}`);
	},
	{ immediate: true },
);

// Detail/create gets a fresh ContentDetail instance per collection+id (or +create) — remounting
// on save-then-navigate (create → new id) is deliberate: it forces a clean `useItem` load of the
// just-created record rather than trying to reuse in-memory create-mode state.
const detailKey = computed(() => `${resolved.value.collection}:${resolved.value.id ?? '+'}`);

// A bare `/content/<collection>` is governed by that collection's own `display.list`, and
// BrowseView reads it once at setup — so the key carries it alongside the collection. Same reason
// UiViewPage keys on its view (see ui-views.ts#uiViewFingerprint): without it, a default view
// edited or compiled after the tab opened stayed invisible until a window reload.
const browseKey = computed(() => {
	const row = tree.value.find((r) => r.collection === resolved.value.collection);
	return `${resolved.value.collection}::${JSON.stringify(row?.list ?? null)}::${sourcesKey(row)}`;
});
</script>

<template>
	<div class="dt-content">
		<p v-if="error" class="dt-content-error">{{ error }}</p>

		<template v-else-if="isHome">
			<div class="dt-empty">
				<DtIcon name="database" />
				<p class="dt-empty__line">{{ loading ? 'Loading…' : 'No collections yet.' }}</p>
			</div>
		</template>

		<div v-else-if="resolved.collection === null" class="dt-empty">
			<DtIcon name="database" />
			<p class="dt-empty__line">Unknown collection: {{ rawPath }}</p>
		</div>

		<ContentDetail
			v-else-if="resolved.id !== null || resolved.create"
			:key="detailKey"
			:collection="resolved.collection"
			:id="resolved.id"
			:create="resolved.create"
		>
			<template #after><slot name="after" /></template>
		</ContentDetail>

		<BrowseView v-else :key="`${browseKey}::${JSON.stringify(props.scopeFilter ?? null)}`" :collection="resolved.collection" :scope-filter="props.scopeFilter" />
	</div>
</template>

<style scoped>
/* A flex column with a DEFINITE height, so a child that wants to fill the viewport can
   (`flex: 1; min-height: 0` — see BrowseView's `--fill` modifiers and ListDefinition.fillsHeight).
   Both branches now want it: ContentDetail took the same fixed frame on 2026-08-08 (static header,
   scrolling form), so `.dt-page-area`'s own scrollbar is the fallback for pages that still grow
   rather than the norm. */
.dt-content {
	height: 100%;
	min-height: 100%;
	display: flex;
	flex-direction: column;
}
.dt-content-error {
	color: var(--dt-danger);
	padding: 32px;
}
</style>
