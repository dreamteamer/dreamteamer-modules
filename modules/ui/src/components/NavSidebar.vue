<script setup lang="ts">
/**
 * The NAV for a host with no native tree (dt web, a browser tab or a desktop session's pane). In VS Code
 * the extension's Collections tree is the nav and this component is never drawn: App.vue draws it only
 * when the host declares `window.__DT_HOST__.nav === 'app'`. The rows are the host's `GET /nav` — the
 * same model the editor's tree is built from — refetched when the host says the workspace changed. A list
 * is narrowed to some sources by its own filter chip, as in the editor (0.24.26 retired the scope toggle).
 *
 * cr-dt-008: the nav is `nav.yaml`, arranged by hand. A drop and every row menu entry is ONE NavOp sent as
 * `PATCH /nav`, built from the nodes' `target`s (never from a decoded key); the nav then redraws from `GET /nav`.
 * A refusal shows the host's sentence. Layers keep their own nav: a drop onto a layer row or the layers folder
 * sends nothing, and their rows have no menu. The workspace node's `notice` draws once above the tree.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { NavOp, NavTarget } from '@dreamteamer/protocol/nav-doc';
import { hostRequest } from '../api/transport';
import NavRow, { type DropWhere } from './NavRow';
import NavMenu, { type NavMenuItem } from './NavMenu.vue';

interface NavNode { kind: string; key: string; label: string; icon?: string; description?: string; tooltip?: string; route?: string; marks?: string; target?: NavTarget; notice?: string; children?: NavNode[] }

const LAYER_KINDS = new Set(['layers', 'layer', 'layer-group', 'layer-collection', 'layer-note']);
const ARRANGED = new Set(['folder', 'namespace', 'collection']);

const router = useRouter();
const nodes = ref<NavNode[]>([]);
const open = ref<Set<string>>(new Set(['workspace']));
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const dragging = ref<string | null>(null);
const hint = ref<{ key: string; where: DropWhere } | null>(null);
const menuAt = ref<{ key: string; x: number; y: number } | null>(null);
/** The names the last write left hidden — what Show hidden… offers. */
const hiddenNames = ref<string[]>([]);

/** Every node by key, and the node each one sits in. */
const index = computed(() => {
	const byKey = new Map<string, NavNode>();
	const parentOf = new Map<string, NavNode>();
	const walk = (list: NavNode[], parent?: NavNode) => {
		for (const n of list) {
			byKey.set(n.key, n);
			if (parent) parentOf.set(n.key, parent);
			if (n.children) walk(n.children, n);
		}
	};
	walk(nodes.value);
	return { byKey, parentOf };
});

async function load() {
	try {
		nodes.value = (await hostRequest('GET', '/nav')) as NavNode[];
		const said = nodes.value[0]?.notice;
		if (said) notice.value = said;
		error.value = null;
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	}
}

/** What Show hidden… offers from a written document: the names in `hidden`, then every namespace entry hidden in
 *  place (`hidden: true` — hide keeps a placed namespace's arrangement). */
function hiddenIn(doc: { tree?: unknown; hidden?: unknown }): string[] {
	const out = Array.isArray(doc.hidden) ? doc.hidden.filter((h): h is string => typeof h === 'string') : [];
	const walk = (items: unknown) => {
		if (!Array.isArray(items)) return;
		for (const e of items) {
			if (!e || typeof e !== 'object') continue;
			const entry = e as { namespace?: unknown; hidden?: unknown; items?: unknown };
			if (typeof entry.namespace === 'string' && entry.hidden === true && !out.includes(entry.namespace)) out.push(entry.namespace);
			walk(entry.items);
		}
	};
	walk(doc.tree);
	return out;
}

/** One gesture: one PATCH /nav, then the nav as the host now draws it — or the host's refusal, shown. */
async function send(op: NavOp | null) {
	menuAt.value = null;
	if (!op) return;
	try {
		const res = (await hostRequest('PATCH', '/nav', op)) as { doc?: { tree?: unknown; hidden?: unknown } } | null;
		if (res?.doc) hiddenNames.value = hiddenIn(res.doc);
		error.value = null;
		await load();
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

/** The level a node is placed in: `into` its folder or namespace, nothing at the top level. */
function parentInto(n: NavNode): { into?: NavTarget } {
	const p = index.value.parentOf.get(n.key);
	return p && p.kind !== 'workspace' && p.target ? { into: p.target } : {};
}
/** The arranged siblings of a node (layers and views are not), in drawn order. */
function siblingsOf(n: NavNode): NavNode[] {
	const p = index.value.parentOf.get(n.key);
	return (p?.children ?? nodes.value).filter((s) => s.target && ARRANGED.has(s.kind));
}

/** A drop of the dragged row onto `targetKey` as a move, or null when it means nothing (a layer, itself, no target). */
function dropOp(key: string | null, targetKey: string, where: DropWhere): NavOp | null {
	const dragged = key ? index.value.byKey.get(key) : undefined;
	let onto = index.value.byKey.get(targetKey);
	if (!dragged?.target || !onto || LAYER_KINDS.has(onto.kind) || dragged.key === onto.key) return null;
	if (onto.kind === 'view') { onto = index.value.parentOf.get(onto.key); where = 'after'; }
	if (!onto) return null;
	if (onto.kind === 'workspace') return { op: 'move', target: dragged.target, position: 'bottom' };
	if (!onto.target) return null;
	if (where === 'into' && (onto.kind === 'folder' || onto.kind === 'namespace')) return { op: 'move', target: dragged.target, into: onto.target };
	return { op: 'move', target: dragged.target, after: onto.target };
}

function onDrag(key: string) { dragging.value = key; }
function onHover(h: { key: string; where: DropWhere }) {
	const onto = index.value.byKey.get(h.key);
	hint.value = onto && !LAYER_KINDS.has(onto.kind) ? h : null;
}
function onMove(m: { key: string | null; targetKey: string; where: DropWhere }) {
	const op = dropOp(m.key ?? dragging.value, m.targetKey, m.where);
	dragging.value = null;
	hint.value = null;
	void send(op);
}

/** The entries of a row's menu, and what each sends. */
const menu = computed<{ items: NavMenuItem[]; act: (id: string, value?: string | null) => NavOp | null } | null>(() => {
	const at = menuAt.value;
	const n = at ? index.value.byKey.get(at.key) : undefined;
	if (!at || !n) return null;
	if (n.kind === 'workspace') {
		return {
			items: [
				{ id: 'new-folder', label: 'New folder…', ask: 'text', placeholder: 'Folder name' },
				{ id: 'show-hidden', label: 'Show hidden…', ask: 'text', placeholder: 'A hidden collection or namespace', suggestions: hiddenNames.value },
			],
			act: (id, value) => (id === 'new-folder' && value ? { op: 'new-folder', label: value }
				: id === 'show-hidden' && value ? { op: 'show', target: { name: value } } : null),
		};
	}
	if (!n.target || !ARRANGED.has(n.kind)) return null;
	const target = n.target;
	const sibs = siblingsOf(n);
	const i = sibs.findIndex((s) => s.key === n.key);
	const container = n.kind === 'folder' || n.kind === 'namespace';
	const items: NavMenuItem[] = [
		...(container ? [{ id: 'new-folder', label: 'New folder…', ask: 'text' as const, placeholder: 'Folder name' }] : []),
		...(n.kind === 'folder' ? [{ id: 'rename', label: 'Rename…', ask: 'text' as const, value: n.label }, { id: 'dissolve', label: 'Dissolve' }] : []),
		{ id: 'move-up', label: 'Move up', disabled: i <= 0 },
		{ id: 'move-down', label: 'Move down', disabled: i < 0 || i >= sibs.length - 1 },
		{ id: 'move-top', label: 'Move to top', disabled: i <= 0 },
		{ id: 'move-bottom', label: 'Move to bottom', disabled: i < 0 || i >= sibs.length - 1 },
		{ id: 'icon', label: 'Set icon…', ask: 'icon' },
		{ id: 'hide', label: 'Hide' },
	];
	const act = (id: string, value?: string | null): NavOp | null => {
		switch (id) {
			case 'new-folder': return value ? { op: 'new-folder', label: value, into: target } : null;
			case 'rename': return value && 'folder' in target ? { op: 'rename', target, label: value } : null;
			case 'dissolve': return 'folder' in target ? { op: 'dissolve', target } : null;
			// Move up: after the sibling two above, or to the top of the level when it is second
			case 'move-up': return i === 1 ? { op: 'move', target, ...parentInto(n), position: 'top' } : i > 1 ? { op: 'move', target, after: sibs[i - 2].target! } : null;
			case 'move-down': return i >= 0 && i < sibs.length - 1 ? { op: 'move', target, after: sibs[i + 1].target! } : null;
			case 'move-top': return { op: 'move', target, ...parentInto(n), position: 'top' };
			case 'move-bottom': return { op: 'move', target, ...parentInto(n), position: 'bottom' };
			case 'icon': return { op: 'icon', target, icon: value ?? null };
			case 'hide': return { op: 'hide', target };
		}
		return null;
	};
	return { items, act };
});

function onMenu(m: { key: string; x: number; y: number }) {
	const n = index.value.byKey.get(m.key);
	menuAt.value = n && !LAYER_KINDS.has(n.kind) ? m : null;
}
function onPick(p: { id: string; value?: string | null }) {
	const op = menu.value?.act(p.id, p.value) ?? null;
	void send(op);
}

const onMessage = (e: MessageEvent) => { if (e.data?.type === 'dt:invalidate') void load(); };
const onAway = () => { menuAt.value = null; };
onMounted(() => { void load(); window.addEventListener('message', onMessage); window.addEventListener('click', onAway); });
onUnmounted(() => { window.removeEventListener('message', onMessage); window.removeEventListener('click', onAway); });
</script>

<template>
	<nav class="dt-nav" aria-label="Workspace" @dragend="hint = null; dragging = null">
		<p v-if="notice" class="dt-nav-notice">
			<span>{{ notice }}</span>
			<button type="button" class="dt-nav-notice-close" title="Dismiss" @click="notice = null">×</button>
		</p>
		<p v-if="error" class="dt-nav-error">{{ error }}</p>
		<ul class="dt-nav-list" role="tree">
			<template v-for="n in nodes" :key="n.key">
				<NavRow :node="n" :depth="0" :open="open" :hint="hint" @toggle="toggle" @activate="activate" @drag="onDrag" @hover="onHover" @move="onMove" @menu="onMenu" />
			</template>
		</ul>
		<NavMenu v-if="menuAt && menu" :key="menuAt.key" :x="menuAt.x" :y="menuAt.y" :items="menu.items" @pick="onPick" @close="menuAt = null" />
	</nav>
</template>

<style scoped>
.dt-nav { width: 260px; flex: none; overflow-y: auto; background: var(--dt-bg-subtle); border-right: 1px solid var(--dt-border); font-size: var(--dt-text); }
/* a narrow pane (a desktop side pane can be 320 px): the nav gives up most of its width, so the page keeps a usable column */
@media (max-width: 560px) { .dt-nav { width: clamp(96px, 32vw, 260px); } }
.dt-nav-error { color: var(--dt-danger); padding: 6px 8px; }
.dt-nav-notice { display: flex; align-items: flex-start; gap: 6px; margin: 4px 6px; padding: 6px 8px; border-radius: var(--dt-radius); background: var(--dt-accent-subtle); color: var(--dt-fg); font-size: var(--dt-label); }
.dt-nav-notice span { flex: 1; }
.dt-nav-notice-close { background: none; border: 0; color: var(--dt-fg-subtle); cursor: pointer; font: inherit; padding: 0 2px; }
.dt-nav-list { list-style: none; margin: 0; padding: 4px 0; }
:deep(.dt-nav-row) { display: flex; align-items: center; gap: 4px; height: 24px; cursor: pointer; color: var(--dt-fg); white-space: nowrap; }
:deep(.dt-nav-row:hover) { background: var(--dt-bg-hover); }
:deep(.dt-nav-row[draggable='true']) { cursor: grab; }
:deep(.dt-nav-drop-after) { box-shadow: inset 0 -2px 0 var(--dt-accent); }
:deep(.dt-nav-drop-into) { background: var(--dt-accent-subtle); outline: 1px solid var(--dt-accent); outline-offset: -1px; }
:deep(.dt-nav-twisty) { width: 12px; color: var(--dt-fg-subtle); }
:deep(.dt-nav-label) { flex: 1; overflow: hidden; text-overflow: ellipsis; }
:deep(.dt-nav-count), :deep(.dt-nav-marks) { color: var(--dt-fg-subtle); font-size: var(--dt-label); padding-right: 8px; }
</style>
