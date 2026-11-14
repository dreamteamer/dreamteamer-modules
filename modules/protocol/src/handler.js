// THE SHARED HANDLER — what every host answers, in one place.
//
// The extension's in-process host side (its `api.ts` and the modules it calls, none of which import the
// editor) is ported into `host/`, and this file puts the protocol's route table in front of it: a request
// whose method and path `ROUTES` does not name is answered 404 `unhandled request …` here and never
// reaches the host, so an undocumented route cannot exist (the router is the table).
//
// The engine is the WORKSPACE's own — `initEngine(root)` loads `<root>/node_modules/dreamteamer`'s public
// API (`src/api.js`) the way the extension always has, and every compile-gated write re-opens the
// workspace first (`refreshWorkspace`), refusing with 409 when it will not open (review R5's fix).
import fs from 'node:fs';
import { join as pathJoin } from 'node:path';
import { ROUTES, matchRoute } from './routes.js';
import { initEngine, refreshWorkspace } from './host/engine.js';
import { WorkspaceApi } from './host/api.js';
import { navModel, navOpContext, workspaceNavSettings } from './nav-model.js';
import { NAV_FILE, NavDocError, NavOpError, applyNavOp, checkNavDoc, navDocProblems, navProblemsSentence, readNavDoc, unknownNavNames, writeNavDoc } from './nav-doc.js';
import { hasNavSettings } from './host/nav.js';
import { PANE_ROUTES, answerPane, defaultPane } from './pane.js';

/**
 * @param {{ root: string, onSystemWrite?: (result: unknown) => void,
 *           settings?: () => object, pane?: import('./pane.d.ts').PaneStore }} opts — `settings` answers the four nav
 *           settings (default: the workspace's .vscode/settings.json); `pane` the store the five pane routes answer from
 *           (default: one in memory, at admin)
 * @returns {Promise<{ handle: (method: string, path: string, body?: unknown) => Promise<{ status: number, body: unknown }>,
 *                    readonly api: WorkspaceApi, reopen: () => Promise<void> }>}
 */
export async function createHandler({ root, onSystemWrite, settings = () => workspaceNavSettings(root), pane } = {}) {
	if (!root) throw new Error('createHandler: no workspace root');
	await initEngine(root);
	const api = new WorkspaceApi(root);
	if (onSystemWrite) api.onSystemWrite = onSystemWrite;
	return {
		api,
		reopen: () => refreshWorkspace(),
		handle: (method, path, body) => route(api, method, path, body, { root, settings, host: (m, p, b) => api.handle(m, p, b), pane }),
	};
}

/**
 * One request through the protocol's router in front of a host that is already open — what createHandler
 * answers with, and what a host that opened the workspace itself (the VS Code extension) calls directly: an
 * unnamed method and path is 404 `unhandled request`, an unreadable `?dry-run` is 400, `GET /nav` is the nav
 * model, `PATCH /nav` and `PUT /nav` write nav.yaml, the five pane routes answer from `pane` (a memory store per
 * api when absent), and everything else is the host's.
 * @param {{ descriptors(): unknown }} api
 * @param {{ root: string, settings: () => object, host: (method: string, path: string, body?: unknown) => Promise<{ status: number, body: unknown }>,
 *           pane?: import('./pane.d.ts').PaneStore }} opts
 */
export async function route(api, method, path, body, { root, settings, host, pane }) {
	const m = String(method).toUpperCase();
	const hit = matchRoute(m, path);
	if (!hit) {
		const hint = unencodedHint(api, path);
		return { status: 404, body: { error: `unhandled request ${m} ${path}${hint ? ` — ${hint}` : ''}` } };
	}
	const refused = unreadableDryRun(m, path);
	if (refused) return { status: 400, body: { error: refused } };
	// the one route the editor's host never needed: its tree IS the nav
	if (hit.route.id === 'nav') {
		try { api.descriptors(); return { status: 200, body: navModel({ root, settings: settings() ?? {} }) }; }
		catch (e) { return { status: 400, body: { error: String(e?.message ?? e) } }; }
	}
	if (hit.route.id === 'nav-patch' || hit.route.id === 'nav-put') return navWrite(api, hit.route.id, body, { root, settings });
	if (PANE_ROUTES.has(hit.route.id)) {
		const reader = { descriptors: () => api.descriptors(), handle: (m2, p2) => host(m2, p2) };
		return answerPane(hit.route.id, body, { pane: pane ?? defaultPane(api, host), reader });
	}
	const res = await host(m, path, body);
	// a greedy route (history) hands the split name to the host, which refuses the first half: say why
	if (res?.status >= 400 && !/percent-encoded/.test(String(res.body?.error ?? ''))) {
		const hint = unencodedHint(api, path);
		if (hint) return { ...res, body: { ...res.body, error: `${res.body?.error ?? 'refused'} — ${hint}` } };
	}
	return res;
}

export const NAV_UNMIGRATED = 'your nav settings are not in nav.yaml yet — run: npx -p @dreamteamer/protocol@0.2 dt-nav migrate';

/**
 * `PATCH /nav` (one NavOp) and `PUT /nav` (a whole NavDoc): checked, applied, written through the engine's writer
 * when it has one, answered `200 { doc }`. Nothing is written on any refusal: a malformed op or document, an unknown
 * name, a folder path that resolves to nothing (400, the sentence naming the input); a nav.yaml that cannot be read,
 * under a PATCH (400 naming the file — a gesture never starts over from an empty document; PUT replaces it); and no
 * nav.yaml while an old nav setting is still set (409 naming the migration, so the first write never strands them).
 */
async function navWrite(api, id, body, { root, settings }) {
	try {
		try { api.descriptors(); } catch (e) { return { status: 400, body: { error: String(e?.message ?? e) } }; }
		if (!fs.existsSync(pathJoin(root, NAV_FILE)) && hasNavSettings(settings() ?? {})) return { status: 409, body: { error: NAV_UNMIGRATED } };
		const ctx = navOpContext(root);
		let doc;
		const file = pathJoin(root, NAV_FILE);
		if (id === 'nav-patch') {
			const current = readNavDoc(root);
			const { problems } = navDocProblems(current);
			if (current && problems.length) return { status: 400, body: { error: `${navProblemsSentence(problems)} — fix them by hand, or PUT a whole document; nothing was written` } };
			doc = applyNavOp(current, body, ctx);
		} else {
			doc = checkNavDoc(body);
			const unknown = unknownNavNames(doc, { collections: ctx.known, namespaces: ctx.namespaces });
			if (unknown.length) return { status: 400, body: { error: `nav.yaml would name what this workspace does not have: ${unknown.join(', ')} — nothing was written` } };
			// a nav.yaml that is a directory: PUT replaces an empty one, and never deletes what one holds
			if (isDirectory(file)) {
				if (fs.readdirSync(file).length) return { status: 400, body: { error: `nav.yaml is a directory with files in it — move it aside and PUT again; nothing was written` } };
				fs.rmdirSync(file);
			}
		}
		writeNavDoc(root, doc);
		return { status: 200, body: { doc } };
	} catch (e) {
		if (e instanceof NavOpError || e instanceof NavDocError || e?.name === 'NavDocError') return { status: 400, body: { error: String(e.message) } };
		return { status: 500, body: { error: String(e?.message ?? e) } };
	}
}

const isDirectory = (file) => { try { return fs.statSync(file).isDirectory(); } catch { return false; } };

/** The first segment of every route whose second is the collection: where a split name can arrive. */
const COLLECTION_HEADS = new Set(ROUTES.filter((r) => r.pattern.split('/')[2] === ':collection').map((r) => r.pattern.split('/')[1]));

/** A collection name with a slash sent unencoded splits into extra segments and matches no route: say which
 *  collection the caller meant, and why, rather than only "unhandled". */
function unencodedHint(api, path) {
	const seg = String(path).split('?')[0].replace(/^\/+/, '').split('/').map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
	if (!COLLECTION_HEADS.has(seg[0]) || seg.length < 3) return null;
	let names;
	try { names = api.descriptors(); } catch { return null; }
	if (names.has(seg[1])) return null;
	for (let take = seg.length; take > 2; take--) {
		const candidate = seg.slice(1, take).join('/');
		if (names.has(candidate)) {
			return `unknown collection "${seg[1]}" — did you mean "${candidate}"? a collection name containing "/" must be percent-encoded `
				+ `in the URL (encodeURIComponent("${candidate}")), or it splits into extra path segments.`;
		}
	}
	return null;
}

/** A write's `?dry-run` is absent, `true` or `false`; anything else — `yes`, a bare `?dry-run`, a repeat —
 *  is refused rather than read as "no", so a caller who meant a plan never gets a write. */
export function unreadableDryRun(method, path) {
	if (method === 'GET') return null;
	const q = String(path).split('?')[1];
	if (q === undefined) return null;
	const values = new URLSearchParams(q).getAll('dry-run');
	if (!values.length) return null;
	if (values.length === 1 && (values[0] === 'true' || values[0] === 'false')) return null;
	return `${method} ${path.split('?')[0]} does not understand ?dry-run=${values.join('&dry-run=')} — use ?dry-run=true or ?dry-run=false; nothing was written`;
}
