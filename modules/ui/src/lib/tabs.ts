/**
 * PILL TABS (cr-modules-022) — the browser host's open pages. Every route a person opens is a tab, keyed by its path
 * (a list's query — its filter, sort, page — rides along on the tab and is not a new tab); opening a route that has
 * a tab focuses it. Closing the open tab selects its right-hand neighbour, else its left. No preview tabs, no pinning,
 * no reordering. The list is kept in localStorage so a reload restores it.
 *
 * Pure functions over a plain list, plus one store the shell uses; a host that draws its own tabs (VS Code,
 * `__DT_HOST__.tabs === true`) never draws these.
 */
import { ref } from 'vue';

export interface Tab { path: string; route: string; title: string; icon?: string }

/** The path a tab is keyed by: the route without its query or hash, decoded. */
export function tabPath(route: string): string {
	let p = route.split('?')[0].split('#')[0];
	if (p.length > 1) p = p.replace(/\/+$/, '');
	try { p = decodeURIComponent(p); } catch { /* keep it */ }
	return p || '/';
}

/** The list after visiting `route`: its tab takes the route (and keeps its title), or a new tab is appended. */
export function visit(tabs: readonly Tab[], route: string, title = ''): Tab[] {
	const path = tabPath(route);
	const i = tabs.findIndex((t) => t.path === path);
	if (i < 0) return [...tabs, { path, route, title: title || fallbackTitle(path) }];
	if (tabs[i].route === route) return tabs as Tab[];
	return tabs.map((t, j) => (j === i ? { ...t, route } : t));
}

/** The list without the tab at `path`, and the route to show when it was the open one (null: stay, or nothing left). */
export function closeTab(tabs: readonly Tab[], path: string, activePath: string): { tabs: Tab[]; next: string | null } {
	const i = tabs.findIndex((t) => t.path === path);
	if (i < 0) return { tabs: tabs as Tab[], next: null };
	const rest = tabs.filter((_, j) => j !== i);
	if (path !== activePath) return { tabs: rest, next: null };
	const neighbour = rest[i] ?? rest[i - 1] ?? null;
	return { tabs: rest, next: neighbour?.route ?? null };
}

/** A tab's label before its page has said its title: the last segment of the path, as words. */
export function fallbackTitle(path: string): string {
	if (path === '/content') return 'Home';
	const last = path.split('/').filter(Boolean).pop() ?? '';
	return last.replace(/[-_]+/g, ' ').trim() || 'Home';
}

// ---- the store ---------------------------------------------------------------------------------
const KEY = 'dt.tabs.v1';
export const tabs = ref<Tab[]>([]);

export function restoreTabs(storage: Pick<Storage, 'getItem'> | null = safeStorage()): void {
	try {
		const raw = storage?.getItem(KEY);
		const list = raw ? JSON.parse(raw) : null;
		if (Array.isArray(list)) tabs.value = list.filter((t) => t && typeof t.path === 'string' && typeof t.route === 'string').map((t) => ({ path: t.path, route: t.route, title: String(t.title ?? ''), ...(t.icon ? { icon: String(t.icon) } : {}) }));
	} catch { /* a broken entry is no tabs */ }
}

export function saveTabs(storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
	try { storage?.setItem(KEY, JSON.stringify(tabs.value)); } catch { /* storage off: tabs live for this page only */ }
}

/** The open page said its title (PageHeader): the tab at that path takes it. */
export function titleTab(route: string, title: string, icon?: string): void {
	const path = tabPath(route);
	const i = tabs.value.findIndex((t) => t.path === path);
	if (i < 0 || !title || (tabs.value[i].title === title && tabs.value[i].icon === icon)) return;
	tabs.value = tabs.value.map((t, j) => (j === i ? { ...t, title, ...(icon ? { icon } : {}) } : t));
	saveTabs();
}

function safeStorage(): Storage | null {
	try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
