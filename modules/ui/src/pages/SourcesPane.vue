<!--
	THE SOURCES SECTION of the Schema tab — the stack of roots this workspace reads, top to bottom, as
	`dt status` prints its `layers:` block: the workspace's own data, each record layer (its name, its
	clone path, installed or not, the collections it contributes with the records read from each),
	and each module-owned collection under its module. Answered by the host's `GET /sources`
	(`src/sources.ts`), derived from the compiled roots across every descriptor plus the root
	package's `git_modules` — nothing listed here is authored twice.

	A layer whose clone is absent is drawn greyed with *not installed* and no counts: a fresh checkout
	before `dreamteamer install`, and the one place that says why nothing is read from it. A source
	whose remote matches a `repos` record links to that record; one that matches none is plain text.
-->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api/client';
import DtIcon from '../components/DtIcon.vue';
import SourceMark from '../components/SourceMark.vue';
import type { SourceAccess, SourceVia } from '../api/types';

interface StackEntry {
	name: string;
	kind: 'own' | 'layer' | 'module';
	repo: string;
	installed: boolean;
	url?: string;
	record?: string;
	/** The root's class and whether a write lands there (cr-vscode-004) — the mark's glyph. */
	via?: SourceVia;
	access?: SourceAccess;
	note?: string;
	collections: Array<{ collection: string; path: string; count: number }>;
}

interface Stack {
	workspace: StackEntry;
	layers: StackEntry[];
	modules: StackEntry[];
}

const stack = ref<Stack | null>(null);
const error = ref<string | null>(null);

onMounted(async () => {
	try {
		const res = await api.get<Stack>('/sources');
		stack.value = res.data;
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err);
	}
});

const total = (e: StackEntry) => e.collections.reduce((n, c) => n + c.count, 0);
</script>

<template>
	<div class="dt-sources">
		<header class="dt-sources__head">
			<h2 class="dt-sources__title">Sources</h2>
			<p class="dt-sources__lead">Where this workspace reads its records from, top to bottom — the first root to hold an id is the one read.</p>
		</header>
		<p v-if="error" class="dt-sources__error">{{ error }}</p>
		<p v-else-if="!stack" class="dt-sources__empty">Loading…</p>
		<template v-else>
			<section class="dt-sources__block" data-kind="own">
				<h3 class="dt-sources__heading"><DtIcon name="root-folder" /> {{ stack.workspace.name }} <span class="dt-sources__note">this workspace</span></h3>
				<table v-if="stack.workspace.collections.length" class="dt-table dt-sources__table">
					<thead><tr><th>Collection</th><th>Folder</th><th class="dt-sources__num">Records</th></tr></thead>
					<tbody>
						<tr v-for="c in stack.workspace.collections" :key="c.collection"><td>{{ c.collection }}</td><td class="dt-sources__path">{{ c.path }}</td><td class="dt-sources__num">{{ c.count }}</td></tr>
					</tbody>
				</table>
				<p v-else class="dt-sources__empty">No collection keeps records in the workspace's own folder.</p>
			</section>

			<section class="dt-sources__block" data-kind="layers">
				<h3 class="dt-sources__heading"><DtIcon name="layers" /> Record layers <span class="dt-sources__note">{{ stack.layers.length || 'none declared' }}</span></h3>
				<article v-for="layer in stack.layers" :key="layer.name" class="dt-sources__entry" :class="{ 'is-absent': !layer.installed }" :data-source="layer.name">
					<div class="dt-sources__entry-head">
						<SourceMark :name="layer.name" :record="layer.record" context="record" :access="layer.access" :via="layer.via" :note="layer.note" />
						<span class="dt-sources__path">{{ layer.repo }}</span>
						<span v-if="!layer.installed" class="dt-sources__absent">not installed — run <code>dreamteamer install</code></span>
						<span v-else class="dt-sources__note">{{ total(layer) }} record{{ total(layer) === 1 ? '' : 's' }} read</span>
					</div>
					<p v-if="layer.url" class="dt-sources__url">{{ layer.url }}</p>
					<ul v-if="layer.collections.length" class="dt-sources__list">
						<li v-for="c in layer.collections" :key="c.collection">
							<span>{{ c.collection }}</span>
							<span class="dt-sources__path">{{ c.path }}</span>
							<span v-if="layer.installed" class="dt-sources__num">{{ c.count }}</span>
						</li>
					</ul>
					<p v-else class="dt-sources__empty">Contributes to no compiled collection — its <code>records</code> list names none this workspace has.</p>
				</article>
			</section>

			<section class="dt-sources__block" data-kind="modules">
				<h3 class="dt-sources__heading"><DtIcon name="package" /> Module-owned collections <span class="dt-sources__note">{{ stack.modules.length || 'none' }}</span></h3>
				<article v-for="mod in stack.modules" :key="mod.name" class="dt-sources__entry" :data-source="mod.name">
					<div class="dt-sources__entry-head">
						<SourceMark :name="mod.name" :record="mod.record" context="record" :access="mod.access" :via="mod.via" :note="mod.note" />
						<span class="dt-sources__path">{{ mod.repo === '.' ? 'commits to this workspace' : mod.repo }}</span>
						<span class="dt-sources__note">{{ total(mod) }} record{{ total(mod) === 1 ? '' : 's' }}</span>
					</div>
					<p v-if="mod.url" class="dt-sources__url">{{ mod.url }}</p>
					<ul class="dt-sources__list">
						<li v-for="c in mod.collections" :key="c.collection">
							<span>{{ c.collection }}</span>
							<span class="dt-sources__path">{{ c.path }}</span>
							<span class="dt-sources__num">{{ c.count }}</span>
						</li>
					</ul>
				</article>
			</section>
		</template>
	</div>
</template>

<style scoped>
.dt-sources {
	padding: var(--dt-page-pad, 24px);
	display: flex;
	flex-direction: column;
	gap: 20px;
	max-width: 920px;
}
.dt-sources__title {
	margin: 0 0 4px;
	font-size: calc(var(--dt-text) + 2px);
	font-weight: 600;
}
.dt-sources__lead,
.dt-sources__empty,
.dt-sources__url {
	margin: 0;
	color: var(--dt-fg-subtle);
	font-size: var(--dt-text);
}
.dt-sources__error {
	color: var(--dt-danger);
}
.dt-sources__heading {
	display: flex;
	align-items: center;
	gap: 6px;
	margin: 0 0 8px;
	font-size: var(--dt-text);
	font-weight: 600;
}
.dt-sources__note {
	color: var(--dt-fg-muted);
	font-weight: 400;
}
.dt-sources__entry {
	padding: 10px 12px;
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius);
	margin-bottom: 8px;
}
.dt-sources__entry.is-absent {
	opacity: 0.6;
	border-style: dashed;
}
.dt-sources__entry-head {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 10px;
}
.dt-sources__path {
	color: var(--dt-fg-muted);
	font-family: var(--vscode-editor-font-family, monospace);
	font-size: var(--dt-label);
}
.dt-sources__absent {
	color: var(--dt-warning);
	font-size: var(--dt-label);
}
.dt-sources__list {
	list-style: none;
	margin: 8px 0 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 3px;
	font-size: var(--dt-text);
}
.dt-sources__list li {
	display: grid;
	grid-template-columns: minmax(120px, 1fr) 2fr 48px;
	gap: 12px;
	align-items: baseline;
}
.dt-sources__num {
	text-align: right;
	font-variant-numeric: tabular-nums;
	color: var(--dt-fg-subtle);
}
.dt-sources__table {
	width: auto;
	min-width: 420px;
}
</style>
