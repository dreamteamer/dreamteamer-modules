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
 *
 * The 2026-11-14 16:30 revision (the operator's try in the pane): a 32 px TOOLBAR above the rows — the page header's
 * first row's height, so the two read as one band — that never scrolls (the rows scroll beneath it, a thin shadow under
 * it while they are scrolled). Left, the workspace's name, once (the `name` slot: a pane host draws its switcher
 * there); right, icon buttons and the `end` slot (a pane host's level). The workspace node is NOT a row: its children
 * are the top level, at depth 0, and the empty area under the last row is the bottom of that level as a drop.
 * The ARRANGE LOCK starts locked on every load and is kept nowhere: locked, the nav only navigates (no row drags, takes
 * a drop or has a menu, and the cursor is the arrow); unlocked, today's drag and drop and row menus, plus New folder
 * and Show hidden… in the toolbar. A host that may not arrange (a pane at Read) passes `arrangeBlocked`, its reason:
 * the toggle is disabled with that reason as its tooltip, and an unlocked nav locks.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { NavOp, NavTarget } from '@dreamteamer/protocol/nav-doc';
import { hostRequest } from '../api/transport';
import NavRow, { NAV_DRAG_TYPE, type DropWhere } from './NavRow';
import NavMenu, { type NavMenuItem } from './NavMenu.vue';
import DtIcon from './DtIcon.vue';
import { menuUnder, rectOf, viewportWidth } from '../lib/menu-place';
import { openMenu } from '../lib/open-menu';
import { seedTitle } from '../lib/tabs';
import { dragWidth, keyWidth, loadNavWidth, navWidthBounds, saveNavWidth } from '../lib/nav-width';

interface NavNode { kind: string; key: string; label: string; icon?: string; description?: string; tooltip?: string; route?: string; marks?: string; target?: NavTarget; notice?: string; children?: NavNode[] }

const LAYER_KINDS = new Set(['layers', 'layer', 'layer-group', 'layer-collection', 'layer-note']);
const ARRANGED = new Set(['folder', 'namespace', 'collection']);
/** The hint key of the empty area under the last row — the bottom of the top level as a drop. */
const TAIL = '::tail';
/** The menu key of the toolbar's own buttons (New folder, Show hidden…). */
const TOOLBAR = '::toolbar';
/** The width a toolbar menu is placed for (NavMenu's text ask is 220 px wide plus its border). */
const MENU_WIDTH = 224;

const props = defineProps<{
	/** Why this nav may not be arranged (a pane at Read: "Arranging the nav needs Edit"); null or absent, it may. */
	arrangeBlocked?: string | null;
}>();

const router = useRouter();
const route = useRoute();
const nodes = ref<NavNode[]>([]);
const open = ref<Set<string>>(new Set());
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const dragging = ref<string | null>(null);
const hint = ref<{ key: string; where: DropWhere } | null>(null);
const menuAt = ref<{ key: string; x: number; y: number; start?: string; trigger?: unknown } | null>(null);
/** Unlocked: rows drag, take drops and have menus. Starts locked on every load; kept nowhere. */
const arranging = ref(false);
/** The rows are scrolled under the toolbar (its shadow shows). */
const scrolled = ref(false);
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

/** A route compared as text: decoded, without its query or a trailing slash. */
const routeText = (r: string) => { let p = r.split('?')[0].replace(/\/+$/, ''); try { p = decodeURIComponent(p); } catch { /* keep it as it is */ } return p; };
/** The CURRENT row (cr-modules-021): the row whose route is the open page's, or the deepest one the page sits under (a
 *  record page marks its collection). The workspace node is the toolbar's name, never a row, so it is never current. */
const currentKey = computed<string | null>(() => {
	const here = routeText(route?.path ?? '');
	if (!here) return null;
	let best: { key: string; len: number } | null = null;
	for (const n of index.value.byKey.values()) {
		if (!n.route || n.kind === 'workspace') continue;
		const r = routeText(n.route);
		if (!r || (here !== r && !here.startsWith(`${r}/`))) continue;
		if (!best || r.length > best.len) best = { key: n.key, len: r.length };
	}
	return best?.key ?? null;
});
// the current row is never hidden inside a closed folder: its folders open when the page changes
watch(currentKey, (key) => {
	if (!key) return;
	const s = new Set(open.value);
	let grew = false;
	for (let p = index.value.parentOf.get(key); p && p.kind !== 'workspace'; p = index.value.parentOf.get(p.key)) {
		if (!s.has(p.key)) { s.add(p.key); grew = true; }
	}
	if (grew) open.value = s;
});

/** The workspace node — drawn as the toolbar's name, never as a row. */
const workspace = computed(() => nodes.value.find((n) => n.kind === 'workspace') ?? null);
/** The rows at depth 0: the workspace node's children (and any other top node a host sends beside it). */
const topLevel = computed(() => nodes.value.flatMap((n) => (n.kind === 'workspace' ? n.children ?? [] : [n])));

// one nav menu at a time (lib/open-menu.ts): a row menu or a toolbar ask open closes a pane menu, and the other way
watch(menuAt, (m) => {
	if (m) openMenu.value = 'nav';
	else if (openMenu.value === 'nav') openMenu.value = null;
});
watch(openMenu, (o) => { if (o !== 'nav' && menuAt.value) menuAt.value = null; });

const blocked = computed(() => props.arrangeBlocked || null);
watch(blocked, (b) => { if (b) lock(); });

function lock() {
	arranging.value = false;
	menuAt.value = null;
	dragging.value = null;
	hint.value = null;
}
function toggleArrange() {
	if (arranging.value) { lock(); return; }
	if (blocked.value) return;
	arranging.value = true;
}
const lockTitle = computed(() => blocked.value
	? blocked.value
	: arranging.value
		? 'Arranging the nav: rows drag and have menus — click to lock it'
		: 'The nav is locked — click to arrange it (drag rows, row menus)');

async function load() {
	try {
		nodes.value = (await hostRequest('GET', '/nav')) as NavNode[];
		const said = nodes.value.find((n) => n.kind === 'workspace')?.notice ?? nodes.value[0]?.notice;
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

/** The toolbar's name: the workspace node's route (its settings — the root row's click before the revision). */
function openSettings() {
	const r = workspace.value?.route;
	if (r) void router.push(r);
}

function activate(n: NavNode) {
	if (n.route) { seedTitle(n.route, n.label, n.icon); void router.push(n.route); }
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
	if (!onto?.target) return null;
	const container = onto.kind === 'folder' || onto.kind === 'namespace';
	if (where === 'into' && container) return { op: 'move', target: dragged.target, into: onto.target };
	// the lower edge of an OPEN folder is the top of its first row, so it means the top inside it — one place per line
	if (where === 'after' && container && opensOnto(onto)) return { op: 'move', target: dragged.target, into: onto.target, position: 'top' };
	if (where === 'before') {
		// before the first row of a level is the top of that level; before any other, right after the row above it
		const sibs = siblingsOf(onto);
		const i = sibs.findIndex((s) => s.key === onto!.key);
		if (i === 0) return { op: 'move', target: dragged.target, ...parentInto(onto), position: 'top' };
		const above = i > 0 ? sibs[i - 1] : undefined;
		if (!above?.target) return null;
		if (above.key === dragged.key) return null; // already right there
		return { op: 'move', target: dragged.target, after: above.target };
	}
	return { op: 'move', target: dragged.target, after: onto.target };
}

/** A drop on the empty area under the last row: the bottom of the top level — nothing when it is already there. */
function tailOp(key: string | null): NavOp | null {
	const dragged = key ? index.value.byKey.get(key) : undefined;
	if (!dragged?.target || !ARRANGED.has(dragged.kind)) return null;
	const top = topLevel.value.filter((s) => s.target && ARRANGED.has(s.kind));
	if (top[top.length - 1]?.key === dragged.key) return null;
	return { op: 'move', target: dragged.target, position: 'bottom' };
}

/** An open folder or namespace whose arranged rows are drawn right under it. */
function opensOnto(n: NavNode): boolean {
	return open.value.has(n.key) && (n.children ?? []).some((c) => c.target && ARRANGED.has(c.kind));
}

function onDrag(key: string) { dragging.value = key; }
/** The line is drawn where the drop lands: a view row's drop is after its collection. */
function onHover(h: { key: string; where: DropWhere }) {
	const onto = index.value.byKey.get(h.key);
	if (!onto || LAYER_KINDS.has(onto.kind)) { hint.value = null; return; }
	if (onto.kind === 'view') { const p = index.value.parentOf.get(onto.key); hint.value = p ? { key: p.key, where: 'after' } : null; return; }
	hint.value = h;
}
/** The empty area under the last row: a drop line where it lands, then the bottom of the top level. Locked, the
 *  handlers are not bound at all (the template binds them only while arranging), so the browser shows no drop. */
function onTailOver(e: DragEvent) {
	e.preventDefault();
	hint.value = tailLine.value;
}
/** Where the empty area's drop line draws: where `position: bottom` lands — after the last ARRANGED top-level row, so
 *  above a Layers folder drawn below it (as a line on that row's top edge), else on the empty area's own top edge. */
const tailLine = computed<{ key: string; where: DropWhere }>(() => {
	const top = topLevel.value;
	let last = -1;
	top.forEach((n, i) => { if (n.target && ARRANGED.has(n.kind)) last = i; });
	const below = top[last + 1];
	return below ? { key: below.key, where: 'before' } : { key: TAIL, where: 'after' };
});
function onTailDrop(e: DragEvent) {
	e.preventDefault();
	e.stopPropagation();
	const op = tailOp(e.dataTransfer?.getData(NAV_DRAG_TYPE) || dragging.value);
	dragging.value = null;
	hint.value = null;
	void send(op);
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
	if (!at) return null;
	// the toolbar's New folder and Show hidden… are the entries the root row's menu had
	if (at.key === TOOLBAR) {
		return {
			items: [
				{ id: 'new-folder', label: 'New folder…', ask: 'text', placeholder: 'Folder name' },
				{ id: 'show-hidden', label: 'Show hidden…', ask: 'text', placeholder: 'A hidden collection or namespace', suggestions: hiddenNames.value },
			],
			act: (id, value) => (id === 'new-folder' && value ? { op: 'new-folder', label: value }
				: id === 'show-hidden' && value ? { op: 'show', target: { name: value } } : null),
		};
	}
	const n = index.value.byKey.get(at.key);
	if (!n?.target || !ARRANGED.has(n.kind)) return null;
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
	menuAt.value = arranging.value && n && !LAYER_KINDS.has(n.kind) ? m : null;
}
/** A toolbar button's menu, hung under the button and straight at its ask. */
function openToolbarMenu(id: 'new-folder' | 'show-hidden', e: MouseEvent) {
	if (!arranging.value) return;
	if (menuAt.value?.key === TOOLBAR && menuAt.value.start === id) { menuAt.value = null; return; }
	const at = menuUnder(rectOf(e.currentTarget), 'start', MENU_WIDTH, viewportWidth());
	menuAt.value = { key: TOOLBAR, ...at, start: id, trigger: e.currentTarget };
}
function onRowsScroll(e: Event) {
	scrolled.value = ((e.target as { scrollTop?: number } | null)?.scrollTop ?? 0) > 0;
}
function onPick(p: { id: string; value?: string | null }) {
	const op = menu.value?.act(p.id, p.value) ?? null;
	void send(op);
}

// ---- the nav's width (browser host; the editor never draws this nav) ------------------------------------------------
// A drag on the edge, the arrow keys on it (Home/End: the bounds) or a double-click (the default). Kept per browser by
// lib/nav-width.ts; with nothing kept the token's default governs, so the stylesheet alone draws a fresh nav.
const navEl = ref<HTMLElement | null>(null);
const bounds = ref(navWidthBounds());
/** The width a person chose, or null: the token's default. */
const chosen = ref<number | null>(loadNavWidth(bounds.value));
const navWidth = computed(() => chosen.value ?? bounds.value.def);
/** A drag in progress: no transition runs while the edge follows the pointer. */
const resizing = ref(false);
const navStyle = computed(() => (chosen.value == null ? undefined : { '--dt-nav-w': `${chosen.value}px` }));
let drag: { x: number; w: number } | null = null;

function navDir(): 'ltr' | 'rtl' {
	try { return navEl.value && typeof getComputedStyle === 'function' && getComputedStyle(navEl.value).direction === 'rtl' ? 'rtl' : 'ltr'; } catch { return 'ltr'; }
}
function setWidth(w: number) {
	chosen.value = w;
	saveNavWidth(w);
}
function onResizeKey(e: KeyboardEvent) {
	const next = keyWidth(navWidth.value, e.key, bounds.value, { shift: e.shiftKey, dir: navDir() });
	if (next == null) return;
	e.preventDefault();
	setWidth(next);
}
function onResizeDown(e: PointerEvent) {
	if (e.button !== 0) return;
	e.preventDefault();
	drag = { x: e.clientX, w: navWidth.value };
	resizing.value = true;
	try { (e.currentTarget as Element | null)?.setPointerCapture?.(e.pointerId); } catch { /* no capture: moves still arrive while over the edge */ }
}
function onResizeMove(e: PointerEvent) {
	if (!drag) return;
	chosen.value = dragWidth(drag.w, drag.x, e.clientX, bounds.value, navDir());
}
function onResizeEnd() {
	if (!drag) return;
	drag = null;
	resizing.value = false;
	if (chosen.value != null) saveNavWidth(chosen.value);
}
function resetWidth() {
	drag = null;
	resizing.value = false;
	chosen.value = null;
	saveNavWidth(null);
}

const onMessage = (e: MessageEvent) => { if (e.data?.type === 'dt:invalidate') void load(); };
const onAway = () => { menuAt.value = null; };
onMounted(() => {
	void load();
	window.addEventListener('message', onMessage);
	window.addEventListener('click', onAway);
	// the stylesheet is in by now: read the bounds it declares, and keep a kept width inside them
	bounds.value = navWidthBounds();
	if (chosen.value != null) chosen.value = loadNavWidth(bounds.value);
});
onUnmounted(() => { window.removeEventListener('message', onMessage); window.removeEventListener('click', onAway); });
</script>

<template>
	<nav ref="navEl" class="dt-nav" :class="{ 'dt-nav--arranging': arranging, 'dt-nav--resizing': resizing }" :style="navStyle" aria-label="Workspace" @dragend="hint = null; dragging = null">
		<div class="dt-nav-toolbar" :class="{ 'dt-nav-toolbar--scrolled': scrolled }" role="toolbar" aria-label="Nav">
			<div class="dt-nav-toolbar__name">
				<slot name="name" :label="workspace?.label ?? ''">
					<button
						v-if="workspace?.route"
						type="button"
						class="dt-nav-toolbar__label dt-nav-toolbar__settings"
						:title="`${workspace.label} — Workspace settings`"
						@click.stop="openSettings"
					>{{ workspace.label }}</button>
					<span v-else class="dt-nav-toolbar__label" :title="workspace?.label ?? undefined">{{ workspace?.label ?? '' }}</span>
				</slot>
			</div>
			<div class="dt-nav-toolbar__buttons">
				<template v-if="arranging">
					<button type="button" class="dt-nav-tool" data-tool="new-folder" title="New folder…" aria-label="New folder" @click.stop="openToolbarMenu('new-folder', $event)"><DtIcon name="new-folder" /></button>
					<button type="button" class="dt-nav-tool" data-tool="show-hidden" title="Show hidden…" aria-label="Show hidden" @click.stop="openToolbarMenu('show-hidden', $event)"><DtIcon name="eye-closed" /></button>
				</template>
				<button
					type="button"
					class="dt-nav-tool dt-nav-lock"
					data-tool="arrange"
					:aria-pressed="arranging ? 'true' : 'false'"
					aria-label="Arrange the nav"
					:title="lockTitle"
					:disabled="(!!blocked && !arranging) || undefined"
					@click.stop="toggleArrange"
				>
					<DtIcon name="list-tree" />
					<span class="dt-nav-lock__badge codicon" :class="arranging ? 'codicon-unlock' : 'codicon-lock-small'" aria-hidden="true"></span>
				</button>
				<slot name="end" />
			</div>
		</div>
		<p v-if="notice" class="dt-nav-notice">
			<span>{{ notice }}</span>
			<button type="button" class="dt-nav-notice-close" title="Dismiss" @click="notice = null">×</button>
		</p>
		<p v-if="error" class="dt-nav-error">{{ error }}</p>
		<div class="dt-nav-rows" @scroll="onRowsScroll">
			<ul class="dt-nav-list" role="tree">
				<template v-for="n in topLevel" :key="n.key">
					<NavRow :node="n" :depth="0" :open="open" :hint="hint" :arrange="arranging" :current="currentKey" @toggle="toggle" @activate="activate" @drag="onDrag" @hover="onHover" @move="onMove" @menu="onMenu" />
				</template>
			</ul>
			<div v-if="arranging" class="dt-nav-tail" :class="{ 'dt-nav-drop-tail': hint?.key === TAIL }" data-key="::tail" @dragover="onTailOver" @drop="onTailDrop"></div>
			<div v-else class="dt-nav-tail" data-key="::tail"></div>
		</div>
		<div
			class="dt-nav-resize"
			role="separator"
			aria-orientation="vertical"
			aria-label="Nav width"
			:aria-valuenow="navWidth"
			:aria-valuemin="bounds.min"
			:aria-valuemax="bounds.max"
			tabindex="0"
			title="Drag to resize the nav — double-click to reset"
			@pointerdown="onResizeDown"
			@pointermove="onResizeMove"
			@pointerup="onResizeEnd"
			@pointercancel="onResizeEnd"
			@lostpointercapture="onResizeEnd"
			@keydown="onResizeKey"
			@dblclick="resetWidth"
		></div>
		<NavMenu v-if="menuAt && menu" :key="`${menuAt.key}:${menuAt.start ?? ''}`" :x="menuAt.x" :y="menuAt.y" :items="menu.items" :start="menuAt.start" :trigger="menuAt.trigger" @pick="onPick" @close="menuAt = null" />
	</nav>
</template>

<style scoped>
/* The nav is a column: the toolbar never scrolls, the rows scroll beneath it. */
/* On the canvas (cr-modules-022): no ground of its own and no line — the sheet beside it carries the edge. */
.dt-nav { position: relative; width: var(--dt-nav-w, var(--dt-nav-width)); flex: none; display: flex; flex-direction: column; min-height: 0; overflow: hidden; background: transparent; font-size: var(--dt-text); cursor: default; }
/* a narrow pane (a desktop side pane can be 320 px): the nav gives up most of its width, so the page keeps a usable column */
@media (max-width: 560px) { .dt-nav { width: clamp(96px, 32vw, var(--dt-nav-w, var(--dt-nav-width))); } }
/* THE EDGE (browser host): a 6 px strip on the nav's inline end — col-resize, a hairline on hover, the focus colour while
   focused or dragged. Nothing animates while a drag is on: the edge follows the pointer, not a transition. */
.dt-nav-resize { position: absolute; top: 0; bottom: 0; inset-inline-end: 0; z-index: 3; width: 6px; cursor: col-resize; touch-action: none; outline: none; }
.dt-nav-resize::after { content: ''; position: absolute; top: 0; bottom: 0; inset-inline-end: 0; width: 2px; background: transparent; transition: background-color var(--dt-dur-fast) var(--dt-ease); }
.dt-nav-resize:hover::after { background: var(--dt-ink-4); }
.dt-nav-resize:focus-visible::after, .dt-nav--resizing .dt-nav-resize::after { background: var(--dt-focus-ring); }
/* the width itself never transitions; while dragging, the rows' hover fades are off too so nothing lags the pointer */
.dt-nav--resizing .dt-nav-resize::after, .dt-nav--resizing :deep(.dt-nav-row)::before { transition: none; }
.dt-nav--resizing { user-select: none; cursor: col-resize; }
/* 32 px: the page header's first row (history, path, search, refresh), so the two read as one band across the window.
   Narrow, the name gives way first (its basis is 0, its min-width 0) and the buttons, which shrink only once it is
   gone, wrap to a second line rather than being clipped. */
.dt-nav-toolbar { position: relative; z-index: 2; flex: none; display: flex; align-items: center; gap: 4px; box-sizing: border-box; min-height: 32px; padding: 3px 4px 3px 10px; background: var(--dt-canvas); transition: box-shadow var(--dt-dur-fast) var(--dt-ease); }
.dt-nav-toolbar--scrolled { box-shadow: 0 1px 3px rgb(0 0 0 / 0.14); }
.dt-nav-toolbar__name { flex: 1 1 0; min-width: 0; display: flex; align-items: center; overflow: hidden; }
.dt-nav-toolbar__label, :deep(.dt-nav-toolbar__label) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--dt-fg); }
.dt-nav-toolbar__settings { max-width: 100%; height: 24px; margin: 0; padding: 0 4px; border: 0; border-radius: var(--dt-radius); background: transparent; font: inherit; font-weight: 600; text-align: left; cursor: default; }
.dt-nav-toolbar__settings:hover { background: var(--dt-ink-3); }
.dt-nav-toolbar__buttons { flex: 0 1 auto; min-width: 0; display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 2px; }
/* the one icon-button shape (base.css .dt-btn--icon): the control height, the control radius, a press */
.dt-nav-tool, :deep(.dt-nav-tool) { position: relative; flex: none; display: inline-flex; align-items: center; justify-content: center; width: var(--dt-control-height); height: var(--dt-control-height); padding: 0; border: 0; border-radius: var(--dt-radius); background: transparent; color: var(--dt-fg-subtle); font: inherit; cursor: default; transition: background-color var(--dt-dur-fast) ease, transform var(--dt-dur-fast) var(--dt-ease); }
.dt-nav-tool:active:not(:disabled), :deep(.dt-nav-tool:active:not(:disabled)) { transform: scale(0.97); }
.dt-nav-tool:hover:not(:disabled), :deep(.dt-nav-tool:hover:not(:disabled)) { background: var(--dt-ink-3); color: var(--dt-fg); }
.dt-nav-tool:disabled { opacity: 0.45; }
.dt-nav-tool[aria-pressed='true'] { background: var(--dt-accent-subtle); color: var(--dt-accent); }
.dt-nav-tool .codicon, :deep(.dt-nav-tool .codicon) { font-size: var(--dt-icon); }
/* the lock is a badge on the tree: bottom-right, cut out of the button's ground so it reads at 16 px */
.dt-nav-lock .dt-nav-lock__badge { position: absolute; right: 1px; bottom: 1px; font-size: var(--dt-text-2xs); line-height: 10px; border-radius: var(--dt-radius-xs); background: var(--dt-canvas); }
.dt-nav-lock[aria-pressed='true'] .dt-nav-lock__badge { background: var(--dt-accent-subtle); }
.dt-nav-error { color: var(--dt-danger); padding: 6px 8px; margin: 0; flex: none; }
.dt-nav-notice { flex: none; display: flex; align-items: flex-start; gap: 6px; margin: 4px 6px; padding: 6px 8px; border-radius: var(--dt-radius); background: var(--dt-accent-subtle); color: var(--dt-fg); font-size: var(--dt-label); }
.dt-nav-notice span { flex: 1; }
.dt-nav-notice-close { background: none; border: 0; color: var(--dt-fg-subtle); cursor: default; font: inherit; padding: 0 2px; }
.dt-nav-rows { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
.dt-nav-list { flex: none; list-style: none; margin: 0; padding: 0 0 4px; }
/* the empty area under the last row: the bottom of the top level as a drop, its line on the top edge */
.dt-nav-tail { flex: 1 0 24px; }
.dt-nav-drop-tail { box-shadow: inset 0 2px 0 var(--dt-accent); }
/* the ordinary arrow everywhere; the grab hand only on a row that can be dragged, which is only while arranging.
   ROWS (cr-modules-021): 30 px tall on one x-grid — a 14 px twisty slot, a 16 px icon box and the label, then ONE right-hand
   column for marks and counts. The highlight is a ::before layer inset 6 px from each side, so hover (a light accent tint)
   and the current row (a white card with a hairline ring, weight 600) never move the icon or the label. */
:deep(.dt-nav-row) { position: relative; isolation: isolate; display: flex; align-items: center; gap: 6px; height: 30px; padding-right: 14px; cursor: default; color: var(--dt-fg); white-space: nowrap; }
:deep(.dt-nav-row)::before { content: ''; position: absolute; inset: 1px 6px; z-index: -1; border-radius: var(--dt-radius-lg); background: transparent; transition: background-color var(--dt-dur-fast) var(--dt-ease), box-shadow var(--dt-dur-fast) var(--dt-ease); }
:deep(.dt-nav-row:hover)::before { background: var(--dt-accent-tint); }
:deep(.dt-nav-row.is-current)::before { background: var(--dt-surface); box-shadow: var(--dt-shadow-card); }
:deep(.dt-nav-row.is-current) { font-weight: var(--dt-weight-strong); }
:deep(.dt-nav-row.is-current .dt-nav-icon) { color: var(--dt-accent); }
:deep(.dt-nav-row:focus-visible) { outline: none; }
:deep(.dt-nav-row:focus-visible)::before { outline: var(--dt-focus-outline); outline-offset: var(--dt-focus-offset); }
:deep(.dt-nav-row[draggable='true']) { cursor: grab; }
:deep(.dt-nav-drop-after) { box-shadow: inset 0 -2px 0 var(--dt-accent); }
:deep(.dt-nav-drop-before) { box-shadow: inset 0 2px 0 var(--dt-accent); }
:deep(.dt-nav-drop-into)::before { background: var(--dt-accent-subtle); box-shadow: 0 0 0 1px var(--dt-accent); }
:deep(.dt-nav-twisty) { flex: none; width: 14px; display: inline-flex; justify-content: center; color: var(--dt-fg-muted); }
:deep(.dt-nav-twisty .codicon) { font-size: var(--dt-label); }
:deep(.dt-nav-icon) { flex: none; width: var(--dt-icon); height: var(--dt-icon); display: inline-flex; align-items: center; justify-content: center; color: var(--dt-fg-subtle); }
:deep(.dt-nav-label) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
:deep(.dt-nav-end) { flex: none; min-width: 24px; display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; color: var(--dt-fg-muted); font-size: var(--dt-label); font-variant-numeric: tabular-nums; }
/* A SECTION — a folder, namespace or layers row at the top level: a small uppercase, letter-spaced, muted label */
:deep(.dt-nav-section) { margin-top: 2px; color: var(--dt-fg-subtle); }
:deep(.dt-nav-section .dt-nav-label) { font-size: var(--dt-label); font-weight: var(--dt-weight-strong); text-transform: uppercase; letter-spacing: 0.05em; }
:deep(.dt-nav-section .dt-nav-icon) { color: var(--dt-fg-muted); }
</style>
