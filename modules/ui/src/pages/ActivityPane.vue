<!--
	THE ACTIVITY PAGE — the Schema tab's first page, and where a module clicked in the nav lands
	(operator 2026-10-29: "the module inspector should load first; top page should be activity, show
	named activity from git for the module"). One entry per commit, newest first, grouped by day: who,
	when, the message, and the records it touched, named by their titles and linked to them.

	Read from the host (`GET /activity`, src/activity.ts): the history of the repo that holds the
	module — a clone's whole history, the workspace module's whole repo, an inline module's own folder
	and record folders. Unnarrowed, every module's history merged, each entry marked with its repo's
	name (the source mark: the same word and dot colour the repo's records carry). An npm-installed
	module has none, and the page says so rather than showing an empty feed as if nothing happened.

	A commit opens the way Source Control opens one — VS Code's own commit diff, through the host
	(`dreamteamer.viewCommit`). Paged like every list, 20 a page, newest first; the host says whether
	an older page exists (`hasMore`), so the pager needs no total.

	Two props a PAGE view sets (cr: nested ui-views): `embedded` — drawn inside a panel, which already
	carries the title, so no heading of its own and no page padding — and `source`, a record layer the
	page is scoped to: only that repo's history is read (`GET /activity?source=`). The panel and the
	module's own Activity page are this one component, so the two cannot draw different feeds.

	The page does not wait for the slowest repo (operator 2026-10-31: "activity should load instantly …
	don't wait for everything to load"): the host answers with the repos that are in and names the rest
	`pending`, and the pane asks again with what it has (`settled`) until none is, saying which repos it
	is still reading. The host keeps those reads going between the requests rather than restarting them.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '../api/client';
import { hostNotify } from '../api/transport';
import DtIcon from '../components/DtIcon.vue';
import DtLink from '../components/DtLink.vue';
import SourceMark from '../components/SourceMark.vue';
import RunningSessions from '../components/RunningSessions.vue';

interface ActivityRecord {
	collection: string;
	id: string;
	title?: string;
}
interface ActivityEntry {
	sha: string;
	repo: string;
	/** The repo's name — a clone's `git_modules` key, the workspace's own name for `.`. */
	source: string;
	author: string;
	date: string;
	subject: string;
	records: ActivityRecord[];
	files: number;
}
interface Activity {
	module: string | null;
	scopes: Array<{ repo: string; paths: string[] }>;
	entries: ActivityEntry[];
	offset: number;
	hasMore: boolean;
	/** Repos whose log has not answered yet — the page is the merge of the rest until it is empty. */
	pending: string[];
	/** Repos whose log was killed after the host's timeout. */
	failed: string[];
	/** How many scopes have answered — sent back as `settled` to wait for the next. */
	settled: number;
}

const props = defineProps<{ module?: string; moduleTitle?: string; embedded?: boolean; source?: string }>();

const PAGE = 20;

const activity = ref<Activity | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
const page = ref(0);
const root = ref<HTMLElement | null>(null);

let seq = 0;
/** One page; `settled` set means a follow-up for the repos still pending, which keeps the page as it
 *  is while it waits. A newer load (another page, another module) drops the follow-ups of the last. */
async function load(settled?: number): Promise<void> {
	const mine = settled === undefined ? ++seq : seq;
	if (settled === undefined) {
		loading.value = true;
		error.value = null;
	}
	try {
		const query = new URLSearchParams({ limit: String(PAGE), offset: String(page.value * PAGE) });
		if (props.module) query.set('module', props.module);
		if (props.source) query.set('source', props.source);

		if (settled !== undefined) query.set('settled', String(settled));
		const res = await api.get<Activity>(`/activity?${query}`);
		if (mine !== seq) return;
		activity.value = res.data;
		if (settled === undefined) root.value?.scrollTo?.({ top: 0 });
		if (res.data.pending?.length) void load(res.data.settled);
	} catch (err) {
		if (mine === seq) error.value = err instanceof Error ? err.message : String(err);
	} finally {
		if (mine === seq) loading.value = false;
	}
}
watch(
	() => [props.module, props.source],
	() => {
		page.value = 0;
		activity.value = null;
		void load();
	},
	{ immediate: true },
);

// leaving the page (another rail row, another module's tab key) ends its follow-ups: the answer to
// one in flight is dropped and asks for nothing more
onBeforeUnmount(() => {
	seq++;
});

const from = computed(() => page.value * PAGE + 1);
const to = computed(() => page.value * PAGE + (activity.value?.entries.length ?? 0));
function go(delta: number): void {
	page.value = Math.max(0, page.value + delta);
	void load();
}

/** The commit, opened as Source Control opens one (host `dreamteamer.viewCommit`). */
function openCommit(e: ActivityEntry): void {
	hostNotify('dt:command', { command: 'dreamteamer.viewCommit', arg: { repo: e.repo, sha: e.sha } });
}

/** Entries by local day, newest day first — the order they arrive in. */
const days = computed(() => {
	const out: Array<{ day: string; entries: ActivityEntry[] }> = [];
	for (const e of activity.value?.entries ?? []) {
		const day = new Date(e.date).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
		const last = out[out.length - 1];
		if (last && last.day === day) last.entries.push(e);
		else out.push({ day, entries: [e] });
	}
	return out;
});

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const noHistory = computed(() => activity.value !== null && activity.value.scopes.length === 0);
const pending = computed(() => activity.value?.pending ?? []);
const failed = computed(() => activity.value?.failed ?? []);
</script>

<template>
	<div ref="root" class="dt-activity" :class="{ 'dt-activity--embedded': embedded }">
		<header v-if="!embedded" class="dt-activity__head">
			<h2 class="dt-activity__title">Activity</h2>
			<p class="dt-activity__lead">
				{{ module ? `Commits to ${moduleTitle ?? module}, newest first.` : 'Commits across every module, newest first.' }}
			</p>
		</header>
		<!-- this machine's running sessions — on the unscoped page only: a session belongs to the machine,
		     not to a module or a layer (cr-vscode-005, design D6). Its own read; the feed never waits on it. -->
		<RunningSessions v-if="!module && !source && !embedded" />
		<p v-if="pending.length" class="dt-activity__empty dt-activity__reading">Still reading {{ pending.join(', ') }}…</p>
		<p v-if="failed.length" class="dt-activity__error">Could not read {{ failed.join(', ') }} — git took too long.</p>
		<p v-if="error" class="dt-activity__error">{{ error }}</p>
		<p v-else-if="!activity" class="dt-activity__empty">Loading…</p>
		<p v-else-if="noHistory && source" class="dt-activity__empty">Nothing of this module's is kept in {{ source }}.</p>
		<p v-else-if="noHistory" class="dt-activity__empty">This module is installed from npm — it has no git history here.</p>
		<p v-else-if="!activity.entries.length && !pending.length" class="dt-activity__empty">No commits yet.</p>
		<section v-for="group in days" v-else :key="group.day" class="dt-activity__day">
			<h3 class="dt-activity__day-head">{{ group.day }}</h3>
			<article v-for="e in group.entries" :key="`${e.repo} ${e.sha}`" class="dt-activity__entry" :data-sha="e.sha">
				<div class="dt-activity__line">
					<DtIcon class="dt-activity__icon" name="git-commit" />
					<span class="dt-activity__author">{{ e.author }}</span>
					<button type="button" class="dt-activity__subject" :title="`Open commit ${e.sha.slice(0, 7)} in Source Control`" @click="openCommit(e)">{{ e.subject }}</button>
					<SourceMark v-if="!module" class="dt-activity__source" :name="e.source" />
					<button type="button" class="dt-activity__sha" :title="`Open commit ${e.sha.slice(0, 7)} in Source Control`" @click="openCommit(e)">{{ e.sha.slice(0, 7) }}</button>
					<span class="dt-activity__time" :title="e.date">{{ time(e.date) }}</span>
				</div>
				<div v-if="e.records.length || e.files" class="dt-activity__records">
					<DtLink v-for="r in e.records.slice(0, 8)" :key="`${r.collection}/${r.id}`" class="dt-chip dt-activity__record" :to="`/content/${r.collection}/${r.id}`">
						<span class="dt-activity__record-kind">{{ r.collection }}</span> {{ r.title ?? r.id }}
					</DtLink>
					<span v-if="e.records.length > 8" class="dt-activity__more">+{{ e.records.length - 8 }} more</span>
					<span v-if="e.files > e.records.length" class="dt-activity__more">{{ e.files - e.records.length }} other file{{ e.files - e.records.length === 1 ? '' : 's' }}</span>
				</div>
			</article>
		</section>
		<footer v-if="activity && activity.entries.length && (page > 0 || activity.hasMore)" class="dt-activity__pager">
			<span class="dt-activity__count">{{ from }}–{{ to }}</span>
			<button type="button" class="dt-btn dt-btn--secondary dt-btn--sm dt-btn--icon" title="Newer" :disabled="page === 0 || loading" @click="go(-1)">
				<DtIcon name="chevron-left" />
			</button>
			<button type="button" class="dt-btn dt-btn--secondary dt-btn--sm dt-btn--icon" title="Older" :disabled="!activity.hasMore || loading" @click="go(1)">
				<DtIcon name="chevron-right" />
			</button>
		</footer>
	</div>
</template>

<style scoped>
.dt-activity {
	padding: var(--dt-page-pad, 24px);
	display: flex;
	flex-direction: column;
	gap: 16px;
	max-width: 920px;
	overflow-y: auto;
}
.dt-activity--embedded {
	padding: 0;
	max-width: none;
	overflow: visible;
}
.dt-activity__title {
	margin: 0 0 4px;
	font-size: calc(var(--dt-text) + 2px);
	font-weight: 600;
}
.dt-activity__lead,
.dt-activity__empty {
	margin: 0;
	color: var(--dt-fg-subtle);
	font-size: var(--dt-text);
}
.dt-activity__error {
	color: var(--dt-danger);
}
.dt-activity__day-head {
	margin: 0 0 6px;
	color: var(--dt-fg-muted);
	font-size: var(--dt-label);
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.04em;
}
.dt-activity__entry {
	padding: 8px 0;
	border-bottom: 1px solid var(--dt-border);
}
.dt-activity__line {
	display: flex;
	align-items: baseline;
	gap: 8px;
	min-width: 0;
}
.dt-activity__icon {
	flex-shrink: 0;
	color: var(--dt-fg-subtle);
	align-self: center;
}
.dt-activity__author {
	flex-shrink: 0;
	font-weight: 600;
}
.dt-activity__subject,
.dt-activity__sha {
	padding: 0;
	border: 0;
	background: none;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
}
.dt-activity__subject {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.dt-activity__subject:hover,
.dt-activity__sha:hover {
	color: var(--vscode-textLink-foreground, var(--dt-link));
	text-decoration: underline;
}
.dt-activity__source {
	flex-shrink: 0;
	font-size: var(--dt-label);
	color: var(--dt-fg-muted);
}
.dt-activity__sha {
	flex-shrink: 0;
	color: var(--dt-fg-subtle);
	font-family: var(--vscode-editor-font-family, monospace);
	font-size: var(--dt-label);
}
.dt-activity__pager {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 8px;
	color: var(--dt-fg-subtle);
	font-size: var(--dt-text);
}
.dt-activity__time {
	flex-shrink: 0;
	color: var(--dt-fg-subtle);
	font-size: var(--dt-label);
	font-variant-numeric: tabular-nums;
}
.dt-activity__records {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin: 6px 0 0 24px;
}
.dt-activity__record {
	text-decoration: none;
	color: var(--dt-fg);
}
.dt-activity__record-kind {
	color: var(--dt-fg-subtle);
}
.dt-activity__more {
	color: var(--dt-fg-subtle);
	font-size: var(--dt-label);
	align-self: center;
}
</style>
