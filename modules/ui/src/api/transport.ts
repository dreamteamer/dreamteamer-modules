/**
 * THE PRIZE (decision 48): there is no web server.
 *
 * Everything the app used to `fetch('/api/…')` now rides one `postMessage` channel to the VS Code
 * extension host, which answers it in-process against the engine's own `Store` / `presentation` /
 * `schema-ops` modules (extension `src/api.ts`). Same clean REST contract, same shapes, same
 * error semantics — just a function call across the webview boundary instead of a socket.
 *
 * What that buys: no spawned `dreamteamer start` child, no port allocation, no cold-boot wait, no
 * cross-origin iframe (so VS Code's own `--vscode-*` theme vars reach the app directly), and no
 * "blank tab pointing at a dead port" after a window reload.
 */

export interface HostVsCodeApi {
	postMessage(message: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
}

declare global {
	interface Window {
		acquireVsCodeApi?: () => HostVsCodeApi;
		/** Webview URI of `.dreamteamer/ui/` — module app bundles are imported from here. */
		__DT_UI_BASE__?: string;
	}
}

// `acquireVsCodeApi` may only be called ONCE per webview document.
let vscodeApi: HostVsCodeApi | null = null;
function host(): HostVsCodeApi {
	if (!vscodeApi) {
		if (!window.acquireVsCodeApi) throw new Error('not running inside a VS Code webview');
		vscodeApi = window.acquireVsCodeApi();
	}
	return vscodeApi;
}

export class HostError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = 'HostError';
		this.status = status;
	}
}

interface Pending {
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
}

const pending = new Map<number, Pending>();
let nextId = 1;

window.addEventListener('message', (event: MessageEvent) => {
	const msg = event.data as { type?: string; id?: number; ok?: boolean; data?: unknown; error?: string; status?: number };
	if (msg?.type !== 'dt:rpc-reply' || typeof msg.id !== 'number') return;
	const entry = pending.get(msg.id);
	if (!entry) return;
	pending.delete(msg.id);
	if (msg.ok) entry.resolve(msg.data);
	else entry.reject(new HostError(msg.error ?? 'host request failed', msg.status ?? 400));
});

/**
 * Everything crossing `postMessage` is STRUCTURED-CLONED, and structured clone throws
 * `DataCloneError` on a Proxy. Vue's reactivity is deep, so anything read out of a ref is one:
 * `uiViews.value.find(…)` hands back a reactive record, and reusing its `filter`/`nav` in a write
 * body killed every "Save" onto an existing view. A JSON round-trip unwraps the proxies and is
 * lossless for what actually travels here — the host answers the same JSON REST contract a socket
 * would, so this is precisely what the wire used to carry.
 */
function cloneable(body: unknown): unknown {
	return body === undefined ? undefined : (JSON.parse(JSON.stringify(body)) as unknown);
}

/**
 * One clean-contract request. `path` is everything after `/api` (e.g. `/collections/tasks/records?limit=25`)
 * exactly as the old `cleanFetch` sent it, so the adapter above this layer is untouched.
 */
export function hostRequest(method: string, path: string, body?: unknown): Promise<unknown> {
	const id = nextId++;
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		host().postMessage({ type: 'dt:rpc', id, method, path, body: cloneable(body) });
	});
}

/**
 * MODULE COMPATIBILITY SHIM.
 *
 * A workspace module's `app.js` (spec §8) is a pre-built bundle we do not control and cannot
 * rebuild — a workspace's own kanban calls `fetch('/api/collections/…')` straight out of the documented
 * HTTP contract. With the server gone that request resolves against `vscode-webview://` and dies
 * with a 403, so this teaches `fetch` to answer `/api/*` from the host instead.
 *
 * Deliberately a shim rather than a contract change: "a module talks to /api" stays true on every
 * surface, so the same bundle keeps working whether it's loaded here or by a future HTTP host.
 * Must be installed BEFORE the first module entry is imported.
 */
export function installApiFetchShim(): void {
	const original = window.fetch.bind(window);
	window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		if (!url.startsWith("/api/") && url !== "/api") return original(input as any, init);

		const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
		let body: unknown;
		if (init?.body) {
			try {
				body = JSON.parse(String(init.body));
			} catch {
				body = init.body;
			}
		}
		try {
			const data = await hostRequest(String(method).toUpperCase(), url.slice(4), body);
			return jsonResponse(200, data);
		} catch (err) {
			const status = err instanceof HostError ? err.status : 500;
			return jsonResponse(status, { error: err instanceof Error ? err.message : String(err) });
		}
	};
}

function jsonResponse(status: number, data: unknown): Response {
	const text = JSON.stringify(data ?? null);
	// a real Response so `res.ok`, `res.status`, `res.json()` and `res.text()` all behave
	return new Response(text, {
		status,
		statusText: status < 400 ? "OK" : "Error",
		headers: { "content-type": "application/json" },
	});
}

/** Fire-and-forget notifications to the host (open a file in an editor, reveal a tree node, …). */
export function hostNotify(type: string, payload?: unknown): void {
	try {
		// same clone constraint as hostRequest — a reactive payload would throw DataCloneError
		host().postMessage({ type, ...((cloneable(payload) ?? {}) as object) });
	} catch {
		/* outside a webview (unit/dev) — notifications are best-effort */
	}
}

/**
 * Persist this tab's identity (route + whether it's pinned) into VS Code's own webview state.
 * It is the ONLY thing that survives a window reload: the panel serializer hands it straight back
 * to the extension, which is how N open tabs come back on N different routes instead of all
 * snapping to the last one visited (explorer tabs, operator 2026-07-27).
 */
export function hostSetState(state: unknown): void {
	try {
		host().setState(state);
	} catch {
		/* outside a webview (unit/dev) — nothing to persist */
	}
}
