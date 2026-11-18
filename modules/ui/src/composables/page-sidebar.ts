/**
 * Right-sidebar section registration (spec §"App frame" item 4). Views register their own
 * sections — Info, Revisions, Layout options, etc — via `useSidebarSections(sections)` instead of
 * RightSidebar knowing about any specific view. Module-level reactive store so RightSidebar
 * (mounted once in App.vue, outside <router-view/>) can render whatever the *currently active*
 * view registered, and the registration auto-clears when that view unmounts (`onUnmounted`) so
 * navigating away empties the rail rather than leaking stale sections.
 *
 * Only one view is expected to register sections at a time (views live under a single
 * <router-view/>), so `register()` replaces the whole list rather than merging/appending.
 *
 * Ownership tokens: Vue flushes `onUnmounted` hooks as POST-render callbacks, so when navigating
 * between two registering views the NEW view's setup-time register() runs during the patch,
 * BEFORE the OLD view's queued unregister() flushes. An unconditional unregister would then wipe
 * the fresh registration (the "right panel randomly disappears" bug). Instead every register()
 * takes ownership and unregister() is a no-op unless its caller is still the owner.
 */
import type { Component } from 'vue';
import { onUnmounted, ref, shallowRef } from 'vue';

export interface SidebarSection {
	id: string;
	title: string;
	/** Material Symbols Outlined icon name, e.g. 'history', 'comment'. */
	icon: string;
	/** Use `markRaw(Component)` when registering to avoid Vue making the component reactive. */
	component: Component;
	props?: Record<string, unknown>;
}

// shallowRef, deliberately: a deep ref would reactive-wrap each section's `props`, and reactive
// proxies auto-unwrap top-level refs — passing a composable instance (whose properties ARE refs)
// as props would then crash every `.value` access inside the section component. Sections are
// replaced wholesale on register(), so shallow reactivity is sufficient to re-render.
const sections = shallowRef<SidebarSection[]>([]);
/** Id of the section the panel shows (tabs switch it; defaults to the first section). */
const activeId = ref<string | null>(null);
/**
 * Panel expanded state. Persisted across registrations (module-level, never reset by register())
 * so navigating between pages does NOT collapse a panel the operator deliberately opened —
 * VS Code's own side panels behave the same way.
 *
 * Was a modal drawer until 2026-07-27. It had to change: the Commands tab evaluates over the
 * table's CHECKBOX SELECTION, and a modal (overlay + focus trap) makes the table unreachable
 * while it's open — "the drawer is confusing to use with checkboxes". An inline panel in the
 * shell's flex row keeps both live at once.
 */
const open = ref(false);

let owner = 0;

function register(next: SidebarSection[]): number {
	sections.value = next;
	// Keep the operator's tab choice when the same section id exists on the new page (list → record
	// both register 'commands'), so navigating doesn't silently throw them back to tab one.
	if (!next.some((s) => s.id === activeId.value)) activeId.value = next[0]?.id ?? null;
	return ++owner;
}

function unregister(token: number): void {
	if (token !== owner) return;
	sections.value = [];
	activeId.value = null;
	// `open` deliberately survives — see the note on its declaration.
}

/** Show a section; expands the panel if it was collapsed (tab / rail click). */
function openSection(id: string): void {
	activeId.value = id;
	open.value = true;
}

function close(): void {
	open.value = false;
}

/** Collapse/expand toggle for the panel's own chevron. */
function toggle(): void {
	open.value = !open.value;
}

/**
 * Call from a view's `setup()` to register its right-sidebar sections. Registration is replaced
 * wholesale on every call (so reactive `sections` arrays work — call again when they change) and
 * auto-unregisters when the calling component unmounts (unless a newer view has already
 * registered over it — see the ownership-token note in the header).
 */
export function useSidebarSections(pageSections: SidebarSection[]): void {
	const token = register(pageSections);
	onUnmounted(() => unregister(token));
}

/** Consumed by RightSidebar.vue — the read/mutate surface for the shared store. */
export function useSidebarStore() {
	return { sections, activeId, open, openSection, close, toggle };
}
