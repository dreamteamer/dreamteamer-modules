<!--
	The commit gesture — the app's half of the engine's `dt commit`.

	Record writes no longer commit themselves (engine workspace setting `auto-commit`, default off),
	so a session's edits now sit on disk until something publishes them. This is that something.

	It owns no logic: `POST /commit {dryRun: true}` IS the pending count, and `POST /commit` is the
	publish. Sampling `git status` per request rather than keeping a counter here is the whole point
	of the engine's model — there is no cursor to drift out of agreement with the working tree, so a
	record committed from a terminal on the side simply stops being counted.

	Hidden at zero, which also covers the two ways there can be no gesture at all: a workspace still
	committing on write (nothing is ever pending) and an engine predating commit.js (the route 404s,
	the catch leaves the count at 0). Neither needs to explain itself in the header.

	WHERE AN EDIT COMMITS IS SAID HERE AND NOWHERE ELSE (0.24.0, `lib/sources.ts`). A record's mark
	says where it is READ FROM; the repo it commits to is a different fact — an inline module's records
	commit to the workspace while their source is the module — so the button reads *Commit to <repo>*,
	naming the repo the engine's plan groups the pending rows under, and when pending edits span several
	repos it becomes a dropdown with one row per repo and its count. The engine's `only` scopes a commit
	to that repo's own rows (and, by its own rule, the relation partners a scoped commit must carry).
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api/client';
import { commitRepoLabel, pendingByRepo, type PendingRepo } from '../lib/sources';
import DtIcon from './DtIcon.vue';

interface CommitResult extends PendingRepo {
	subject?: string;
	sha?: string | null;
	/** in-progress merge/rebase — the engine refused, and said why */
	blocked?: string | null;
	/** committed, but worth saying out loud (detached HEAD) */
	warning?: string | null;
}

const emit = defineEmits<{ (e: 'committed'): void }>();

const route = useRoute();
const plan = ref<CommitResult[]>([]);
const busy = ref(false);
const note = ref('');
const open = ref(false);
const anchorEl = ref<HTMLElement | null>(null);
/** The workspace's own name — what the repo `.` is called on the button (`/info`). */
const workspace = ref<string | undefined>();

const repos = computed(() => pendingByRepo(plan.value));
const pending = computed(() => repos.value.reduce((n, r) => n + r.count, 0));
const label = (repo: string) => commitRepoLabel(repo, workspace.value);

async function refresh(): Promise<void> {
	try {
		const { data } = await api.post<CommitResult[]>('/commit', { dryRun: true });
		plan.value = data ?? [];
	} catch {
		plan.value = [];
	}
}

/** Commit everything pending, or — given `only` — one repo's rows. */
async function commit(only?: string[]): Promise<void> {
	if (busy.value) return;
	busy.value = true;
	open.value = false;
	note.value = '';
	try {
		const { data } = await api.post<CommitResult[]>('/commit', only ? { only } : {});
		// A repo can be blocked while another commits fine, so this is per-repo and joined, not
		// a single status — and it is the engine's own sentence, unrewritten.
		note.value = (data ?? [])
			.map((r) => r.blocked ?? r.warning ?? '')
			.filter(Boolean)
			.join(' · ');
	} catch (err) {
		note.value = err instanceof Error ? err.message : String(err);
	} finally {
		busy.value = false;
		await refresh();
		emit('committed');
	}
}

function onDocumentMousedown(event: MouseEvent): void {
	if (!open.value) return;
	const target = event.target as Node | null;
	if (target && anchorEl.value?.contains(target)) return;
	open.value = false;
}
function onDocumentKeydown(event: KeyboardEvent): void {
	if (event.key === 'Escape' && open.value) open.value = false;
}

onMounted(() => {
	void refresh();
	void api.get<{ name?: string }>('/info').then((res) => { workspace.value = res.data?.name; }).catch(() => {});
	document.addEventListener('mousedown', onDocumentMousedown);
	document.addEventListener('keydown', onDocumentKeydown);
});
onUnmounted(() => {
	document.removeEventListener('mousedown', onDocumentMousedown);
	document.removeEventListener('keydown', onDocumentKeydown);
});
// Navigating is the cheapest honest moment to re-sample: the count is a fact about the working
// tree, not about this page, and anything this window did to it went through a route change.
watch(() => route.fullPath, refresh);
</script>

<template>
	<div v-if="pending || note" ref="anchorEl" class="dt-commit">
		<span v-if="note" class="dt-commit__note" :title="note">{{ note }}</span>
		<!-- one repo: the button names it -->
		<button
			v-if="repos.length === 1"
			type="button"
			class="dt-btn dt-btn--secondary dt-commit__button"
			:disabled="busy"
			:data-repo="repos[0]!.repo"
			:title="`Commit ${pending} pending record change${pending === 1 ? '' : 's'} to ${label(repos[0]!.repo)}`"
			@click="commit()"
		>
			<DtIcon name="git-commit" />
			<span>Commit to {{ label(repos[0]!.repo) }} · {{ pending }}</span>
		</button>
		<!-- several repos: a dropdown, one row per repo with its count -->
		<template v-else-if="repos.length > 1">
			<button
				type="button"
				class="dt-btn dt-btn--secondary dt-commit__button"
				:class="{ 'is-active': open }"
				:disabled="busy"
				:title="`${pending} pending record change${pending === 1 ? '' : 's'} across ${repos.length} repos`"
				aria-haspopup="menu"
				:aria-expanded="open"
				@click="open = !open"
			>
				<DtIcon name="git-commit" />
				<span>Commit {{ pending }}</span>
				<DtIcon name="chevron-down" />
			</button>
			<div v-if="open" class="dt-menu dt-commit__menu" role="menu" aria-label="Commit to">
				<button
					v-for="r in repos"
					:key="r.repo"
					type="button"
					class="dt-menu-item dt-commit__item"
					role="menuitem"
					:data-repo="r.repo"
					@click="commit(r.only)"
				>
					<span class="dt-commit__item-label">Commit to {{ label(r.repo) }}</span>
					<span class="dt-commit__item-count">{{ r.count }}</span>
				</button>
			</div>
		</template>
	</div>
</template>

<style scoped>
.dt-commit {
	position: relative;
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
}

.dt-commit .codicon {
	font-size: var(--dt-icon);
}

.dt-commit__button.is-active {
	background: var(--dt-accent-subtle);
	color: var(--dt-accent);
}

/* The engine's sentence, given one line and no more — a blocked commit names a merge or a rebase,
   which is long. */
.dt-commit__note {
	max-width: 260px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	font-size: var(--dt-text);
	color: var(--dt-fg-muted);
}

/* Anchored under the trigger — the density menu's placement; `.dt-menu` (base.css) is the chrome. */
.dt-commit__menu {
	position: absolute;
	top: calc(100% + 6px);
	right: 0;
	z-index: 30;
	min-width: 220px;
	display: flex;
	flex-direction: column;
}
.dt-commit__item {
	width: 100%;
	display: flex;
	align-items: center;
	gap: 12px;
	border: none;
	background: none;
	font-family: inherit;
	text-align: left;
}
.dt-commit__item:hover,
.dt-commit__item:focus-visible {
	background: var(--dt-bg-subtle);
}
.dt-commit__item-label {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.dt-commit__item-count {
	color: var(--dt-fg-subtle);
	font-variant-numeric: tabular-nums;
}
</style>
