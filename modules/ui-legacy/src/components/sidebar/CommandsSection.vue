<!--
	Right-sidebar 'Commands' section — the UI half of command-bindings (the engine half is
	`commandsFor` / `dreamteamer commands for`; this component only renders what that returns).

	Used from BOTH registration sites:
	- ContentDetail: `ids` = [the record's id] — per-record states (available / done /
	  not-applicable) become one badge per row.
	- BrowseView: `ids` = the checkbox selection (a computed Ref, live while the drawer is open) —
	  `scope: record` rows show n/m eligible; `scope: collection` rows are always runnable.

	Clicking a runnable command writes its ready-to-paste invocation (`/name <ref> …`, ELIGIBLE
	ids only — the engine's contract) into the editable textarea at the bottom; Copy puts it on
	the clipboard for whatever agent session the operator has open. Deliberately no execution
	magic — triggering a command IS a coding-agent turn, and that stays with the operator.

	cr-modules-017 §6: on a pane whose chat runs the prompt hook (GET /host `chat: true`), Ask in chat
	beside Copy queues the picked command and its eligible records for the chat's NEXT prompt
	(`POST /queue`) — still a turn the operator takes, only without the paste. The section then lists
	the queue's items for this collection, refetched on `dt:queue`.

	`ids` is accepted as plain array or Ref and unref()'d (see InfoSection's header for the
	ref-in-section-props story).
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, unref, watch, type Ref } from 'vue';
import { api } from '../../api/client';
import { hostRequest } from '../../api/transport';
import DtIcon from '../DtIcon.vue';
import { commandAllDone, commandIcon, commandStatus, type CommandRow } from '../../lib/command-rows';
import { hostInfo } from '../../lib/host-boot';
import { canAsk, itemLabel, type QueueItem } from '../../lib/queue-items';

const props = defineProps<{
	collection: string;
	ids: string[] | Ref<string[]>;
}>();

const ids = computed(() => unref(props.ids));
const rows = ref<CommandRow[]>([]);
const error = ref('');
const loading = ref(false);
const invocation = ref('');
const copied = ref(false);

async function load(): Promise<void> {
	loading.value = true;
	error.value = '';
	try {
		const query = ids.value.length ? `?ids=${encodeURIComponent(ids.value.join(','))}` : '';
		const { data } = await api.get<{ commands: CommandRow[] }>(`/commands/${encodeURIComponent(props.collection)}${query}`);
		rows.value = data.commands;
	} catch (err) {
		rows.value = [];
		error.value = err instanceof Error ? err.message : String(err);
	} finally {
		loading.value = false;
	}
}

onMounted(load);
// selection churn on the list page: re-evaluate, debounced — one engine call per settle
let timer: ReturnType<typeof setTimeout> | undefined;
watch(ids, () => {
	clearTimeout(timer);
	timer = setTimeout(() => void load(), 300);
});

const runnable = (row: CommandRow) => row.invocation !== null;

// per-row status text: single-record pages read as a state word, selections as counts
const statusText = (row: CommandRow): string => commandStatus(row, ids.value);

const pickedRow = ref<CommandRow | null>(null);

function pick(row: CommandRow): void {
	if (!runnable(row)) return;
	pickedRow.value = row;
	invocation.value = row.invocation ?? '';
	copied.value = false;
	askError.value = '';
}

// ---- Ask in chat (cr-modules-017) -----------------------------------------------------------
const askError = ref('');
const asking = ref(false);
const queue = ref<QueueItem[]>([]);
const showAsk = computed(() => !!pickedRow.value && canAsk(hostInfo.value, pickedRow.value));
const prefix = computed(() => `${props.collection}/`);
const queueHere = computed(() => queue.value.filter((i) => i.refs.some((r) => r.startsWith(prefix.value))));

async function loadQueue(): Promise<void> {
	if (!hostInfo.value?.chat) return;
	try {
		const answer = (await hostRequest('GET', '/queue')) as { items?: QueueItem[] } | null;
		queue.value = Array.isArray(answer?.items) ? answer!.items : [];
	} catch {
		/* the list is a convenience: a failed read leaves the last one */
	}
}

async function ask(): Promise<void> {
	const row = pickedRow.value;
	if (!row || asking.value) return;
	// the eligible records the invocation covers; a collection-scope row covers the ticked ones
	const targets = row.eligible ?? (row.scope === 'collection' ? ids.value : []);
	asking.value = true;
	askError.value = '';
	try {
		await hostRequest('POST', '/queue', { command: row.command, refs: targets.map((id) => `${props.collection}/${id}`) });
		await loadQueue();
	} catch (err) {
		askError.value = err instanceof Error ? err.message : String(err);
	} finally {
		asking.value = false;
	}
}

const onMessage = (e: MessageEvent) => {
	if (e.data?.type === 'dt:queue') void loadQueue();
};
onMounted(() => {
	window.addEventListener('message', onMessage as EventListener);
	void loadQueue();
});
onUnmounted(() => window.removeEventListener('message', onMessage as EventListener));

const textareaEl = ref<HTMLTextAreaElement | null>(null);

async function copy(): Promise<void> {
	if (!invocation.value) return;
	try {
		await navigator.clipboard.writeText(invocation.value);
	} catch {
		// webview clipboard permission can be withheld — classic fallback
		textareaEl.value?.select();
		document.execCommand('copy');
	}
	copied.value = true;
	setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
	<div class="dt-cmds">
		<p v-if="error" class="dt-cmds__error">{{ error }}</p>
		<p v-else-if="!loading && rows.length === 0" class="dt-cmds__empty">
			No commands bound to <strong>{{ collection }}</strong> — add a <code>command-bindings</code> record.
		</p>

		<ul class="dt-cmds__list">
			<li v-for="row in rows" :key="row.binding">
				<button
					type="button"
					class="dt-cmds__row"
					:class="{ 'is-runnable': runnable(row), 'is-done': commandAllDone(row, ids) }"
					:disabled="!runnable(row)"
					:title="row['argument-hint'] ? `/${row.name} ${row['argument-hint']}` : `/${row.name}`"
					@click="pick(row)"
				>
					<DtIcon class="dt-cmds__icon" :name="commandIcon(row)" />
					<span class="dt-cmds__text">
						<span class="dt-cmds__name">/{{ row.name }}</span>
						<span class="dt-cmds__desc">{{ row.description }}</span>
					</span>
					<span class="dt-cmds__state">{{ statusText(row) }}</span>
				</button>
			</li>
		</ul>

		<div class="dt-cmds__composer">
			<textarea
				ref="textareaEl"
				v-model="invocation"
				class="dt-cmds__textarea"
				rows="3"
				placeholder="pick a command — its invocation lands here, ready to paste into your session"
				spellcheck="false"
			/>
			<div class="dt-cmds__actions">
				<button v-if="showAsk" type="button" class="dt-btn dt-btn--secondary dt-cmds__ask" :disabled="asking" @click="ask">
					<DtIcon name="comment-discussion" />
					Ask in chat
				</button>
				<button type="button" class="dt-btn dt-btn--secondary dt-cmds__copy" :disabled="!invocation" @click="copy">
					<DtIcon :name="copied ? 'check' : 'copy'" />
					{{ copied ? 'Copied' : 'Copy' }}
				</button>
			</div>
			<p v-if="askError" class="dt-cmds__error">{{ askError }}</p>
			<ul v-if="queueHere.length" class="dt-cmds__queue">
				<li v-for="item in queueHere" :key="item.id" class="dt-cmds__queue-item" :data-state="item.state">
					<span class="dt-cmds__queue-cmd">{{ item.invocation }}</span>
					<span class="dt-cmds__queue-state">{{ itemLabel(item) }}</span>
				</li>
			</ul>
		</div>
	</div>
</template>

<style scoped>
/* Flat list, native-list styling: bordered cards per row plus three type treatments in one row was
   a chunk of the 'zoo' (operator 2026-07-27). Rows are borderless with a hover background like the
   workbench's own lists; every size comes from a token. */
.dt-cmds {
	display: flex;
	flex-direction: column;
	gap: var(--dt-space-3);
	height: 100%;
}
.dt-cmds__error {
	color: var(--dt-danger);
}
.dt-cmds__empty {
	color: var(--dt-fg-subtle);
}
.dt-cmds__list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	overflow-y: auto;
}
.dt-cmds__row {
	width: 100%;
	display: flex;
	align-items: center;
	gap: var(--dt-space-2);
	padding: var(--dt-space-1) var(--dt-space-2);
	border: none;
	border-radius: var(--dt-radius);
	background: transparent;
	color: var(--dt-fg);
	font-size: var(--dt-text);
	text-align: left;
	cursor: pointer;
}
.dt-cmds__row:disabled {
	opacity: 0.5;
	cursor: default;
}
.dt-cmds__row.is-runnable:hover {
	background: var(--dt-bg-hover);
}
.dt-cmds__icon {
	color: var(--dt-fg-subtle);
	flex-shrink: 0;
}
.dt-cmds__row.is-done .dt-cmds__icon {
	color: var(--dt-success);
}
.dt-cmds__text {
	display: flex;
	flex-direction: column;
	min-width: 0;
	flex: 1;
}
.dt-cmds__name {
	font-family: var(--dt-font-mono);
	font-size: var(--dt-text-mono);
	color: var(--dt-fg);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.dt-cmds__desc {
	color: var(--dt-fg-subtle);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.dt-cmds__state {
	font-size: var(--dt-label);
	color: var(--dt-fg-subtle);
	white-space: nowrap;
	flex-shrink: 0;
}
.dt-cmds__composer {
	margin-top: auto;
	display: flex;
	flex-direction: column;
	gap: var(--dt-space-2);
	border-top: 1px solid var(--dt-border);
	padding-top: var(--dt-space-3);
}
.dt-cmds__textarea {
	width: 100%;
	resize: vertical;
	font-family: var(--dt-font-mono);
	font-size: var(--dt-text-mono);
	padding: var(--dt-space-2);
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius);
	background: var(--dt-bg);
	color: var(--dt-fg);
}
.dt-cmds__actions {
	align-self: flex-end;
	display: flex;
	gap: var(--dt-space-2);
}
.dt-cmds__queue {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: var(--dt-space-1);
}
.dt-cmds__queue-item {
	display: flex;
	gap: var(--dt-space-2);
	align-items: baseline;
}
.dt-cmds__queue-cmd {
	flex: 1;
	min-width: 0;
	font-family: var(--dt-font-mono);
	font-size: var(--dt-text-mono);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.dt-cmds__queue-state {
	font-size: var(--dt-label);
	color: var(--dt-fg-subtle);
	white-space: nowrap;
}
.dt-cmds__queue-item[data-state='expired'] .dt-cmds__queue-state {
	color: var(--dt-warning);
}
</style>
