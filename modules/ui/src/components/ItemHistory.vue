<!--
	Right-sidebar 'revisions' section (spec §"placement conventions"): one item's full git history
	via `GET /revisions/:collection/:id` (adapter → the clean `/api/history` per-record git log:
	author, relative date, commit subject as the row label, short hash). Restyled to fit a 280px
	sidebar column (13px text, compact rows) — RightSidebar's accordion only mounts this component
	while its section is open, so it carries no collapse control of its own.

	Diff expander (M3): clicking "diff" fetches `GET /history-diff/:collection/:id?hash=<sha>` —
	the unified diff of THAT commit vs its parent for the record's file (`{hash, path, diff}`).
	Rendered via `classifyDiffLines` (lib/diff-lines.ts) — monospace `<pre>`, +/- line backgrounds,
	no diff lib.

	Restore (M3): "restore" POSTs `/records-revert/:collection/:id` (adapter →
	`POST /api/collections/:c/records-revert/:id`) with `{hash}` — the commit whose CONTENT you
	want back (the server does `git show hash:path`, VALIDATES it against the current schema, and
	writes one new commit). So each row's action reads "restore" = "restore this version"; a 400
	(e.g. historical content no longer validates) surfaces the server's message verbatim in the
	confirm dialog.

	⚠ Restore is DISABLED on a COMPILED collection, and the tooltip is the engine's own sentence
	(spec §3.4). The engine refuses `revert` on every runtime-stored kind — its history is git's and
	there is no record to write — so the button used to be offered, open a confirm, and lose the
	refusal entirely: reka-ui's AlertDialogAction closes the dialog on click, which unmounted the
	`revertError` paragraph before it could paint. An error the operator never sees is worse than a
	disabled control with a reason, so the gate is now BEFORE the click and reads the presentation
	projection (`lib/readonly-source.ts`) rather than restating a refusal of its own.
-->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogOverlay,
	AlertDialogPortal,
	AlertDialogRoot,
	AlertDialogTitle,
} from 'reka-ui';
import { api, buildQuery } from '../api/client';
import type { ActivityRow } from '../api/types';
import { useCollections } from '../composables/collections';
import { classifyDiffLines, type ClassifiedDiffLine } from '../lib/diff-lines';
import { revertRefused, revertRefusedSentence } from '../lib/readonly-source';
import { relativeTime } from '../lib/relative-time';

const props = defineProps<{
	collection: string;
	id: string;
}>();

// The same module-level `GET /collections` cache every other surface reads — the display contract,
// so `runtime` is the ENGINE's answer and not a second copy of it.
const { tree: collectionTree } = useCollections();
const collectionRow = computed(() => collectionTree.value.find((row) => row.collection === props.collection));
// Keyed on `runtime`: a runtime kind is writable by set/rename/rm, but `revert` is refused for all
// of them — a compiled record has no revision of its own to restore.
const restoreRefused = computed(() => revertRefused(collectionRow.value));
const restoreHint = computed(() => revertRefusedSentence(props.collection, collectionRow.value) || 'Restore this version');

const emit = defineEmits<{
	reverted: [];
}>();

const entries = ref<ActivityRow[]>([]);
const loading = ref(false);
const loaded = ref(false);
const error = ref<string | null>(null);

async function load(): Promise<void> {
	loading.value = true;
	error.value = null;

	try {
		// Rows are already scoped to this one record by the route — no filter needed.
		const query = buildQuery({
			sort: '-timestamp',
			fields: '*,user.first_name,user.last_name,user.email',
			limit: 50,
		});
		const res = await api.get<ActivityRow[]>(`/revisions/${encodeURIComponent(props.collection)}/${props.id}${query}`);
		entries.value = res.data;
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err);
	} finally {
		loading.value = false;
		loaded.value = true;
	}
}

onMounted(() => void load());

function authorOf(row: ActivityRow): string {
	const user = row.user;
	if (user == null) return 'system';
	if (typeof user === 'string') return user;
	return user.first_name || user.email || user.id || 'unknown';
}

/** Activity ids are `<sha>.<n>` with a full 40-char commit sha. */
function fullSha(id: string): string {
	return id.split('.')[0] ?? id;
}

/** Short hash for display — no extra fetch needed to get one, activity ids already carry the full sha. */
function shortHash(id: string): string {
	return fullSha(id).slice(0, 7);
}

function whenOf(row: ActivityRow): string {
	const date = new Date(row.timestamp);
	return Number.isNaN(date.getTime()) ? row.timestamp : relativeTime(date);
}

// --- diff expander -------------------------------------------------------------------------

interface DiffState {
	open: boolean;
	loading: boolean;
	loaded: boolean;
	error: string | null;
	lines: ClassifiedDiffLine[];
}

const diffs = reactive<Record<string, DiffState>>({});

function diffStateFor(rowId: string): DiffState {
	return (diffs[rowId] ??= { open: false, loading: false, loaded: false, error: null, lines: [] });
}

async function toggleDiff(row: ActivityRow): Promise<void> {
	const state = diffStateFor(row.id);
	state.open = !state.open;
	if (!state.open || state.loaded || state.loading) return;

	state.loading = true;
	state.error = null;
	try {
		// This commit vs its parent (`{hash, path, diff}` — unified diff text of the record file).
		const query = buildQuery({ hash: fullSha(row.id) });
		const res = await api.get<{ hash: string; path: string; diff: string }>(`/history-diff/${encodeURIComponent(props.collection)}/${props.id}${query}`);
		state.lines = classifyDiffLines(res.data.diff);
		state.loaded = true;
	} catch (err) {
		state.error = err instanceof Error ? err.message : String(err);
	} finally {
		state.loading = false;
	}
}

// --- restore ----------------------------------------------------------------------------------
// Semantics: the hash sent is the commit whose CONTENT gets restored (server: `git show
// hash:path`, validated, one new commit) — so the row action reads "restore [this version]".

const revertTarget = ref<ActivityRow | null>(null);
const revertConfirmOpen = ref(false);
const reverting = ref(false);
const revertError = ref<string | null>(null);

function askRevert(row: ActivityRow): void {
	// The disabled attribute already stops the click; this is the same refusal expressed where a
	// future caller (a keyboard path, a programmatic retry) would otherwise get past it.
	if (restoreRefused.value) return;
	revertError.value = null;
	revertTarget.value = row;
	revertConfirmOpen.value = true;
}

async function onConfirmRevert(): Promise<void> {
	const row = revertTarget.value;
	if (!row) return;
	reverting.value = true;
	revertError.value = null;
	try {
		await api.post(`/records-revert/${encodeURIComponent(props.collection)}/${props.id}`, { hash: fullSha(row.id) });
		revertConfirmOpen.value = false;
		await load(); // the restore lands as a NEW commit — the list refreshes to show it
		for (const key of Object.keys(diffs)) delete diffs[key]; // stale diffs (worktree just changed)
		emit('reverted');
	} catch (err) {
		// 400 when the historical content no longer validates against the current schema —
		// the server's message is specific, surface it verbatim.
		revertError.value = err instanceof Error ? err.message : String(err);
	} finally {
		reverting.value = false;
	}
}
</script>

<template>
	<section class="dt-history">
		<p v-if="loading && !loaded" class="dt-empty">Loading…</p>
		<p v-else-if="error" class="dt-error">{{ error }}</p>
		<p v-else-if="!entries.length" class="dt-empty">No history yet.</p>
		<ul v-else class="dt-history-list">
			<li v-for="row in entries" :key="row.id" class="dt-history-entry">
				<div class="dt-history-item">
					<span class="dt-history-action">{{ row.action }}</span>
					<span class="dt-history-author">{{ authorOf(row) }}</span>
					<span class="dt-history-when" :title="row.timestamp">{{ whenOf(row) }}</span>
				</div>
				<div class="dt-history-meta">
					<span class="dt-history-hash">{{ shortHash(row.id) }}</span>
					<button type="button" class="dt-history-link-btn" @click="toggleDiff(row)">
						{{ diffStateFor(row.id).open ? 'hide diff' : 'diff' }}
					</button>
					<button type="button" class="dt-history-link-btn dt-history-revert-btn" :disabled="restoreRefused" :title="restoreHint" @click="askRevert(row)">restore</button>
				</div>

				<div v-if="diffStateFor(row.id).open" class="dt-diff-body">
					<p v-if="diffStateFor(row.id).loading" class="dt-empty">Loading diff…</p>
					<p v-else-if="diffStateFor(row.id).error" class="dt-error">{{ diffStateFor(row.id).error }}</p>
					<p v-else-if="!diffStateFor(row.id).lines.length" class="dt-empty">No changes.</p>
					<pre v-else class="dt-diff-pre"><span
						v-for="(line, index) in diffStateFor(row.id).lines"
						:key="index"
						class="dt-diff-line"
						:class="`dt-diff-line-${line.kind}`"
					>{{ line.text }}
</span></pre>
				</div>
			</li>
		</ul>

		<AlertDialogRoot v-model:open="revertConfirmOpen">
			<AlertDialogPortal>
				<AlertDialogOverlay class="dt-dialog-overlay" />
				<AlertDialogContent class="dt-dialog">
					<AlertDialogTitle class="dt-dialog__title">Restore this version?</AlertDialogTitle>
					<p class="dt-dialog-description">
						This restores the record's content as of {{ revertTarget ? shortHash(revertTarget.id) : '' }} as a new commit. Current unsaved edits aren't affected.
					</p>
					<p v-if="revertError" class="dt-error">{{ revertError }}</p>
					<div class="dt-dialog-actions">
						<AlertDialogCancel class="dt-btn dt-btn--secondary">Cancel</AlertDialogCancel>
						<AlertDialogAction class="dt-btn dt-btn--danger" :disabled="reverting" @click="onConfirmRevert">
							{{ reverting ? 'Restoring…' : 'Restore' }}
						</AlertDialogAction>
					</div>
				</AlertDialogContent>
			</AlertDialogPortal>
		</AlertDialogRoot>
	</section>
</template>

<style scoped>
.dt-history {
	font-size: var(--dt-text);
}
.dt-empty {
	color: var(--dt-fg-subtle);
	font-size: var(--dt-text);
}
.dt-error {
	color: var(--dt-danger);
	font-size: var(--dt-text);
}
.dt-history-list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 4px;
}
.dt-history-entry {
	display: flex;
	flex-direction: column;
	padding: 8px 0;
	border-bottom: 1px solid var(--dt-border);
}
.dt-history-entry:last-child {
	border-bottom: none;
}
.dt-history-item {
	display: flex;
	align-items: baseline;
	gap: 6px;
	flex-wrap: wrap;
}
.dt-history-action {
	text-transform: uppercase;
	font-size: var(--dt-label);
	font-weight: 600;
	color: var(--dt-fg-subtle);
}
.dt-history-author {
	font-size: var(--dt-text);
	font-weight: 600;
	color: var(--dt-fg);
}
.dt-history-when {
	color: var(--dt-fg-subtle);
	font-size: var(--dt-label);
	margin-left: auto;
}
.dt-history-meta {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-top: 2px;
}
.dt-history-hash {
	font-family: var(--dt-font-mono);
	color: var(--dt-fg-subtle);
	font-size: var(--dt-label);
}
.dt-history-link-btn {
	background: none;
	border: none;
	color: var(--dt-fg-subtle);
	font-size: var(--dt-label);
	cursor: pointer;
	padding: 0;
	text-decoration: underline;
}
.dt-history-link-btn:hover {
	color: var(--dt-fg);
}
.dt-history-revert-btn {
	color: var(--dt-danger);
}
.dt-history-link-btn:disabled {
	color: var(--dt-fg-subtle);
	cursor: not-allowed;
	text-decoration-style: dotted;
}
.dt-diff-body {
	margin: 8px 0 0;
	padding: 8px;
	background: var(--dt-bg);
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius);
	overflow-x: auto;
}
.dt-diff-pre {
	margin: 0;
	font-family: var(--dt-font-mono);
	font-size: var(--dt-label);
	line-height: 1.5;
	white-space: pre;
}
.dt-diff-line {
	display: block;
}
.dt-diff-line-add {
	background: color-mix(in srgb, var(--dt-success) 15%, transparent);
	color: var(--dt-success);
}
.dt-diff-line-remove {
	background: color-mix(in srgb, var(--dt-danger) 12%, transparent);
	color: var(--dt-danger);
}
.dt-diff-line-meta {
	color: var(--dt-fg-subtle);
}
.dt-diff-line-context {
	color: var(--dt-fg);
}
</style>
