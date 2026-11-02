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

/**
 * @param {{ root: string, scope?: 'all' | 'private' | 'shared', onSystemWrite?: (result: unknown) => void }} opts
 * @returns {Promise<{ handle: (method: string, path: string, body?: unknown) => Promise<{ status: number, body: unknown }>,
 *                    readonly api: WorkspaceApi, scope: string, reopen: () => Promise<void> }>}
 */
export async function createHandler({ root, scope, onSystemWrite } = {}) {
	if (!root) throw new Error('createHandler: no workspace root');
	await initEngine(root);
	const api = new WorkspaceApi(root);
	if (scope) api.scope = scope;
	if (onSystemWrite) api.onSystemWrite = onSystemWrite;
	return {
		api,
		get scope() { return api.scope; },
		set scope(s) { api.scope = s; },
		reopen: () => refreshWorkspace(),
		async handle(method, path, body) {
			const m = String(method).toUpperCase();
			if (!matchRoute(m, path)) return { status: 404, body: { error: `unhandled request ${m} ${path}` } };
			return api.handle(m, path, body);
		},
	};
}
