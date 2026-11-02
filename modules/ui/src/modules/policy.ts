/**
 * cr-modules-008 — the host's pure checks on everything that crosses a module frame other than a request
 * (requests go through @dreamteamer/protocol's gate): the cell sanitizer (D5), the list snapshot (D16), intents
 * (D13), navigation and keys (§2), the bridge bounds (D17), invalidation (D7) and the Delete dialog's titles.
 */
export interface FrameScope { module: string; own: Set<string>; reads: Set<string>; writes: Map<string, unknown>; ownViews?: string[] }

const CELL_TAGS = new Set(['span', 'div', 'time', 'strong', 'em', 'b', 'i', 'code', 'br', 'small', 'abbr']);
const CELL_ATTRS = /^(role|title|datetime|aria-[a-z-]+)$/;
const DROP_WITH_CONTENT = new Set(['script', 'style', 'svg', 'math', 'iframe', 'object', 'template', 'noscript', 'textarea', 'title']);

/** D5: cell markup from a registry frame → only the allow-listed tags and attributes; everything else is unwrapped or dropped. */
export function sanitizeCellHtml(html: string): string {
	let out = '';
	const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>|<!--[\s\S]*?-->|([^<]+)|</g;
	let skip: string | null = null;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html))) {
		const [whole, tagRaw, attrs, text] = m;
		if (text !== undefined || whole === '<') { if (!skip) out += text ?? '&lt;'; continue; }
		if (!tagRaw) continue; // comment
		const tag = tagRaw.toLowerCase();
		const closing = whole.startsWith('</');
		if (skip) { if (closing && tag === skip) skip = null; continue; }
		if (DROP_WITH_CONTENT.has(tag)) { if (!closing && !/\/\s*$/.test(attrs)) skip = tag; continue; }
		if (!CELL_TAGS.has(tag)) continue;
		if (closing) { out += `</${tag}>`; continue; }
		let kept = '';
		const attrRe = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
		let a: RegExpExecArray | null;
		while ((a = attrRe.exec(attrs))) {
			const name = a[1].toLowerCase();
			if (!CELL_ATTRS.test(name)) continue;
			const value = (a[2] ?? a[3] ?? a[4] ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
			kept += ` ${name}="${value}"`;
		}
		out += `<${tag}${kept}>`;
	}
	return out;
}

const COMMIT_KEYS = ['$last-commit-message', '$created-by', '$last-modified-by', '$repo', '$dirty', '$ahead'];

export interface SnapshotInput {
	scope: FrameScope; collection: string; rows: Record<string, unknown>[]; total: number; pk: string;
	columns: Array<Record<string, unknown>>; selected: Set<string>; sort: { field: string | null; desc: boolean };
	titleOf: (row: Record<string, unknown>) => string; titleRefs: Record<string, string>; sources?: unknown;
	loading?: boolean; error?: string | null; tints?: Record<string, string>;
}
/** D16: the list `state` a frame sees — reshaped rows, titles only resolved inside reads, no sources. */
export function buildSnapshot(i: SnapshotInput) {
	const own = i.scope.own.has(i.collection);
	const items = i.rows.map((r) => { if (own) return { ...r }; const o = { ...r }; for (const k of COMMIT_KEYS) delete o[k]; return o; });
	const ids = items.map((r) => String(r[i.pk] ?? r.id ?? ''));
	const refTitles: Record<string, string> = {};
	for (const [ref, title] of Object.entries(i.titleRefs)) { const c = ref.slice(0, ref.lastIndexOf('/')); if (i.scope.reads.has(c)) refTitles[ref] = title; }
	return {
		collection: i.collection, pk: i.pk, items, ids, total: i.total, loading: !!i.loading, error: i.error ?? null,
		columns: i.columns, selected: [...i.selected].filter((id) => ids.includes(id)), sort: i.sort,
		titles: Object.fromEntries(items.map((r, n) => [ids[n], i.titleOf(r)])), refTitles, tints: i.tints ?? {},
	};
}

export const LIST_INTENTS = new Set(['reload', 'setSort', 'setSortValue', 'openRecord', 'toggleSelect', 'toggleSelectAllVisible', 'clearSelection', 'prevPage', 'nextPage']);
const SELECTION = new Set(['toggleSelect', 'toggleSelectAllVisible', 'clearSelection']);

/** D13: an intent carries at most an id or a column; the host accepts only ids it posted. */
export function checkIntent(scope: FrameScope, collection: string, posted: Set<string>, name: string, args: unknown[], columns: string[] = []): { ok: boolean; error?: string } {
	const no = (why: string) => ({ ok: false, error: `module app ${scope.module} cannot ${name} ${String(args[0] ?? '')}`.trim() + `: ${why}` });
	if (!LIST_INTENTS.has(name)) return no('a module app may not call that list action');
	if (SELECTION.has(name) && !scope.writes.has(collection)) return no('selection is offered only on a collection the module may write');
	if ((name === 'openRecord' || name === 'toggleSelect') && !(typeof args[0] === 'string' && posted.has(args[0]))) return no('not a row on this page');
	if (name === 'setSort' && !(typeof args[0] === 'string' && columns.includes(args[0]))) return no('not a column of this list');
	return { ok: true };
}

/** §2: navigation from a frame — own app routes and own ui-view routes with their query; a read collection's list or record without one. */
export function checkNavigate(scope: FrameScope, to: string): { ok: boolean; to?: string; error?: string } {
	const no = { ok: false, error: `module app ${scope.module} cannot navigate to ${to}` };
	if (typeof to !== 'string' || !to.startsWith('/') || to.startsWith('//')) return no;
	const [pathPart] = to.split('?');
	if (pathPart === `/a/${scope.module}` || pathPart.startsWith(`/a/${scope.module}/`)) return { ok: true, to };
	if ((scope.ownViews ?? []).includes(pathPart)) return { ok: true, to };
	const m = /^\/content\/(.+)$/.exec(pathPart);
	if (m) {
		const rest = decodeURIComponent(m[1]);
		const collection = [...scope.reads].filter((c) => rest === c || rest.startsWith(c + '/')).sort((a, b) => b.length - a.length)[0];
		if (collection && !rest.slice(collection.length + 1).split('/').includes('+')) return { ok: true, to: pathPart };
	}
	return no;
}

/** §2: the chrome shortcuts a frame may forward (VS Code only). */
export function forwardKey(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }): boolean {
	if (e.key === 'Escape') return true;
	if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
	return ['p', 'b', 'j'].includes(e.key.toLowerCase());
}

/** D17: 4 requests in flight, 20 intents a second, 60 writes a minute. */
export function createBounds(now: () => number = Date.now) {
	let inFlight = 0; const intents: number[] = []; const writes: number[] = [];
	const window = (list: number[], ms: number, max: number) => { const t = now(); while (list.length && t - list[0] > ms) list.shift(); if (list.length >= max) return false; list.push(t); return true; };
	return {
		start: () => (inFlight >= 4 ? false : (inFlight++, true)),
		end: () => { inFlight = Math.max(0, inFlight - 1); },
		intent: () => window(intents, 1000, 20),
		write: () => window(writes, 60_000, 60),
	};
}

/** D7: what of an invalidation a frame hears. */
export function invalidationFor(scope: FrameScope, msg: { scope: string; collections?: string[] }) {
	if (msg.scope === 'schema') return { scope: 'schema' };
	const hit = msg.collections ? msg.collections.filter((c) => scope.reads.has(c)) : [...scope.reads];
	return hit.length ? { scope: msg.scope, collections: hit } : null;
}

export function deleteDialogTitles(titles: string[]): string {
	return titles.length <= 10 ? titles.join(', ') : `${titles.slice(0, 10).join(', ')} and ${titles.length - 10} more`;
}
