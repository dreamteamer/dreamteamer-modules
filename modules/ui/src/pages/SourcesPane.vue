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

	REMOTE ACCESS (cr-vscode-012): once the stack has drawn, `GET /sources/access` says what each
	source's REMOTE grants, as the account that pushes — drawn beside the local mark by
	`RemoteAccessMark`, with a warning where a push would be refused. Re-check asks again (`fresh=1`);
	Who has access asks for one source's people, teams and groups, or the provider's reason it will not
	say. Computed live, held in memory, never stored.
-->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api/client';
import DtIcon from '../components/DtIcon.vue';
import SourceMark from '../components/SourceMark.vue';
import RemoteAccessMark from '../components/RemoteAccessMark.vue';
import type { OwnAccess, RemoteMembers, SourceAccess, SourceVia } from '../api/types';

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

const access = ref<Record<string, OwnAccess> | null>(null);
const accessError = ref(false);
const checking = ref(false);
const members = ref<Record<string, RemoteMembers | 'loading'>>({});
const open = ref<Record<string, boolean>>({});

async function loadAccess(fresh = false) {
	checking.value = true;
	accessError.value = false;
	if (fresh) {
		access.value = null;
		members.value = {};
		open.value = {};
	}
	try {
		const res = await api.get<{ available: boolean; access: Record<string, OwnAccess> }>(fresh ? '/sources/access?fresh=1' : '/sources/access');
		access.value = res.data.access ?? {};
	} catch {
		accessError.value = true;
	} finally {
		checking.value = false;
	}
}

/** Who has access: a source can be asked once its own level came back as something other than not-checked. */
const askable = (name: string) => {
	const a = access.value?.[name];
	return !!a && a.state !== 'not-checked';
};
async function toggleWho(name: string) {
	open.value = { ...open.value, [name]: !open.value[name] };
	if (!open.value[name] || members.value[name]) return;
	members.value = { ...members.value, [name]: 'loading' };
	try {
		const res = await api.get<RemoteMembers>(`/sources/access/members?source=${encodeURIComponent(name)}`);
		members.value = { ...members.value, [name]: res.data };
	} catch {
		members.value = { ...members.value, [name]: { state: 'unknown', members: [], reason: 'could not be read' } };
	}
}
const listOf = (name: string): RemoteMembers | null => {
	const m = members.value[name];
	return m && m !== 'loading' ? m : null;
};

onMounted(async () => {
	try {
		const res = await api.get<Stack>('/sources');
		stack.value = res.data;
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err);
		return;
	}
	// the stack is on screen first; the remotes are asked after it, so the network never holds it back
	await loadAccess();
});

const total = (e: StackEntry) => e.collections.reduce((n, c) => n + c.count, 0);
</script>

<template>
	<div class="dt-sources">
		<header class="dt-sources__head">
			<h2 class="dt-sources__title">Sources</h2>
			<p class="dt-sources__lead">Where this workspace reads its records from, top to bottom — the first root to hold an id is the one read.</p>
			<div v-if="stack" class="dt-sources__remote-bar">
				<span class="dt-sources__note">Remote access is asked live, as the account each remote pushes as — never stored.</span>
				<button type="button" class="dt-sources__recheck" :disabled="checking" @click="loadAccess(true)"><DtIcon name="refresh" /> Re-check</button>
			</div>
			<p v-if="accessError" class="dt-sources__error dt-sources__access-error">remote access could not be read</p>
		</header>
		<p v-if="error" class="dt-sources__error">{{ error }}</p>
		<p v-else-if="!stack" class="dt-sources__empty">Loading…</p>
		<template v-else>
			<section class="dt-sources__block" data-kind="own">
				<h3 class="dt-sources__heading"><DtIcon name="root-folder" /> {{ stack.workspace.name }} <span class="dt-sources__note">this workspace</span></h3>
				<div v-if="!accessError" class="dt-sources__remote">
					<RemoteAccessMark :source="stack.workspace.name" :access="access?.[stack.workspace.name]" :local="stack.workspace.access" />
					<button v-if="askable(stack.workspace.name)" type="button" class="dt-sources__who" :data-source="stack.workspace.name" @click="toggleWho(stack.workspace.name)">Who has access</button>
				</div>
				<div v-if="open[stack.workspace.name]" class="dt-remote-members">
					<p v-if="members[stack.workspace.name] === 'loading'" class="dt-sources__empty">Asking…</p>
					<template v-else-if="listOf(stack.workspace.name)">
						<p v-if="listOf(stack.workspace.name)!.reason" class="dt-remote-members__reason">{{ listOf(stack.workspace.name)!.reason }}</p>
						<table v-if="listOf(stack.workspace.name)!.members.length" class="dt-table dt-remote-members__table">
							<tbody>
								<tr v-for="m in listOf(stack.workspace.name)!.members" :key="m.kind + m.name" class="dt-remote-members__row" :title="m.role"><td>{{ m.name }}</td><td>{{ m.kind }}</td><td>{{ m.level }}</td><td v-if="m.via">{{ m.via }}</td></tr>
							</tbody>
						</table>
					</template>
				</div>
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
						<RemoteAccessMark v-if="!accessError" :source="layer.name" :access="access?.[layer.name]" :local="layer.access" />
						<button v-if="askable(layer.name)" type="button" class="dt-sources__who" :data-source="layer.name" @click="toggleWho(layer.name)">Who has access</button>
					</div>
					<div v-if="open[layer.name]" class="dt-remote-members">
						<p v-if="members[layer.name] === 'loading'" class="dt-sources__empty">Asking…</p>
						<template v-else-if="listOf(layer.name)">
							<p v-if="listOf(layer.name)!.reason" class="dt-remote-members__reason">{{ listOf(layer.name)!.reason }}</p>
							<table v-if="listOf(layer.name)!.members.length" class="dt-table dt-remote-members__table">
								<tbody>
									<tr v-for="m in listOf(layer.name)!.members" :key="m.kind + m.name" class="dt-remote-members__row" :title="m.role"><td>{{ m.name }}</td><td>{{ m.kind }}</td><td>{{ m.level }}</td><td v-if="m.via">{{ m.via }}</td></tr>
								</tbody>
							</table>
						</template>
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
						<RemoteAccessMark v-if="!accessError && mod.via !== 'package'" :source="mod.name" :access="access?.[mod.name]" :local="mod.access" />
						<button v-if="askable(mod.name)" type="button" class="dt-sources__who" :data-source="mod.name" @click="toggleWho(mod.name)">Who has access</button>
					</div>
					<div v-if="open[mod.name]" class="dt-remote-members">
						<p v-if="members[mod.name] === 'loading'" class="dt-sources__empty">Asking…</p>
						<template v-else-if="listOf(mod.name)">
							<p v-if="listOf(mod.name)!.reason" class="dt-remote-members__reason">{{ listOf(mod.name)!.reason }}</p>
							<table v-if="listOf(mod.name)!.members.length" class="dt-table dt-remote-members__table">
								<tbody>
									<tr v-for="m in listOf(mod.name)!.members" :key="m.kind + m.name" class="dt-remote-members__row" :title="m.role"><td>{{ m.name }}</td><td>{{ m.kind }}</td><td>{{ m.level }}</td><td v-if="m.via">{{ m.via }}</td></tr>
								</tbody>
							</table>
						</template>
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
.dt-sources__remote-bar,
.dt-sources__remote {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 10px;
	margin-top: 6px;
}
.dt-sources__recheck,
.dt-sources__who {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 1px 8px;
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius);
	background: transparent;
	color: var(--dt-fg-subtle);
	font-size: var(--dt-label);
	cursor: pointer;
}
.dt-remote-members {
	margin-top: 8px;
}
.dt-remote-members__reason {
	margin: 0 0 6px;
	color: var(--dt-fg-subtle);
	font-size: var(--dt-label);
}
.dt-remote-members__table {
	width: auto;
	min-width: 320px;
}
</style>
