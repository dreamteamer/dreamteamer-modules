<!--
	Settings > Data Model home (phase D scope item 1): every registered OKF collection, grouped by
	namespace (the `.schema/*` system group collapsed by default), each with a provenance chip
	('disk' | 'built-in') and — for dep-supplied collections — a layer chip naming the bundle
	(`row.layer`, bundle-layered core; an unregistered folder is a separate list entirely, with no
	provenance at all, until `registerFolder` adopts it), plus the unregistered-folders section
	(reusing `useCollections().registerFolder`, same as NavSidebar) and the "New collection" entry
	point.

	⚠ Its rows publish a `data-vscode-context` object, so right-clicking one gets a NATIVE VS Code
	menu — Rename… / Move to Module… / Add Field… / Delete… — off the same commands the native tree's
	rows use. It carries collection + id, never a path: the host resolves the owning module and the
	file (src/schema-crud.ts, src/reveal.ts).

	Browse-restyle (BROWSE wave): PageHeader (icon `schema`) replaces the bare `<h1>`, the "New
	collection" trigger becomes the circular primary header action (CreateCollectionDialog itself
	is DETAIL-owned and untouched), tables restyled onto the frozen `.dt-table` utility, provenance
	badges restyled onto `.dt-chip`.
-->
<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import CreateCollectionDialog from '../components/CreateCollectionDialog.vue';
import DtLink from '../components/DtLink.vue';
import PageHeader from '../components/PageHeader.vue';
import SourcePicker from '../components/browse/SourcePicker.vue';
import { useCollections } from '../composables/collections';
import { useSourceFilter } from '../composables/source-filter';
import { isOkfRow } from '../lib/okf';
import { schemaRowContext } from '../lib/vscode-context';
import type { CollectionRow } from '../api/types';
import DtIcon from '../components/DtIcon.vue';

const { tree, unregistered, loading, error, registerFolder } = useCollections();

/** The Schema tab narrowed to one module: only these collections (`lib/module-scope.ts`). */
const props = defineProps<{ only?: readonly string[] | null }>();

interface Group {
	name: string;
	rows: CollectionRow[];
}

/** The source picker, as on every list: each collection is sourced to the module it was compiled from. */
const sourceFilter = useSourceFilter('collections', () => props.only);
const okfRows = computed(() => tree.value.filter((row) => isOkfRow(row) && (!props.only || props.only.includes(row.collection)) && sourceFilter.keeps(row.collection)));

const groups = computed<Group[]>(() => {
	const ungrouped: CollectionRow[] = [];
	const named = new Map<string, CollectionRow[]>();

	for (const row of okfRows.value) {
		const slash = row.collection.indexOf('/');
		if (slash === -1) {
			ungrouped.push(row);
			continue;
		}
		const name = row.collection.slice(0, slash);
		const rows = named.get(name) ?? [];
		rows.push(row);
		named.set(name, rows);
	}

	const result: Group[] = [];
	if (ungrouped.length) result.push({ name: '', rows: ungrouped });
	for (const [name, rows] of named) result.push({ name, rows });
	return result;
});

const collapsed = reactive<Record<string, boolean>>({ '.schema': true });
function toggle(name: string): void {
	collapsed[name] = !collapsed[name];
}

const createOpen = ref(false);
const registering = ref<string | null>(null);

async function onRegister(path: string): Promise<void> {
	registering.value = path;
	try {
		await registerFolder(path);
	} finally {
		registering.value = null;
	}
}
</script>

<template>
	<div class="dt-data-model">
		<PageHeader icon="schema" title="Data Model">
			<SourcePicker v-if="sourceFilter.shown.value" :state="sourceFilter" />
			<!--
				No diagram button here on purpose. `collections` is a collection, so its diagram is
				reached the way every other view is: browse it and pick the Diagram layout. A bespoke
				entry point would be a second way to do a thing the layout picker already does.
			-->
			<button type="button" class="dt-btn dt-btn--icon" title="New collection" @click="createOpen = true">
				<DtIcon name="add" />
			</button>
		</PageHeader>

		<div class="dt-page-body">
			<p v-if="error" class="dt-dm-error">{{ error }}</p>
			<div v-else-if="loading && !okfRows.length" class="dt-empty">
				<DtIcon name="symbol-structure" />
				<p class="dt-empty__line">Loading…</p>
			</div>

			<section v-for="group in groups" :key="group.name || '__root'" class="dt-dm-group">
				<button v-if="group.name" type="button" class="dt-dm-group-header" @click="toggle(group.name)">
					<DtIcon class="dt-dm-caret" :class="{ collapsed: collapsed[group.name] }" name="chevron-down" />
					{{ group.name }}
				</button>

				<table v-show="!group.name || !collapsed[group.name]" class="dt-table">
					<thead>
						<tr>
							<th>Collection</th>
							<th>Provenance</th>
							<th>Layer</th>
							<th>Title</th>
						</tr>
					</thead>
					<tbody>
						<tr
							v-for="row in group.rows"
							:key="row.collection"
							:data-vscode-context="schemaRowContext('collections', row.collection)"
						>
							<td>
								<DtLink :to="`/settings/data-model/${row.collection}`" class="dt-dm-link">
									<DtIcon class="dt-dm-link-icon" :name="row.nav.icon ?? 'database'" />
									{{ row.collection }}
								</DtLink>
							</td>
							<td><span class="dt-chip" :class="`dt-chip--${row.provenance}`">{{ row.provenance }}</span></td>
							<td>
								<span v-if="row.layer" class="dt-chip dt-chip--bundle" :title="`Supplied by the '${row.layer}' bundle`">{{ row.layer }}</span>
								<span v-else class="dt-dm-note">local</span>
							</td>
							<td class="dt-dm-note">{{ row.title }}</td>
						</tr>
					</tbody>
				</table>
			</section>

			<section v-if="unregistered.length" class="dt-dm-group">
				<p class="dt-section-label dt-dm-section-title">Unregistered folders</p>
				<table class="dt-table">
					<thead>
						<tr>
							<th>Path</th>
							<th>Record files</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="folder in unregistered" :key="folder.path">
							<td>{{ folder.path }}</td>
							<td>{{ folder.recordFileCount }}</td>
							<td>
								<button type="button" class="dt-btn dt-btn--secondary dt-btn--sm" :disabled="registering === folder.path" @click="onRegister(folder.path)">
									{{ registering === folder.path ? 'Registering…' : 'Register' }}
								</button>
							</td>
						</tr>
					</tbody>
				</table>
			</section>

			<div v-if="!loading && !okfRows.length && !unregistered.length" class="dt-empty">
				<DtIcon name="symbol-structure" />
				<p class="dt-empty__line">No collections yet</p>
				<button type="button" class="dt-btn dt-btn--sm" @click="createOpen = true">New collection</button>
			</div>
		</div>

		<CreateCollectionDialog v-model:open="createOpen" />
	</div>
</template>

<style scoped>
.dt-dm-error {
	color: var(--dt-danger);
}
.dt-dm-group {
	margin-bottom: 24px;
}
.dt-dm-group-header {
	display: flex;
	align-items: center;
	gap: 4px;
	background: none;
	border: none;
	padding: 6px 0;
	font-size: var(--dt-label);
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--dt-fg-subtle);
	cursor: pointer;
}
.dt-dm-caret {
	font-size: var(--dt-icon);
	transition: transform 0.1s;
	transform: rotate(0deg);
}
.dt-dm-caret.collapsed {
	transform: rotate(-90deg);
}
.dt-dm-section-title {
	margin-bottom: 8px;
}
.dt-dm-note {
	color: var(--dt-fg-subtle);
}
.dt-dm-link {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	color: var(--dt-fg);
	text-decoration: none;
	font-weight: 600;
}
.dt-dm-link:hover {
	text-decoration: underline;
}
.dt-dm-link-icon {
	font-size: var(--dt-icon);
	color: var(--dt-fg-subtle);
}
.dt-chip--built-in {
	background: var(--dt-bg-subtle);
	color: var(--dt-fg-subtle);
}
.dt-chip--disk {
	background: color-mix(in srgb, var(--dt-success) 15%, transparent);
	color: color-mix(in srgb, var(--dt-success) 80%, #000);
	border-color: color-mix(in srgb, var(--dt-success) 30%, transparent);
}
.dt-chip--bundle {
	background: color-mix(in srgb, var(--dt-accent) 12%, transparent);
	color: var(--dt-accent);
	border-color: color-mix(in srgb, var(--dt-accent) 30%, transparent);
}
</style>
