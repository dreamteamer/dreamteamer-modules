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
import { matchRoute } from './routes.js';
import { initEngine, refreshWorkspace } from './host/engine.js';
import { WorkspaceApi } from './host/api.js';
import { navModel, workspaceNavSettings } from './nav-model.js';

/**
 * @param {{ root: string, onSystemWrite?: (result: unknown) => void,
 *           settings?: () => object }} opts — `settings` answers the four nav settings (default: the workspace's .vscode/settings.json)
 * @returns {Promise<{ handle: (method: string, path: string, body?: unknown) => Promise<{ status: number, body: unknown }>,
 *                    readonly api: WorkspaceApi, reopen: () => Promise<void> }>}
 */
export async function createHandler({ root, onSystemWrite, settings = () => workspaceNavSettings(root) } = {}) {
	if (!root) throw new Error('createHandler: no workspace root');
	await initEngine(root);
	const api = new WorkspaceApi(root);
	if (onSystemWrite) api.onSystemWrite = onSystemWrite;
	return {
		api,
		reopen: () => refreshWorkspace(),
		handle: (method, path, body) => route(api, method, path, body, { root, settings, host: (m, p, b) => api.handle(m, p, b) }),
	};
}

/**
 * One request through the protocol's router in front of a host that is already open — what createHandler
 * answers with, and what a host that opened the workspace itself (the VS Code extension) calls directly: an
 * unnamed method and path is 404 `unhandled request`, an unreadable `?dry-run` is 400, `GET /nav` is the nav
 * model, and everything else is the host's.
 * @param {{ descriptors(): unknown }} api
 * @param {{ root: string, settings: () => object, host: (method: string, path: string, body?: unknown) => Promise<{ status: number, body: unknown }> }} opts
 */
export async function route(api, method, path, body, { root, settings, host }) {
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
	return host(m, path, body);
}

/** A collection name with a slash sent unencoded splits into extra segments and matches no route: say which
 *  collection the caller meant, and why, rather than only "unhandled". */
function unencodedHint(api, path) {
	const seg = String(path).split('?')[0].replace(/^\/+/, '').split('/').map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
	if (seg[0] !== 'collections' || seg.length < 3) return null;
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
