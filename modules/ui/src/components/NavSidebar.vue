<script setup lang="ts">
/**
 * The NAV for a host with no native tree (dt web, a browser tab or a desktop session's pane). In VS Code
 * the extension's Collections tree is the nav and this component is never drawn: App.vue draws it only
 * when the host declares `window.__DT_HOST__.nav === 'app'`. The rows are the host's `GET /nav` — the
 * same model the editor's tree is built from — refetched when the host says the workspace changed. A list
 * is narrowed to some sources by its own filter chip, as in the editor (0.24.26 retired the scope toggle).
 */
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { hostRequest } from '../api/transport';
import NavRow from './NavRow';

interface NavNode { kind: string; key: string; label: string; icon?: string; description?: string; tooltip?: string; route?: string; marks?: string; children?: NavNode[] }

const router = useRouter();
const nodes = ref<NavNode[]>([]);
const open = ref<Set<string>>(new Set(['workspace']));
const error = ref<string | null>(null);

async function load() {
	try {
		nodes.value = (await hostRequest('GET', '/nav')) as NavNode[];
		error.value = null;
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	}
}

function toggle(n: NavNode) {
	const s = new Set(open.value);
	if (s.has(n.key)) s.delete(n.key); else s.add(n.key);
	open.value = s;
}

function activate(n: NavNode) {
	if (n.route) void router.push(n.route);
	else if (n.children?.length) toggle(n);
}

const onMessage = (e: MessageEvent) => { if (e.data?.type === 'dt:invalidate') void load(); };
onMounted(() => { void load(); window.addEventListener('message', onMessage); });
onUnmounted(() => window.removeEventListener('message', onMessage));
</script>

<template>
	<nav class="dt-nav" aria-label="Workspace">
		<p v-if="error" class="dt-nav-error">{{ error }}</p>
		<ul class="dt-nav-list" role="tree">
			<template v-for="n in nodes" :key="n.key">
				<NavRow :node="n" :depth="0" :open="open" @toggle="toggle" @activate="activate" />
			</template>
		</ul>
	</nav>
</template>

<style scoped>
.dt-nav { width: 260px; flex: none; overflow-y: auto; background: var(--dt-bg-subtle); border-right: 1px solid var(--dt-border); font-size: var(--dt-text); }
.dt-nav-error { color: var(--dt-danger); padding: 6px 8px; }
.dt-nav-list { list-style: none; margin: 0; padding: 4px 0; }
:deep(.dt-nav-row) { display: flex; align-items: center; gap: 4px; height: 24px; cursor: pointer; color: var(--dt-fg); white-space: nowrap; }
:deep(.dt-nav-row:hover) { background: var(--dt-bg-hover); }
:deep(.dt-nav-twisty) { width: 12px; color: var(--dt-fg-subtle); }
:deep(.dt-nav-label) { flex: 1; overflow: hidden; text-overflow: ellipsis; }
:deep(.dt-nav-count), :deep(.dt-nav-marks) { color: var(--dt-fg-subtle); font-size: var(--dt-label); padding-right: 8px; }
</style>
