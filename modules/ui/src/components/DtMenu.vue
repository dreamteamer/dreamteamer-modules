<!--
	THE ONE MENU. Every dropdown and context menu in the app is drawn by this component: the ⋯ menus on a record and on
	a field, the row density and commit menus, the new-record menu, the source picker, the nav's row menu and toolbar
	asks, the pane's switcher and level menus — and the panel of the two combobox dropdowns (DtSelect, the relation
	picker), which keep their own keyboard because focus stays in their search field.

	One surface: `.dt-menu` (base.css) — the background, `--dt-menu-border`, `--dt-menu-radius`, `--dt-shadow-menu` and
	`--dt-z-menu` — so each host's look comes from its tokens (VS Code maps them onto the editor theme). No animation:
	a menu appears and goes, so prefers-reduced-motion has nothing to stop.

	One keyboard (`keys`, lib/menu-keys.ts): on open focus goes to the first item (or the menu itself when it has none);
	arrows, Tab, Home/End and type-ahead move among the items, skipping disabled ones; Escape closes. A combobox passes
	`keys: false` and keeps its own.

	One dismissal (`dismiss`): Escape anywhere and a press outside the menu and its trigger emit `close` (once, however
	many listeners see the same key); focus then goes back to the trigger — unless the press outside put it somewhere
	else. The caller owns whether the menu is drawn (`v-if`) and what a pick does.

	Placement: ALWAYS `position: fixed`, so no scrolling or `overflow: hidden` ancestor clips it (a menu in a table cell, a
	VS Code webview's scroll container), on `--dt-z-menu`. Without `at` the menu hangs under its parent element (the box
	that holds the trigger — the trigger itself when teleported), on its start or `end` edge, computed from that box's
	rect (lib/menu-place.ts `placeMenu`): FLIPPED above it when there is no room below, and kept inside the window
	horizontally. It is placed again on every scroll (any scroller, capture phase) and resize, so it stays with its
	trigger. `at` is a fixed point in the viewport (a context menu, a menu hung from a toolbar button — the caller
	computes it with lib/menu-place.ts `menuUnder`), flipped above its trigger and clamped the same way (again on a
	resize), but not moved on scroll: a point has nothing to follow. `teleport` hangs it in <body> as well (the pane's menus) — the render test tier
	has no body, and draws it in place. Not teleporting is the default because a caller's scoped styles reach its menu's
	root only in place.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, toRaw } from 'vue';
import { MENU_ITEM_SELECTOR, menuMove, typeahead, typeaheadIndex, typedChar } from '../lib/menu-keys';
import { placeMenu, type Box } from '../lib/menu-place';

defineOptions({ inheritAttrs: false });

type El = {
	focus?: () => void;
	contains?: (n: unknown) => boolean;
	querySelectorAll?: (s: string) => ArrayLike<unknown>;
	getAttribute?: (n: string) => string | null;
	textContent?: string | null;
	parentElement?: El | null;
	parentNode?: El | null;
	getBoundingClientRect?: () => { top: number; bottom: number; left: number; right: number; width: number; height: number };
};

const props = withDefaults(defineProps<{
	/** The menu's accessible name. */
	label?: string;
	/** `menu` (actions, choices), `listbox` (a list of options — the source picker), or `presentation` for a combobox's
	 *  panel, whose own list carries the listbox role. */
	role?: 'menu' | 'listbox' | 'presentation';
	multiselectable?: boolean;
	/** A fixed point in the viewport; absent, the menu hangs under its parent element. */
	at?: { x: number; y: number } | null;
	/** Which edge of the parent an anchored menu lines up with. */
	align?: 'start' | 'end';
	/** `none`: the caller positions the panel itself (a combobox measuring its control). */
	anchor?: 'below' | 'none';
	/** The control that opened it: a press on it is not "outside", and focus goes back to it. Absent, the element that
	 *  had focus when the menu opened. */
	trigger?: unknown;
	/** Hang it in <body>. */
	teleport?: boolean;
	/** The menu keyboard and focus handling; false for a combobox that keeps focus in its own field. */
	keys?: boolean;
	/** Escape and a press outside close it; false when the caller does both itself. */
	dismiss?: boolean;
	/** On open (with `keys`): focus the first item (true), the menu itself (`'menu'` — arrows then enter it; for a menu
	 *  whose items open a card on focus), or nothing. A menu whose items arrive later calls `focusFirst()` itself. */
	autofocus?: boolean | 'menu';
	minWidth?: number;
}>(), { role: 'menu', at: null, align: 'start', anchor: 'below', teleport: false, keys: true, dismiss: true, autofocus: true, multiselectable: false });

const emit = defineEmits<{ close: [reason: 'escape' | 'outside'] }>();

const el = shallowRef<El | null>(null);
/** A document to hang the menu in (the render test tier has none). */
const hasBody = typeof document !== 'undefined' && !!(document as { body?: unknown }).body;
const portal = computed(() => props.teleport && hasBody);
/** Where the menu was placed to fit the window — null until it has been measured (the render tier never is). */
const placed = ref<{ left: number; top: number; flipped: boolean } | null>(null);

const raw = <T,>(x: T): T => (x && typeof x === 'object' ? (toRaw(x as object) as T) : x);
/** Who gets focus back: the trigger, else whatever had focus when the menu opened. */
const opener: El | null = (() => {
	try {
		const a = typeof document !== 'undefined' ? (document as { activeElement?: unknown }).activeElement : null;
		return (a as El | null) ?? null;
	} catch { return null; }
})();
const triggerEl = (): El | null => {
	const t = raw(props.trigger) as El | { $el?: El } | null;
	if (!t) return null;
	return ((t as { $el?: El }).$el ?? t) as El;
};

const classes = computed(() => ['dt-menu', props.at ? 'dt-menu--fixed' : props.anchor === 'below' ? 'dt-menu--below' : null, props.align === 'end' ? 'dt-menu--end' : null, placed.value?.flipped ? 'dt-menu--flipped' : null]);
const style = computed(() => {
	const s: Record<string, string> = {};
	if (placed.value) {
		s.left = `${placed.value.left}px`;
		s.top = `${placed.value.top}px`;
	} else if (props.at) {
		s.left = `${props.at.x}px`;
		s.top = `${props.at.y}px`;
	}
	if (props.minWidth) s.minWidth = `${props.minWidth}px`;
	return Object.keys(s).length ? s : undefined;
});

// ---- items and focus ---------------------------------------------------------------------------------------------
function isDisabled(x: El): boolean {
	return x.getAttribute?.('disabled') != null || x.getAttribute?.('aria-disabled') === 'true';
}
function items(): El[] {
	const list = raw(el.value)?.querySelectorAll?.(MENU_ITEM_SELECTOR);
	return list ? (Array.from(list) as El[]).filter((x) => !isDisabled(x)) : [];
}
let cursor = -1;
function focusAt(i: number, list = items()): void {
	if (!list.length || i < 0) {
		cursor = -1;
		raw(el.value)?.focus?.();
		return;
	}
	cursor = Math.min(i, list.length - 1);
	list[cursor]!.focus?.();
}
/** Focus the first item — for a menu whose items arrive after it opened (the workspace switcher's list). */
function focusFirst(): void {
	void nextTick(() => focusAt(0));
}
defineExpose({ focusFirst, el });

const same = (a: unknown, b: unknown) => a === b || raw(a) === raw(b);
function onFocusin(e: { target?: unknown }): void {
	const i = items().findIndex((x) => same(x, e.target));
	if (i >= 0) cursor = i;
}

const typed = typeahead();
type Key = { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: unknown; preventDefault?: () => void; stopPropagation?: () => void };
function onKeydown(e: Key): void {
	if (e.key === 'Escape') {
		if (!props.dismiss) return;
		e.preventDefault?.();
		// one Escape closes one layer: not the drawer or the filter panel behind the menu as well
		e.stopPropagation?.();
		close('escape');
		return;
	}
	if (!props.keys) return;
	const list = items();
	// keys typed into a field inside the menu (the nav's asks, an icon search) are the field's own
	if (e.target && !same(e.target, el.value) && !list.some((x) => same(x, e.target))) return;
	const to = menuMove(e.key, cursor, list.length, !!e.shiftKey);
	if (to !== null) {
		e.preventDefault?.();
		focusAt(to, list);
		return;
	}
	const ch = typedChar(e);
	if (!ch) return;
	const i = typeaheadIndex(list.map((x) => x.textContent ?? ''), typed(ch), cursor);
	if (i >= 0) {
		e.preventDefault?.();
		focusAt(i, list);
	}
}

// ---- dismissal -----------------------------------------------------------------------------------------------------
let closing = false;
/** Why the menu last closed itself — an outside press keeps focus where it went. */
let closedBy: 'escape' | 'outside' | null = null;
function close(reason: 'escape' | 'outside'): void {
	// the same key can reach the menu and the document: one close
	if (closing) return;
	closing = true;
	closedBy = reason;
	emit('close', reason);
	void Promise.resolve().then(() => { closing = false; });
}
function within(box: El | null | undefined, target: unknown): boolean {
	const b = raw(box);
	return !!b && typeof b.contains === 'function' && !!target && b.contains(target);
}
function onDocMousedown(e: { target?: unknown }): void {
	const anchor = triggerEl() ?? (props.at || portal.value ? null : raw(el.value)?.parentElement ?? null);
	if (within(el.value, e.target) || within(anchor, e.target)) return;
	close('outside');
}
function onDocKeydown(e: Key): void {
	if (e.key === 'Escape') onKeydown({ ...e, key: 'Escape', preventDefault: () => e.preventDefault?.(), stopPropagation: () => e.stopPropagation?.() });
}

/** The box an anchored menu hangs from: its parent element in place (the box holding the trigger), the trigger when
 *  teleported. */
function anchorBox(): El | null {
	if (portal.value) return triggerEl();
	const self = raw(el.value);
	return self?.parentElement ?? self?.parentNode ?? triggerEl();
}
/** Place the menu inside the window (see the header): measured, so only where there is layout. */
function place(): void {
	if (props.anchor === 'none' || typeof window === 'undefined') return;
	const w = window as { innerWidth?: number; innerHeight?: number };
	const r = raw(el.value)?.getBoundingClientRect?.();
	if (!r || !(r.width || r.height) || typeof w.innerWidth !== 'number' || typeof w.innerHeight !== 'number') return;
	const viewport = { width: w.innerWidth, height: w.innerHeight };
	const size = { width: r.width, height: r.height };
	if (props.at) {
		// a point: under it as asked, above the trigger (or the point) when that does not fit
		const t = triggerEl()?.getBoundingClientRect?.();
		const box: Box = { left: props.at.x, right: props.at.x + r.width, top: t && t.height ? t.top : props.at.y, bottom: props.at.y };
		placed.value = placeMenu(box, size, viewport, 'start', 0);
		return;
	}
	const a = anchorBox()?.getBoundingClientRect?.();
	if (!a) return;
	placed.value = placeMenu(a, size, viewport, props.align);
}
/** A scroll: an anchored menu follows its trigger; a point menu stays where it is. */
function onScroll(): void {
	if (!props.at) place();
}

onMounted(() => {
	if (props.dismiss && typeof document !== 'undefined') {
		document.addEventListener?.('mousedown', onDocMousedown as unknown as EventListener);
		document.addEventListener?.('keydown', onDocKeydown as unknown as EventListener);
	}
	// before the first paint: an anchored menu never shows at the window's corner first
	place();
	void nextTick(place);
	if (props.anchor !== 'none' && typeof window !== 'undefined') {
		window.addEventListener?.('scroll', onScroll, true);
		window.addEventListener?.('resize', place);
	}
	if (props.keys && props.autofocus) void nextTick(() => focusAt(props.autofocus === 'menu' ? -1 : 0));
});
onBeforeUnmount(() => {
	if (typeof document !== 'undefined') {
		document.removeEventListener?.('mousedown', onDocMousedown as unknown as EventListener);
		document.removeEventListener?.('keydown', onDocKeydown as unknown as EventListener);
	}
	if (typeof window !== 'undefined') {
		window.removeEventListener?.('scroll', onScroll, true);
		window.removeEventListener?.('resize', place);
	}
	if (!props.keys || closedBy === 'outside') return;
	// focus goes back to the trigger only when it was in the menu (or nowhere): a press elsewhere keeps its own
	let active: unknown = null;
	try { active = typeof document !== 'undefined' ? (document as { activeElement?: unknown }).activeElement : null; } catch { /* none */ }
	const body = typeof document !== 'undefined' ? (document as { body?: unknown }).body : undefined;
	if (active && active !== body && !within(el.value, active)) return;
	(triggerEl() ?? opener)?.focus?.();
});
</script>

<template>
	<Teleport v-if="portal" to="body">
		<div
			ref="el"
			v-bind="$attrs"
			:class="classes"
			:style="style"
			:role="role"
			:aria-label="label"
			:aria-multiselectable="role === 'listbox' && multiselectable ? 'true' : undefined"
			tabindex="-1"
			@keydown="onKeydown"
			@focusin="onFocusin"
		><slot /></div>
	</Teleport>
	<div
		v-else
		ref="el"
		v-bind="$attrs"
		:class="classes"
		:style="style"
		:role="role"
		:aria-label="label"
		:aria-multiselectable="role === 'listbox' && multiselectable ? 'true' : undefined"
		tabindex="-1"
		@keydown="onKeydown"
		@focusin="onFocusin"
	><slot /></div>
</template>

<style scoped>
.dt-menu {
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	outline: none;
	text-align: left;
}
/* fixed in both placements — coordinates come from the anchor's rect (see the header) */
.dt-menu--fixed,
.dt-menu--below {
	position: fixed;
}
</style>
