<!--
	THE SCHEMA TAB — the schema of the workspace as a PLACE you go, not a group inside the place you
	keep records.

	Two panes. Left is *what kind of thing* — every collection the compiled runtime stores, derived
	from the presentation projection's `system` flag rather than listed here (lib/schema-rail.ts).
	Right is *the list, and the one you picked*.

	⚠ SELECTION IS ROUTE STATE, never component state. `/settings/schema/<kind>/<id>` is
	deep-linkable, survives the tab's webview-state round trip on a window reload, and is reachable
	from a host `dt:navigate` — which is what lets a native context-menu command land the operator on
	the row it just changed.

	Three right-hand surfaces, two of them already written:
	  collections → DataModelList / DataModelDetail (the designer)
	  modules     → ModuleList / the ordinary record page, plus the module's collections under it
	  everything else → ContentBrowse, the generic table, reading the route itself

	`/settings/data-model[/<name>]` REDIRECTS here (registry/register-defaults.ts) rather than being
	deleted or mounted twice: two homes for one thing is exactly how the Data Model node came to exist
	in two places at once.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, buildQuery } from '../api/client';
import DtIcon from '../components/DtIcon.vue';
import { useCollections } from '../composables/collections';
import { useModules } from '../composables/modules';
import { moduleScopeFilter, nextModuleScope, withModuleScope } from '../lib/module-scope';
import { schemaRail, splitSchemaRoute } from '../lib/schema-rail';
import { schemaKindContext } from '../lib/vscode-context';
import ContentBrowse from './ContentBrowse.vue';
import ModuleCollections from '../components/ModuleCollections.vue';
import ViewModulePanel from '../components/ViewModulePanel.vue';
import DataModelDetail from './DataModelDetail.vue';
import DataModelList from './DataModelList.vue';
import ModuleList from './ModuleList.vue';
import SourcesPane from './SourcesPane.vue';
import ModulePage from './ModulePage.vue';

const route = useRoute();
const router = useRouter();
const { tree, loading, error } = useCollections();

const tail = computed(() => {
	const param = route.params['path'];
	return Array.isArray(param) ? param.join('/') : ((param as string | undefined) ?? '');
});
const selection = computed(() => splitSchemaRoute(tail.value));
/** The derived kinds, then the one row that is not a kind: SOURCES — where the workspace reads its
 *  records from (own data, each layer, each module-owned list). A page, not a collection: it browses
 *  nothing and takes no schema gesture, which is why it is appended here rather than derived by the
 *  rail from a descriptor none exists for. */
const SOURCES_KIND = 'sources';
/** ACTIVITY — the first row, above Modules, and where a module clicked in the nav lands: its git
 *  history as named entries (`ActivityPane`, host `src/activity.ts`). A page, like Sources. */
const ACTIVITY_KIND = 'activity';
const kinds = computed(() => [{ kind: ACTIVITY_KIND, title: 'Activity', icon: 'history' }, ...schemaRail(tree.value), { kind: SOURCES_KIND, title: 'Sources', icon: 'layers' }]);
/** The pages that are no collection: no count, no schema gesture. */
const PAGE_KINDS = new Set([ACTIVITY_KIND, SOURCES_KIND]);

/** `?field=<name>` opens that field's drawer once the descriptor has loaded — the deep link a
 *  generated mirror follows to the field that OWNS it. Carried through the data-model redirect. */
const openField = computed(() => {
	const q = route.query['field'];
	return (Array.isArray(q) ? q[0] : q) ?? undefined;
});

/**
 * THE MODULE SCOPE — the tab opened on one module from the nav (`?module=<id>`, `lib/module-scope.ts`):
 * every count and every list below is narrowed to what belongs to it, a banner says so, and its ✕
 * widens the tab back to the whole schema. Sticky across a row opened from a narrowed list.
 */
const scope = ref<string | undefined>();
watch(
	[() => route.query['module'], () => selection.value.id],
	([query, id]) => {
		scope.value = nextModuleScope(scope.value, query, Boolean(id));
	},
	{ immediate: true },
);
const { modules } = useModules();
const scopeTitle = computed(() => modules.value.find((m) => m.id === scope.value)?.title ?? scope.value);
const scopeFilter = computed(() => (scope.value ? moduleScopeFilter(scope.value) : undefined));
/** The record layer a module folder was clicked in (`?source=`, `src/nav.ts` moduleRoute) — the
 *  module's page is scoped to it. Read on the Activity page only; every other kind ignores it. */
const source = computed(() => {
	const q = route.query['source'];
	const v = Array.isArray(q) ? q[0] : q;
	return typeof v === 'string' && v ? v : undefined;
});
function clearScope(): void {
	void router.push(`/settings/schema/${selection.value.kind}`);
}

/** The ids a narrowed `collections` / `modules` list shows — those two are hand-drawn lists, not the
 *  generic browse, so they take the scope as a set rather than as a filter. */
const scopedIds = ref<Record<string, string[]>>({});
async function loadScopedIds(id: string | undefined): Promise<void> {
	if (!id) {
		scopedIds.value = {};
		return;
	}
	const pairs = await Promise.all(
		['collections', 'modules'].map(async (kind) => {
			try {
				const res = await api.get<Array<{ id?: unknown }>>(`/items/${kind}${buildQuery({ limit: 1000, filter: moduleScopeFilter(id) })}`);
				return [kind, res.data.map((r) => String(r.id))] as const;
			} catch {
				return [kind, []] as const;
			}
		}),
	);
	scopedIds.value = Object.fromEntries(pairs);
}
watch(scope, (id) => void loadScopedIds(id), { immediate: true });

/** Record counts, one cheap `limit=1` read per kind — the total rides on the list response. */
const counts = ref<Record<string, number>>({});
async function loadCounts(names: string[]): Promise<void> {
	const pairs = await Promise.all(
		names.map(async (name) => {
			try {
				const res = await api.get(`/items/${encodeURIComponent(name)}${buildQuery({ limit: 1, ...(scopeFilter.value ? { filter: scopeFilter.value } : {}) })}`);
				const meta = res.raw['meta'] as { filter_count?: number } | undefined;
				return [name, meta?.filter_count ?? 0] as const;
			} catch {
				return [name, -1] as const; // unreadable — show nothing rather than a wrong zero
			}
		}),
	);
	counts.value = Object.fromEntries(pairs.filter(([, n]) => n >= 0));
}
watch(
	[kinds, scope],
	([rows]) => {
		if (rows.length) void loadCounts(rows.filter((r) => !PAGE_KINDS.has(r.kind)).map((r) => r.kind));
	},
	{ immediate: true },
);

function select(kind: string): void {
	void router.push(withModuleScope(`/settings/schema/${kind}`, scope.value));
}
</script>

<template>
	<div class="dt-schema">
		<nav class="dt-schema-rail" aria-label="Schema kinds">
			<div v-if="scope" class="dt-schema-scope" :title="`Showing only what belongs to ${scope}`">
				<DtIcon name="filter" />
				<span class="dt-schema-scope-label">{{ scopeTitle }}</span>
				<button type="button" class="dt-btn dt-btn--ghost dt-btn--icon dt-btn--sm" title="Show the whole schema" @click="clearScope">
					<DtIcon name="close" />
				</button>
			</div>
			<p v-if="error" class="dt-schema-error">{{ error }}</p>
			<p v-else-if="loading && !kinds.length" class="dt-schema-rail-empty">Loading…</p>
			<button
				v-for="row in kinds"
				:key="row.kind"
				type="button"
				class="dt-schema-kind"
				:class="{ selected: row.kind === selection.kind }"
				:data-vscode-context="schemaKindContext(row.kind)"
				:title="row.title"
				@click="select(row.kind)"
			>
				<DtIcon class="dt-schema-kind-icon" :name="row.icon" />
				<span class="dt-schema-kind-label">{{ row.title }}</span>
				<span v-if="counts[row.kind] !== undefined" class="dt-schema-kind-count">{{ counts[row.kind] }}</span>
			</button>
		</nav>

		<!--
			⚠ THE PANE CARRIES ITS KIND, and that is load-bearing rather than decorative.
			`data-vscode-context` is INHERITED: VS Code walks up from the right-clicked element and
			merges, child winning. So a record row inside this pane — drawn by the generic browse, which
			publishes `{webviewSection: 'dt-row', dtCollection, dtId}` and knows nothing about the tab —
			arrives at the host carrying `dtSchemaKind` as well, which is what lets Rename… and Delete…
			appear on a skill row without teaching four list renderers about the schema. It also puts
			New… on the pane's empty space, so a create gesture is reachable with no row selected.
		-->
		<section class="dt-schema-pane" :data-vscode-context="PAGE_KINDS.has(selection.kind) ? undefined : schemaKindContext(selection.kind)">
			<!-- `:key` on the id as well as the kind: the two detail surfaces own per-record composable
			     state (the designer's staged edits, the module form's draft), and reactively rewiring one
			     instance across records is the bug ContentBrowse's own header warns about. -->
			<template v-if="selection.kind === 'collections'">
				<DataModelDetail
					v-if="selection.id"
					:key="`c:${selection.id}`"
					:collection="selection.id"
					:open-field="openField ?? undefined"
				/>
				<DataModelList v-else :only="scope ? (scopedIds['collections'] ?? []) : null" />
			</template>
			<template v-else-if="selection.kind === 'modules'">
				<!-- A module is a record like any other, so it opens on THE record page — typed fields, the
				     header's edit/save, Info and Revisions (operator 2026-10-29: the hand-built form with
				     comma-separated text and a Save button at the bottom was not how a record edits). What only
				     a module has rides under the form: its collections and New collection… aimed at it. -->
				<ContentBrowse v-if="selection.id" :key="`m:${selection.id}`">
					<template #after><ModuleCollections :module-id="selection.id" /></template>
				</ContentBrowse>
				<ModuleList v-else :only="scope ? (scopedIds['modules'] ?? []) : null" />
			</template>
			<!-- the Activity page: the module's history, named (host `GET /activity`) — or, when a page view
			     names the module, that page (its activity beside its counts), scoped to `?source=` -->
			<ModulePage v-else-if="selection.kind === ACTIVITY_KIND" :key="`a:${scope ?? ''}:${source ?? ''}`" :module="scope" :module-title="scopeTitle" :source="source" />
			<!-- the Sources section: the stack of roots, top to bottom (host `GET /sources`) -->
			<SourcesPane v-else-if="selection.kind === SOURCES_KIND" />
			<!-- Every other kind is an ordinary collection of ordinary records, so it browses through the
			     ordinary pipeline. ContentBrowse resolves the collection and id off the route itself
			     (`lib/content-path.ts` knows `/settings/schema/` as a browse prefix), which is what keeps a
			     row click inside the tab instead of jumping to /content/. -->
			<ContentBrowse v-else :key="`k:${selection.kind}:${scope ?? ''}`" :scope-filter="scopeFilter">
				<!-- a ui-view's record page carries its MODULE as a field that moves it (cr-vscode-002) -->
				<template v-if="selection.kind === 'ui-views' && selection.id" #after><ViewModulePanel :view-id="selection.id" /></template>
			</ContentBrowse>
		</section>
	</div>
</template>

<style scoped>
.dt-schema {
	display: grid;
	grid-template-columns: minmax(180px, 220px) 1fr;
	flex: 1;
	min-height: 0;
	overflow: hidden;
}
.dt-schema-rail {
	display: flex;
	flex-direction: column;
	gap: 1px;
	padding: 8px 4px;
	border-right: 1px solid var(--dt-border);
	background: var(--dt-bg-subtle);
	overflow-y: auto;
}
.dt-schema-scope {
	display: flex;
	align-items: center;
	gap: 6px;
	margin: 0 0 6px;
	padding: 4px 4px 4px 8px;
	border-radius: 3px;
	background: var(--dt-accent-subtle);
	color: var(--dt-fg);
	font-size: var(--dt-text);
}
.dt-schema-scope-label {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: 600;
}
.dt-schema-kind {
	display: flex;
	align-items: center;
	gap: 6px;
	width: 100%;
	padding: 5px 8px;
	border: none;
	border-radius: 3px;
	background: none;
	color: var(--dt-fg);
	font-size: var(--dt-text);
	text-align: left;
	cursor: pointer;
}
.dt-schema-kind:hover {
	background: var(--dt-bg-hover, rgba(128, 128, 128, 0.12));
}
.dt-schema-kind.selected {
	background: var(--dt-bg-selected, rgba(128, 128, 128, 0.22));
	font-weight: 600;
}
.dt-schema-kind-icon {
	font-size: var(--dt-icon);
	color: var(--dt-fg-subtle);
	flex: none;
}
.dt-schema-kind-label {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.dt-schema-kind-count {
	flex: none;
	color: var(--dt-fg-subtle);
	font-variant-numeric: tabular-nums;
}
.dt-schema-rail-empty,
.dt-schema-error {
	padding: 6px 8px;
	color: var(--dt-fg-subtle);
	font-size: var(--dt-text);
}
.dt-schema-error {
	color: var(--dt-danger);
}
.dt-schema-pane {
	display: flex;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
	overflow-y: auto;
}

/* An app tab can be SPLIT, so the tab is not the whole window: below 640px the rail keeps its
   glyphs and drops its labels rather than eating the pane it exists to navigate. */
@media (max-width: 640px) {
	.dt-schema {
		grid-template-columns: 40px 1fr;
	}
	.dt-schema-kind-label,
	.dt-schema-kind-count {
		display: none;
	}
}
</style>
