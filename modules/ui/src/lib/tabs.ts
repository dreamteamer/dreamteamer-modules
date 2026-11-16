/**
 * PILL TABS (cr-modules-022) — the browser host's open pages. Every route a person opens is a tab, keyed by its path
 * (a list's query — its filter, sort, page — rides along on the tab and is not a new tab); opening a route that has
 * a tab focuses it. Closing the open tab selects its right-hand neighbour, else its left. No preview tabs, no pinning,
 * no reordering. The list and the selected tab are kept in localStorage, so a reload restores both.
 *
 * At most TAB_CAP tabs: opening one more closes the least recently used tab that is not the one being opened.
 *
 * A tab's TITLE never flickers through placeholders: a new tab takes the title it was opened with (the row, nav entry
 * or search hit that was clicked — `seedTitle`), else the last title this page knew for that path, else words from its
 * path; a page's provisional title (a record page before its record loads names its id) never replaces it, and the
 * page's real title does (`titleTab`).
 *
 * Pure functions over a plain list, plus one store the shell uses; a host that draws its own tabs (VS Code,
 * `__DT_HOST__.tabs === true`) never draws these, and nothing here touches storage until the strip starts.
 */
import { ref } from 'vue';

export interface Tab {
	path: string;
	route: string;
	title: string;
	icon?: string;
	/** When the tab was last opened or selected (ms) — what "least recently used" reads. */
	seen?: number;
	/** The title is a real one (a page or a click said it), not words from the path. */
	titled?: boolean;
}

/** How many tabs the strip keeps open. */
export const TAB_CAP = 12;

/** The path a tab is keyed by: the route without its query or hash, decoded. */
export function tabPath(route: string): string {
	let p = route.split('?')[0].split('#')[0];
	if (p.length > 1) p = p.replace(/\/+$/, '');
	try { p = decodeURIComponent(p); } catch { /* keep it */ }
	return p || '/';
}

export interface VisitOptions {
	/** The clock, for least-recently-used (tests pass their own). */
	now?: number;
	cap?: number;
	/** The last title known for a path, if any. */
	known?: (path: string) => { title: string; icon?: string } | undefined;
}

/**
 * The list after visiting `route`: its tab takes the route and is marked used, or a new tab is appended — and when that
 * makes one too many, the least recently used OTHER tab is closed.
 */
export function visit(tabs: readonly Tab[], route: string, title = '', opts: VisitOptions = {}): Tab[] {
	const path = tabPath(route);
	const now = opts.now ?? Date.now();
	const i = tabs.findIndex((t) => t.path === path);
	if (i >= 0) return tabs.map((t, j) => (j === i ? { ...t, route, seen: now } : t));
	const known = title ? { title } : opts.known?.(path);
	const tab: Tab = { path, route, title: known?.title || fallbackTitle(path), ...(known && 'icon' in known && known.icon ? { icon: known.icon } : {}), seen: now, titled: !!known?.title };
	const list = [...tabs, tab];
	const cap = Math.max(1, opts.cap ?? TAB_CAP);
	while (list.length > cap) {
		let lru = -1;
		list.forEach((t, j) => {
			if (t === tab) return;
			if (lru < 0 || (t.seen ?? 0) < (list[lru]!.seen ?? 0)) lru = j;
		});
		list.splice(lru, 1);
	}
	return list;
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

/** '/' and the bare '/content' are transit routes: ContentBrowse sends them on to the first collection. */
export function isTransit(route: string): boolean {
	return !route || route === '/' || tabPath(route) === '/content';
}

// ---- the store ---------------------------------------------------------------------------------
const KEY = 'dt.tabs.v1';
const ACTIVE_KEY = 'dt.tabs.active.v1';
const KNOWN_MAX = 500;
export const tabs = ref<Tab[]>([]);
/** path → the last real title this page saw for it (a closed tab reopened keeps its name). */
const knownTitles = new Map<string, { title: string; icon?: string }>();
/** Storage is touched only once the strip has started — a host that never draws it never writes. */
let started = false;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** The strip is drawn: from now on the tabs and the selected one are kept in storage. */
export function startTabs(): void {
	started = true;
}

function remember(path: string, title: string, icon?: string): void {
	knownTitles.delete(path);
	knownTitles.set(path, { title, ...(icon ? { icon } : {}) });
	if (knownTitles.size > KNOWN_MAX) knownTitles.delete(knownTitles.keys().next().value!);
}
export const knownTitle = (path: string) => knownTitles.get(path);

export function restoreTabs(storage: Pick<Storage, 'getItem'> | null = safeStorage()): void {
	try {
		const raw = storage?.getItem(KEY);
		const list = raw ? JSON.parse(raw) : null;
		if (!Array.isArray(list)) return;
		tabs.value = list
			.filter((t) => t && typeof t.path === 'string' && typeof t.route === 'string')
			.map((t) => ({
				path: t.path,
				route: t.route,
				title: String(t.title ?? ''),
				...(t.icon ? { icon: String(t.icon) } : {}),
				...(typeof t.seen === 'number' ? { seen: t.seen } : {}),
				titled: !!t.titled,
			}))
			.slice(-TAB_CAP);
		for (const t of tabs.value) if (t.titled) remember(t.path, t.title, t.icon);
	} catch { /* a broken entry is no tabs */ }
}

export function saveTabs(storage: Pick<Storage, 'setItem'> | null = started ? safeStorage() : null): void {
	try { storage?.setItem(KEY, JSON.stringify(tabs.value)); } catch { /* storage off: tabs live for this page only */ }
}

/** The selected tab's path, as the last page kept it (null: none, or storage off). */
export function restoreActive(storage: Pick<Storage, 'getItem'> | null = safeStorage()): string | null {
	try {
		const p = storage?.getItem(ACTIVE_KEY);
		return typeof p === 'string' && p ? p : null;
	} catch {
		return null;
	}
}

export function saveActive(path: string, storage: Pick<Storage, 'setItem'> | null = started ? safeStorage() : null): void {
	try { storage?.setItem(ACTIVE_KEY, path); } catch { /* storage off */ }
}

/** What the strip opens the route with: the list after the visit, kept. */
export function openTab(route: string, now?: number): void {
	tabs.value = visit(tabs.value, route, '', { now, known: knownTitle });
	saveTabs();
	saveActive(tabPath(route));
}

/** A click is about to open `route` and already knows what it is called (a row, a nav entry, a search hit). */
export function seedTitle(route: string, title: string, icon?: string): void {
	if (!title) return;
	const path = tabPath(route);
	remember(path, title, icon);
	const i = tabs.value.findIndex((t) => t.path === path);
	if (i < 0 || tabs.value[i]!.titled) return;
	tabs.value = tabs.value.map((t, j) => (j === i ? { ...t, title, ...(icon ? { icon } : {}), titled: true } : t));
	saveTabs();
}

/**
 * The open page said its title (PageHeader): the tab at that path takes it. A `provisional` title (a record page
 * before its record loads names its id) never replaces the one the tab has, and is not remembered.
 */
export function titleTab(route: string, title: string, icon?: string, provisional = false): void {
	if (!title || provisional) return;
	const path = tabPath(route);
	remember(path, title, icon);
	const i = tabs.value.findIndex((t) => t.path === path);
	if (i < 0) return;
	const t = tabs.value[i]!;
	if (t.title === title && (!icon || t.icon === icon) && t.titled) return;
	tabs.value = tabs.value.map((x, j) => (j === i ? { ...x, title, ...(icon ? { icon } : {}), titled: true } : x));
	saveTabs();
}

function safeStorage(): Store | null {
	try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
