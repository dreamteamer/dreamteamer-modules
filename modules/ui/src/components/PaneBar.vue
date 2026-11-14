<script setup lang="ts">
/**
 * THE PANE BAR (cr-modules-017 §4, §7) — drawn by App only on a pane host (GET /host answered a workspace id;
 * reading 3: never in the editor). Left, the workspace as a menu of the workspaces `dt web open` registered on
 * this machine: a pick asks this server to hand the pane over (`POST /_dt/handoff`) and goes to the URL it answers.
 * Right, the level chip: its menu LOWERS the level (`POST /_dt/level`) and never raises it — the last line sends a
 * person to the chat, where `dt web open --edit|--admin` is. A raise in force draws its notice beside the chip.
 *
 * /_dt/ is the server's own prefix, not a protocol route, so the bar calls it with the browser's fetch, the
 * cookie (same-origin) and a JSON Content-Type; a refusal shows the server's sentence in the bar.
 */
import { computed, ref } from 'vue';
import { hostInfo, loadHost } from '../lib/host-boot';
import { levelWord, lowerChoices, raiseNotice, type PaneLevel } from '../lib/pane-level';

interface WorkspaceRow { id: string; name: string; running: boolean; current: boolean }

const level = computed<PaneLevel>(() => (hostInfo.value?.level as PaneLevel | undefined) ?? 'read');
const name = computed(() => hostInfo.value?.workspace?.name ?? '');
const notice = computed(() => (hostInfo.value ? raiseNotice({ level: level.value, raisedAt: hostInfo.value.raisedAt }) : null));
const lowers = computed(() => lowerChoices(level.value));

const wsOpen = ref(false);
const levelOpen = ref(false);
const workspaces = ref<WorkspaceRow[]>([]);
const error = ref<string | null>(null);
const busy = ref(false);

async function dt(method: string, path: string, body?: unknown): Promise<any> {
	const res = await fetch(path, {
		method,
		credentials: 'same-origin',
		headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	let data: any = null;
	try { data = await res.json(); } catch { /* no body */ }
	if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `the server answered ${res.status}`);
	return data;
}

async function toggleWorkspaces(): Promise<void> {
	levelOpen.value = false;
	wsOpen.value = !wsOpen.value;
	if (!wsOpen.value) return;
	error.value = null;
	try {
		const rows = await dt('GET', '/_dt/workspaces');
		workspaces.value = Array.isArray(rows) ? rows : [];
	} catch (e) {
		error.value = (e as Error).message;
	}
}

async function pick(w: WorkspaceRow): Promise<void> {
	if (w.current || busy.value) { wsOpen.value = false; return; }
	busy.value = true;
	error.value = null;
	try {
		const answer = await dt('POST', '/_dt/handoff', { id: w.id });
		wsOpen.value = false;
		if (typeof answer?.url === 'string') window.location.href = answer.url;
	} catch (e) {
		error.value = (e as Error).message;
	} finally {
		busy.value = false;
	}
}

function toggleLevel(): void {
	wsOpen.value = false;
	levelOpen.value = !levelOpen.value;
}

async function lower(to: PaneLevel): Promise<void> {
	error.value = null;
	try {
		await dt('POST', '/_dt/level', { level: to });
		levelOpen.value = false;
		await loadHost();
	} catch (e) {
		error.value = (e as Error).message;
	}
}
</script>

<template>
	<div class="dt-pane-bar">
		<div class="dt-pane-bar__ws">
			<button type="button" class="dt-pane-bar__ws-button" aria-haspopup="menu" :aria-expanded="wsOpen ? 'true' : 'false'" @click.stop="toggleWorkspaces">{{ name }}</button>
			<div v-if="wsOpen" class="dt-pane-bar__menu" role="menu">
				<button
					v-for="w in workspaces"
					:key="w.id"
					type="button"
					role="menuitemradio"
					class="dt-pane-bar__ws-item"
					:data-id="w.id"
					:aria-checked="w.current ? 'true' : 'false'"
					@click.stop="pick(w)"
				>{{ w.name }} <span v-if="!w.current && !w.running" class="dt-pane-bar__muted">starts when opened</span></button>
				<p v-if="!workspaces.length" class="dt-pane-bar__hint">No other workspace was opened on this machine</p>
			</div>
		</div>
		<span v-if="error" class="dt-pane-bar__error" role="alert">{{ error }}</span>
		<span class="dt-pane-bar__spacer" />
		<span v-if="notice" class="dt-pane-bar__notice">{{ notice }}</span>
		<div class="dt-pane-bar__level">
			<button type="button" class="dt-pane-bar__chip" :data-level="level" aria-haspopup="menu" :aria-expanded="levelOpen ? 'true' : 'false'" @click.stop="toggleLevel">{{ levelWord(level) }}</button>
			<div v-if="levelOpen" class="dt-pane-bar__menu dt-pane-bar__menu--right" role="menu">
				<button v-for="l in lowers" :key="l" type="button" role="menuitem" class="dt-pane-bar__lower" :data-level="l" @click.stop="lower(l)">{{ levelWord(l) }}</button>
				<p class="dt-pane-bar__hint">To raise it, ask in the chat</p>
			</div>
		</div>
	</div>
</template>

<style scoped>
.dt-pane-bar {
	display: flex;
	align-items: center;
	gap: 8px;
	min-height: 28px;
	padding: 2px var(--dt-page-pad, 12px);
	border-bottom: 1px solid var(--dt-border);
	background: var(--dt-bg-subtle);
	font-size: var(--dt-text, 13px);
	flex-wrap: wrap;
}
.dt-pane-bar__ws,
.dt-pane-bar__level {
	position: relative;
}
.dt-pane-bar__ws-button,
.dt-pane-bar__chip {
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius);
	background: var(--dt-bg);
	color: var(--dt-fg);
	padding: 1px 8px;
	cursor: pointer;
	font: inherit;
}
.dt-pane-bar__ws-button {
	max-width: 40vw;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.dt-pane-bar__chip[data-level='admin'] {
	border-color: var(--dt-warning);
}
.dt-pane-bar__spacer {
	flex: 1;
}
.dt-pane-bar__menu {
	position: absolute;
	top: calc(100% + 2px);
	left: 0;
	z-index: 50;
	min-width: 180px;
	display: flex;
	flex-direction: column;
	padding: 4px;
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius);
	background: var(--dt-bg);
	box-shadow: var(--dt-shadow);
}
.dt-pane-bar__menu--right {
	left: auto;
	right: 0;
}
.dt-pane-bar__menu button {
	text-align: left;
	border: 0;
	background: none;
	color: var(--dt-fg);
	padding: 4px 8px;
	border-radius: var(--dt-radius);
	cursor: pointer;
	font: inherit;
}
.dt-pane-bar__menu button:hover {
	background: var(--dt-bg-hover);
}
.dt-pane-bar__menu button[aria-checked='true'] {
	font-weight: 600;
}
.dt-pane-bar__hint,
.dt-pane-bar__muted,
.dt-pane-bar__notice {
	color: var(--dt-fg-muted);
	margin: 0;
}
.dt-pane-bar__hint {
	padding: 4px 8px;
	border-top: 1px solid var(--dt-border);
}
.dt-pane-bar__error {
	color: var(--dt-danger);
}
</style>
