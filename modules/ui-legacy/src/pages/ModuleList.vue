<!--
	The Schema tab's `modules` list. Six columns, and they are the six `dt list modules` prints —
	id · title · location · path · package name · what it ships — so the pane and the CLI answer the
	same question the same way.

	A module is a ROW here, which is the only reason "add a collection to THIS module" is expressible
	at all: the gesture needs a module to point at.

	New Module… is a HOST command (`dreamteamer.newModule`), not a dialog of its own — creating a
	module scaffolds folders and a package.json, which is an engine act, and the engine's refusal
	messages are what the operator should read when it will not.
-->
<script setup lang="ts">
import { computed } from 'vue';
import DtIcon from '../components/DtIcon.vue';
import DtLink from '../components/DtLink.vue';
import PageHeader from '../components/PageHeader.vue';
import SourcePicker from '../components/browse/SourcePicker.vue';
import { hostNotify } from '../api/transport';
import { useModules } from '../composables/modules';
import { useSourceFilter } from '../composables/source-filter';
import { schemaRowContext } from '../lib/vscode-context';

const { modules, loading, error } = useModules();

/** The Schema tab narrowed to one module: only these modules (`lib/module-scope.ts`). */
const props = defineProps<{ only?: readonly string[] | null }>();
/** The source picker, as on every list: each module is sourced to where it came from (host `runtimeSources`). */
const sourceFilter = useSourceFilter('modules', () => props.only);
const shown = computed(() => modules.value.filter((m) => (!props.only || props.only.includes(m.id)) && sourceFilter.keeps(m.id)));

function newModule(): void {
	hostNotify('dt:command', { command: 'dreamteamer.newModule' });
}
</script>

<template>
	<div class="dt-modules">
		<PageHeader icon="deployed_code" title="Modules">
			<SourcePicker v-if="sourceFilter.shown.value" :state="sourceFilter" />
			<button type="button" class="dt-btn dt-btn--icon" title="New module" @click="newModule">
				<DtIcon name="add" />
			</button>
		</PageHeader>

		<div class="dt-page-body">
			<p v-if="error" class="dt-modules-error">{{ error }}</p>
			<div v-else-if="loading && !modules.length" class="dt-empty">
				<DtIcon name="deployed_code" />
				<p class="dt-empty__line">Loading…</p>
			</div>

			<table v-else class="dt-table">
				<thead>
					<tr>
						<th>Module</th>
						<th>Location</th>
						<th>Path</th>
						<th>Package</th>
						<th>Namespaces</th>
						<th>Ships</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="m in shown"
						:key="m.id"
						:data-vscode-context="schemaRowContext('modules', m.id, m.id, m.location)"
					>
						<td>
							<DtLink :to="`/settings/schema/modules/${m.id}`" class="dt-modules-link">
								<DtIcon class="dt-modules-icon" name="deployed_code" />
								{{ m.title || m.id }}
							</DtLink>
						</td>
						<td>
							<span class="dt-chip" :class="{ 'dt-chip--readonly': m.location === 'node_modules' }">
								{{ m.location || '—' }}
							</span>
						</td>
						<td class="dt-modules-note"><code>{{ m.path || '—' }}</code></td>
						<td class="dt-modules-note">{{ m.name }}</td>
						<td class="dt-modules-note">{{ m.namespaces.join(' · ') || '—' }}</td>
						<td class="dt-modules-note">{{ m.collections.length }} collection{{ m.collections.length === 1 ? '' : 's' }}</td>
					</tr>
				</tbody>
			</table>

			<div v-if="!loading && !modules.length && !error" class="dt-empty">
				<DtIcon name="deployed_code" />
				<p class="dt-empty__line">No modules yet</p>
				<button type="button" class="dt-btn dt-btn--sm" @click="newModule">New module</button>
			</div>
		</div>
	</div>
</template>

<style scoped>
.dt-modules-error {
	color: var(--dt-danger);
}
.dt-modules-note {
	color: var(--dt-fg-subtle);
}
.dt-modules-link {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	color: var(--dt-fg);
	text-decoration: none;
	font-weight: 600;
}
.dt-modules-link:hover {
	text-decoration: underline;
}
.dt-modules-icon {
	font-size: var(--dt-icon);
	color: var(--dt-fg-subtle);
}
/* An npm-shaped module is drawn READ-ONLY rather than hidden: a write there is erased by the next
   `npm install`, and the row is still the truth about what the workspace has. */
.dt-chip--readonly {
	background: var(--dt-bg-subtle);
	color: var(--dt-fg-subtle);
}
</style>
