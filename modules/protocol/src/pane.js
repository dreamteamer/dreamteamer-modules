// The pane routes (cr-modules-017 §5): GET /host, PUT and GET /selection, POST and GET /queue — answered by the
// shared router before the host, over a PaneStore the host passes (dt web persists one per workspace) or, when it
// passes none (the editor), a per-api memory store at admin.
//
// A view is structured, never a URL; every collection, record and ui-view it names must exist; refs are at most
// 50 existing `<collection>/<id>`. The place is rendered here from ids alone — a ui-view's place is its id, never
// its title, so nothing free-form reaches a chat's context through it.
//
// Refs are split by ONE seam: `opts.parseRef`, defaulting to the loaded engine's `engine().parseRef` (namespaces
// honoured — `rnd/change-requests/cr-x` is collection `rnd/change-requests`). A test passes its own.
import { randomUUID } from 'node:crypto';
import { engine } from './host/engine.js';

export const MAX_REFS = 50;
export const QUEUE_TTL_MS = 3_600_000;
export const QUEUE_LIST_MAX = 20;
export const PANE_ROUTES = new Set(['host', 'selection-put', 'selection-get', 'queue-post', 'queue-get']);
const VIEW_SHAPE = 'a view is { collection }, { collection, id }, { uiView } or { other: true }';

const isPlain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const keysAre = (o, keys) => { const k = Object.keys(o).sort(); return k.length === keys.length && k.every((x, i) => x === [...keys].sort()[i]); };
const nonEmpty = (s) => typeof s === 'string' && s.length > 0;
const encId = (id) => id.split('/').map(encodeURIComponent).join('/');
const fail = (error) => ({ ok: false, error });
const defaultParseRef = (ref) => engine().parseRef(ref);
const has = (descriptors, name) => (descriptors instanceof Map ? descriptors.has(name) : (descriptors ?? []).some?.((d) => d?.name === name) ?? false);

async function exists(api, collection, id) {
	if (!nonEmpty(collection) || !nonEmpty(id)) return false;
	const res = await api.handle('GET', `/collections/${encodeURIComponent(collection)}/records/${encId(id)}`);
	return res?.status === 200;
}

/** Each ref split and checked; `min` the least count. → { ok, value: [{ ref, collection, id }] } | { ok: false, error } */
async function checkRefs(api, refs, { parseRef = defaultParseRef, min = 0 } = {}) {
	if (!Array.isArray(refs)) return fail('refs is a list of <collection>/<id>');
	if (refs.length > MAX_REFS) return fail(`more than ${MAX_REFS} refs`);
	if (refs.length < min) return fail('name at least one record');
	const descriptors = api.descriptors();
	const out = [];
	const seen = new Set();
	for (const ref of refs) {
		if (!nonEmpty(ref)) return fail('a ref is a <collection>/<id> string');
		if (seen.has(ref)) continue;
		seen.add(ref);
		let parsed = null;
		try { parsed = parseRef(ref); } catch { parsed = null; }
		if (!parsed || !has(descriptors, parsed.collection) || !(await exists(api, parsed.collection, parsed.id))) return fail(`no record ${ref}`);
		out.push({ ref, collection: parsed.collection, id: parsed.id });
	}
	return { ok: true, value: out };
}

async function checkView(api, view) {
	if (!isPlain(view)) return fail(VIEW_SHAPE);
	if (keysAre(view, ['other'])) return view.other === true ? { ok: true, value: { other: true } } : fail(VIEW_SHAPE);
	if (keysAre(view, ['uiView'])) {
		if (!nonEmpty(view.uiView)) return fail(VIEW_SHAPE);
		return (await exists(api, 'ui-views', view.uiView)) ? { ok: true, value: { uiView: view.uiView } } : fail(`no ui-view ${view.uiView}`);
	}
	if (keysAre(view, ['collection']) || keysAre(view, ['collection', 'id'])) {
		if (!nonEmpty(view.collection) || ('id' in view && !nonEmpty(view.id))) return fail(VIEW_SHAPE);
		if (!has(api.descriptors(), view.collection)) return fail(`no collection ${view.collection}`);
		if (!('id' in view)) return { ok: true, value: { collection: view.collection } };
		return (await exists(api, view.collection, view.id))
			? { ok: true, value: { collection: view.collection, id: view.id } }
			: fail(`no record ${view.collection}/${view.id}`);
	}
	return fail(VIEW_SHAPE);
}

/**
 * `PUT /selection`'s body: `{ view, refs }` and nothing else.
 * @param {{ descriptors(): Map<string, unknown>, handle(method: string, path: string): Promise<{ status: number }> }} api
 */
export async function validateSelection(api, body, opts = {}) {
	if (!isPlain(body) || !keysAre(body, ['view', 'refs'])) return fail('a selection is { view, refs } and nothing else');
	const view = await checkView(api, body.view);
	if (!view.ok) return view;
	const refs = await checkRefs(api, body.refs, opts);
	if (!refs.ok) return refs;
	return { ok: true, value: { view: view.value, refs: refs.value.map((r) => r.ref) } };
}

/** `POST /queue`'s body: `{ command, refs }` — 1..50 refs of one collection, and a command bound to them with an invocation. */
export async function validateQueue(api, body, opts = {}) {
	if (!isPlain(body) || !keysAre(body, ['command', 'refs']) || !nonEmpty(body.command)) return fail('a queued command is { command, refs } and nothing else');
	const refs = await checkRefs(api, body.refs, { ...opts, min: 1 });
	if (!refs.ok) return refs;
	const collections = new Set(refs.value.map((r) => r.collection));
	if (collections.size !== 1) return fail('the refs of a queued command are all of one collection');
	const [collection] = collections;
	const ids = refs.value.map((r) => encodeURIComponent(r.id)).join(',');
	const res = await api.handle('GET', `/commands/${encodeURIComponent(collection)}?ids=${ids}`);
	const row = res?.status === 200 ? (res.body?.commands ?? []).find((r) => r?.command === body.command && nonEmpty(r?.invocation)) : undefined;
	if (!row) return fail(`${body.command} is not available for these records`);
	return { ok: true, value: { command: body.command, refs: refs.value.map((r) => r.ref), invocation: row.invocation } };
}

/** The place a view names, from ids: `tasks · List`, `rnd/change-requests/cr-x`, `<ui-view> · View`; `null` for none. */
export function renderPlace(view, uiViewTitle) {
	if (!isPlain(view) || view.other === true) return null;
	if (nonEmpty(view.uiView)) return `${uiViewTitle?.(view.uiView) ?? view.uiView} · View`;
	if (nonEmpty(view.collection) && nonEmpty(view.id)) return `${view.collection}/${view.id}`;
	if (nonEmpty(view.collection)) return `${view.collection} · List`;
	return null;
}

/** A copy with every waiting item queued QUEUE_TTL_MS or more before `now` marked expired. */
export function expireQueue(items, now) {
	return (items ?? []).map((i) => (i.state === 'waiting' && now - Date.parse(i.queuedAt) >= QUEUE_TTL_MS ? { ...i, state: 'expired' } : i));
}

/** Newest first, at most QUEUE_LIST_MAX, expiry applied. */
export function listQueue(items, now) {
	return expireQueue(items, now).sort((a, b) => Date.parse(b.queuedAt) - Date.parse(a.queuedAt)).slice(0, QUEUE_LIST_MAX);
}

export const newQueueItem = ({ command, refs, invocation }, now = Date.now()) =>
	({ id: randomUUID(), command, refs: [...refs], invocation, state: 'waiting', queuedAt: new Date(now).toISOString() });

/** A PaneStore held in memory — the editor's, and any host's that passes none. */
export function memoryPane({ host, now = Date.now }) {
	let selection = { view: null, refs: [], place: null, at: null };
	let queue = [];
	return {
		host: () => host(),
		getSelection: () => ({ ...selection, refs: [...selection.refs] }),
		putSelection: (s) => { selection = { view: s.view ?? null, refs: [...(s.refs ?? [])], place: s.place ?? null, at: s.at ?? null }; },
		getQueue: (at = now()) => listQueue(queue, at),
		addQueue: (i) => { const item = newQueueItem(i, now()); queue = [item, ...queue].slice(0, 100); return item; },
	};
}

const defaults = new WeakMap();
/** The memory store a host that passes none gets — one per api, answering at admin with the workspace's name. */
export function defaultPane(api, host) {
	let pane = defaults.get(api);
	if (!pane) {
		pane = memoryPane({ host: async () => {
			const info = await host('GET', '/info');
			return { level: 'admin', chat: false, workspace: { name: String(info?.body?.name ?? '') } };
		} });
		defaults.set(api, pane);
	}
	return pane;
}

/**
 * One pane route. `reader` is `{ descriptors(), handle(method, path) }` — the host the router fronts.
 * @returns {Promise<{ status: number, body: unknown }>}
 */
export async function answerPane(id, body, { pane, reader, parseRef }) {
	try {
		if (id === 'host') return { status: 200, body: await pane.host() };
		if (id === 'selection-get') return { status: 200, body: pane.getSelection() };
		if (id === 'queue-get') return { status: 200, body: { items: pane.getQueue() } };
		if (id === 'selection-put') {
			const r = await validateSelection(reader, body, parseRef ? { parseRef } : {});
			if (!r.ok) return { status: 400, body: { error: r.error } };
			const place = renderPlace(r.value.view);
			pane.putSelection({ view: r.value.view, refs: r.value.refs, place, at: new Date().toISOString() });
			return { status: 200, body: { view: r.value.view, refs: r.value.refs, place } };
		}
		if (id === 'queue-post') {
			const r = await validateQueue(reader, body, parseRef ? { parseRef } : {});
			if (!r.ok) return { status: 400, body: { error: r.error } };
			return { status: 200, body: { item: await pane.addQueue(r.value) } };
		}
	} catch (e) {
		return { status: 500, body: { error: String(e?.message ?? e) } };
	}
	return { status: 404, body: { error: `unhandled request ${id}` } };
}
